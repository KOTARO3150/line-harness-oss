// 「いま誰にどのリッチメニューが割り当たっているか」を LINE から実測する。
//
// なぜ必要か:
//   プロラインは友だち一人ひとりにリッチメニューを個別リンクしている。
//   個別リンクは「アカウント全体のデフォルト」より優先されるため、鈴木薬舗OS 側で
//   デフォルトを差し替えても既存のお客様の画面は変わらない。
//   そして「誰が既存のお客様か」という情報は、OS のどこにも無い。
//   唯一の正解は LINE 側の現状であり、それは 1 人ずつ問い合わせるしか読めない
//   (LINE には「このメニューが付いている人を列挙する」API が無い)。
//
// この処理は読み取りが主で、書き込みはタグの付与だけ。
// リッチメニューの割り当てを変えたり消したりは一切しない。

export interface AuditFriend {
  id: string;
  line_user_id: string;
}

export interface AuditResult {
  /** 今回問い合わせた人数 */
  scanned: number;
  /** 次に渡す offset。null なら全員を見終えた */
  nextOffset: number | null;
  /** richMenuId ごとの人数。個別リンクが無い人は 'none' */
  counts: Record<string, number>;
  /** 付けたタグごとの人数 (dry run では空) */
  tagged: Record<string, number>;
  /** 問い合わせに失敗した人数。失敗しても止めず、次に進む */
  failed: number;
  /** 時間切れで打ち切ったか */
  ranOutOfTime: boolean;
}

/** 1 回の呼び出しで見る人数の上限。Workers のサブリクエスト上限に当たる前に止める。 */
export const MAX_SCAN_PER_RUN = 120;
/** 1 回の呼び出しの時間予算 (ms)。 */
const DEFAULT_BUDGET_MS = 20_000;

/**
 * is_following な友だちを id 順に 1 ページ分取る。
 * 並びを固定しないと offset で取りこぼしと重複が起きるので、必ず id 順で固定する。
 */
export async function getFollowingFriendsPage(
  db: D1Database,
  accountId: string,
  offset: number,
  limit: number,
): Promise<AuditFriend[]> {
  const result = await db
    .prepare(
      `SELECT id, line_user_id
         FROM friends
        WHERE line_account_id = ? AND is_following = 1
        ORDER BY id
        LIMIT ? OFFSET ?`,
    )
    .bind(accountId, limit, offset)
    .all<AuditFriend>();
  return result.results ?? [];
}

/** その友だちに個別リンクされている richMenuId。無ければ null。 */
export async function fetchLinkedRichMenuId(
  accessToken: string,
  lineUserId: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.line.me/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  // 404 = 個別リンク無し。これは正常な答えであってエラーではない。
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LINE richmenu lookup failed: ${res.status}`);
  const json = (await res.json()) as { richMenuId?: string };
  return json.richMenuId ?? null;
}

export interface AuditOptions {
  accountId: string;
  offset?: number;
  limit?: number;
  budgetMs?: number;
  /**
   * richMenuId → タグ名 の対応。渡された場合だけタグを付ける。
   * 省略時は数えるだけ (dry run)。'none' をキーにすると個別リンクの無い人に付く。
   */
  assign?: Record<string, string>;
  /** タグ名 → tagId を解決する。無ければ作る。assign がある時だけ呼ばれる。 */
  resolveTagId?: (name: string) => Promise<string>;
  /** 友だちにタグを付ける。 */
  attachTag?: (friendId: string, tagId: string) => Promise<void>;
}

export async function auditRichMenuLinks(
  db: D1Database,
  accessToken: string,
  options: AuditOptions,
): Promise<AuditResult> {
  const offset = options.offset ?? 0;
  const limit = Math.min(options.limit ?? MAX_SCAN_PER_RUN, MAX_SCAN_PER_RUN);
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const startedAt = Date.now();

  const friends = await getFollowingFriendsPage(db, options.accountId, offset, limit);

  // richMenuId / タグ名はどちらも外から来た文字列がキーになる。'__proto__' のような名前が
  // 来たときに黙って握りつぶされないよう、prototype を持たない器を使う。
  const counts: Record<string, number> = Object.create(null);
  const tagged: Record<string, number> = Object.create(null);
  const tagIdCache = new Map<string, string>();
  let failed = 0;
  let scanned = 0;
  let ranOutOfTime = false;

  for (const friend of friends) {
    // 1 人目は必ず見る。2 人目以降は残り時間を見てから。
    if (scanned > 0 && Date.now() - startedAt >= budgetMs) {
      ranOutOfTime = true;
      break;
    }

    let key: string;
    try {
      const richMenuId = await fetchLinkedRichMenuId(accessToken, friend.line_user_id);
      key = richMenuId ?? 'none';
    } catch {
      failed += 1;
      scanned += 1;
      continue;
    }
    counts[key] = (counts[key] ?? 0) + 1;
    scanned += 1;

    const tagName = options.assign?.[key];
    if (!tagName || !options.resolveTagId || !options.attachTag) continue;

    let tagId = tagIdCache.get(tagName);
    if (!tagId) {
      tagId = await options.resolveTagId(tagName);
      tagIdCache.set(tagName, tagId);
    }
    await options.attachTag(friend.id, tagId);
    tagged[tagName] = (tagged[tagName] ?? 0) + 1;
  }

  // このページを見切って、かつ 1 ページ分まるごと取れていた時だけ「次がある」。
  // 取れた人数が limit 未満なら、そこで終わり。
  const consumedWholePage = !ranOutOfTime && friends.length === limit;
  const nextOffset = ranOutOfTime
    ? offset + scanned
    : consumedWholePage
      ? offset + friends.length
      : null;

  return { scanned, nextOffset, counts, tagged, failed, ranOutOfTime };
}

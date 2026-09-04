# 引き継ぎ記録: Claude(Opus 5) → Codex ／ 2026-09-02

作業者: Claude Opus 5（Cowork / claude.ai）。KOTA（鈴木賢太郎）の依頼で1セッション実施。
この文書は **Codex が同じ調査を繰り返さず、矛盾する変更をしないため** の記録。
本文中の「本番」= Cloudflare Worker `suzuki-yakupo-os` / D1 `suzuki-yakupo-os` / Pages `suzuki-pharmacy-admin`。

---

## 0. 最優先で知るべき3点

1. **リポジトリの物理パスが変わった。** 旧 `~/Documents/Codex/2026-07-17/p/line-harness-oss` → 新 **`~/Developer/line-harness-oss`**。旧パスは存在しない。
2. **本番は、コミットされていないコードで動いていた。** 2026-08-16 に作業ツリーから直接デプロイされていた。本セッションで `c4b9a2e` としてコミットし、履歴が本番に追いついた。
3. **本番のリッチメニューとフォームを変更した（コードではなく設定）。** 顧客300人に見えている画面が変わっている。§4 参照。

---

## 1. Git 状態（2026-09-02 終了時点）

```
e0b9839 (HEAD -> agent/external-booking-conflict, fork/…)  外部予約との二重予約防止
d78d270 (agent/chart-view-registry, fork/…)                相談カルテを閲覧登録制に
224e950 (agent/proline-booking-preview, fork/…)            tsbuildinfo を追跡外に
c4b9a2e                                                    注文台帳・動画案内所（※本番では稼働済み）
4dd3af9                                                    (セッション開始時のHEAD)
```

- 直列。3ブランチとも `fork` (github.com/KOTARO3150/line-harness-oss) へ push 済み。
- **`main` は `4b08cfd` で大きく遅れている。マージは未実施。**
- `.github/workflows/deploy-cloudflare-worker.yml` は **main への push で自動デプロイ**（未適用マイグレーションを番号順に適用してから Worker をデプロイ）。マージ＝本番反映なので注意。
- `ops/` は `.git/info/exclude` に登録したローカル専用ディレクトリ。**コミットしないこと。** 本番の Worker 名・D1 ID を含む。移動時に一緒に移動済み。
- 作業ツリーはクリーン。

---

## 2. 本セッションで追加したコード（すべて本番未反映）

### 2.1 `c4b9a2e` 注文台帳・動画案内所 — ただし**本番では既に稼働中**
コミットが後追いしただけで、機能追加ではない。migrations `055`–`062` を含む。
本番D1にはこれらの移行は**適用済み**（管理画面 `/orders` `/video-library` が実際に動作、動画13本登録済みを確認）。

### 2.2 `d78d270` 相談カルテの閲覧を登録制に
- `packages/db/migrations/063_chart_view_registry.sql` — `staff_members.can_view_charts` を追加。**既存行は `UPDATE ... SET can_view_charts = 1`** で現状維持（見え方を変えない）。新規は既定0。
- `apps/worker/src/middleware/chart-access.ts`（新規）— `owner` は常に許可、それ以外は `can_view_charts=1` のみ。**役割ではなく登録で判定**する。
- 適用先: `/api/consultation-charts`, `/api/consultation-charts/*`。
- `/api/suzuki/today` は `chartVisible` を返し、未登録者には `warnings` / `followUps` を**件数ごと**空で返す（件数だけでも患者情報が漏れるため）。
- 背景: `routes/consultation-charts.ts` に `requireRole` が **0件** だった。`staff.ts` / `line-accounts.ts` / `dedup-preview.ts` / `video-library.ts` には存在するので、方針ではなく**抜け**と判断した。

### 2.3 `e0b9839` 外部予約（プロライン取込）との二重予約防止
- `apps/worker/src/services/external-booking-conflict.ts`（新規）— 空き計算と INSERT で同一判定を共有。
- `services/availability.ts` — `external_bookings` の `status='scheduled'` を **全担当者の busy** として加算。`external_bookings` は `staff_id` を持たないため。`ends_at` が NULL の行は当該メニューの所要時間+バッファで代替。
- `routes/booking.ts` — LIFF 予約と管理画面の代理予約、**両方**の `INSERT ... WHERE NOT EXISTS` に外部予約条件を追加。
- 背景: `availability.ts` が `bookings` しか見ておらず、プロラインで埋まっている枠を受け付けて案内文まで送信していた。`external_bookings` の UNIQUE は `(line_account_id, friend_id, provider, starts_at)` で**時間枠を押さえない**。
- OS内予約同士の重複防止は元から正しく動いていた（原子的 INSERT、409、通知は INSERT 成功後）。

**検証**: db 128 / worker 717 / web 10 テスト合格、worker typecheck・build、web build、schema 検証すべて合格。

---

## 3. 本番で「既に動いている」ものの確認結果

| 対象 | 状態 |
|---|---|
| migrations 055–062 | 適用済み |
| `/orders` `/api/orders` | 稼働 |
| `/video-library` | 稼働、13本登録済み |
| `/video-guide`（顧客向け） | 稼働、5分類13本、免責文あり |
| migration 063 | **未適用** |
| staff_members | **1件のみ**、`role='staff'`、`api_key` は平文（056未適用時点のバックアップで確認） |
| ログイン | env `API_KEY` 経由のため実効 owner |

`056`（APIキーのハッシュ化）は本番未適用。適用後の初回ログインで平文が `retired_<uuid>` に置換される設計。

---

## 4. 本番設定の変更（コードではない・顧客に影響あり）

### 4.1 リッチメニュー
`rich_menu_groups.id = 6fcac26e-5adc-4117-8b22-ce458a3744a7` / page `452996b5-…` の6エリアを全面更新し、**LINE登録 → 全員のデフォルトに設定**まで実施。

| 位置 (x,y) | 表示 | 変更前 | 変更後 |
|---|---|---|---|
| 0,0 | 予約する | uri `suzuki-yakupo-os…/?…&page=salon-book` | 同左だが **`yakuho`** ドメイン |
| 833,0 | 見るだけ | uri `suzuki-yakupo-os…/video-guide` | 同左だが **`yakuho`** |
| 1666,0 | 聞きたい | **message** 「個別相談を申し込む」 | uri `https://line.me/R/oaMessage/@xat.0000195448.3uw/?相談したいこと：`（URLエンコード済み） |
| 0,843 | 店舗情報 | uri `suzuki-kanpo.co.jp/` | uri `suzuki-kanpo.co.jp/shop` |
| 833,843 | はじめて | uri `liff.line.me/…?**formId**=…` ← **バグ** | uri `liff.line.me/…?**page=form&id=**…` |
| 1666,843 | 質問を見る | **message** 「#よくある質問」 | uri `suzuki-kanpo.co.jp/faq` |

- `chatBarText`: `▲メニューを表示▲` → **`メニュー`**
- **`formId=` は誤り。** `apps/worker/src/client/main.ts:595-598` が読むのは `?page=form&id=<FORM_ID>`。誤りのため友だち300人に対しフォーム送信が累計1件だった。
- 自動応答（auto_replies）は **0件**。`message` アクションは押しても何も返らなかったため全廃した。
- LINE側デフォルト: `currentDefault = richmenu-ee0330cf4a660bc90a2d54383a9d434a`（旧: `null`）。

### 4.2 フォーム `23b37749-96ec-4c3d-8d19-6e56fdd03261`「はじめての相談前かんたん確認」
- `consultation`（今いちばん気になっていること / textarea）を **`required: true` → `false`**。
- 他のフィールド・chartTarget・tagRules は変更なし。
- 結果、必須は `full_name`(text) / `birth_date`(date) / `consultation_method`(radio) の3つ。**顧客が打鍵するのは氏名のみ。**
- `preferred_datetime` は自由記述のまま（選択式化は未実施）。

### 4.3 プロライン（autosns.jp）側
- `シナリオ別リッチメニュー` → `プロラインの基本リッチメニュー`
  - **旧値 `OuZDs64N8P`（8:基本リッチメニュー(6分割)）→ 新値 `LINE`（なし(LINE公式のリッチメニュー)）**
  - 適用範囲は「はい、全ユーザーのリッチメニューを変更してください」を選択（＝既存顧客にも即時反映）。
- **ロールバック手順**: 同じドロップダウンで `8:基本リッチメニュー(6分割)` を選び、同じダイアログで「はい、全ユーザー…」を押す。1分で戻る。

---

## 5. LINE / プロラインの構造（誤解しやすい点）

- LINE公式アカウントマネージャーのリッチメニュー: **0件**。
- Messaging API 上のリッチメニュー: **22個**、すべて `adminManaged=false`（プロライン製）。本セッションで OS製の1個が加わり23個。
- 本セッション前は `currentDefault=null` なのに顧客にはメニューが見えていた → **プロラインがユーザー個別に link していた**（個別リンクはデフォルトより優先される）。
- したがって「OS側でデフォルトを設定する」だけでは既存顧客の画面は変わらない。**プロライン側を『なし』にして初めて切り替わる。**
- 「削除」「解除(unlink)」「上書き(link)」は別物。**削除は不可逆、他2つは可逆。**

---

## 6. 危険と判断して**やらなかった**こと（Codexも安易に実行しないこと）

| 避けたこと | 理由 |
|---|---|
| 旧リッチメニュー22個の LINE からの削除 | **不可逆**。プロライン運用が壊れる。可逆な「上書き」で目的を達成したため不要 |
| 本番D1への書き込み・migration 063 の適用 | 顧客の健康情報を含む。バックアップ取得と人の判断が先 |
| `main` へのマージ | 自動デプロイの引き金。人の判断が必要 |
| 相談カルテ本文・顧客データの閲覧/出力 | 健康情報。件数と役割のみ確認し、氏名等はマスクして扱った |
| LINE の実送信（一斉配信・シナリオ・フォロー送信） | 実顧客に届く |
| 認証情報の入力（GitHub push、管理画面ログイン、APIキー） | Claude は認証情報を入力しない。すべて本人が実施 |
| `window.confirm` を伴う操作 | 自動操作でダイアログが出るとブラウザが応答不能になる。**本人が押す必要がある**（`rich-menus/edit/page.tsx:254` の「LINEに登録」等） |

---

## 7. 未解決・要検証（次にやること候補）

1. **右上「聞きたい」の挙動未検証。** `line.me/R/oaMessage/…` が同一トーク内から押されたときにキーボードを開くかは実機未確認。期待通りでなければ LINE の postback `inputOption: "openKeyboard"`（+`fillInText`）で対応する。**現コードベースは `inputOption` 未対応**（`rich-menus.ts` の action_type は uri/message/postback/richmenuswitch のみ、`inputOption` を通す実装なし）。
2. **プロラインの超ステップ配信**にシナリオ単位のリッチメニュー指定が残っている可能性（プロラインUIに明記あり）。一部顧客だけ旧メニューなら、そこを確認する。
3. フォーム `preferred_datetime` の選択式化（未実施）。症状カテゴリの選択式追加も検討中だが、臨床判断が要るため KOTA の意見待ち。
4. `staff_members` が1件・`role='staff'`。owner に上げるかは未決（現状は env `API_KEY` ログインで owner 相当）。
5. **`routes/forms.ts:538` が `line_user_id` を `console.log`**（PII が Cloudflare ログに残る）。要削除。
6. **`routes/broadcasts.ts` と `routes/orders.ts` に `requireRole` が0件**。一斉配信は認証さえ通れば誰でも実行できる。
7. `.github/workflows/*` に `permissions:` の絞り込みなし。

---

## 8. 環境上の注意（Claude 側の制約。Codex には無関係かもしれない）

- Claude のファイルブリッジは**ファイル削除ができない**（`rm` 不可、`mv` は可）。このため git のロックファイル（`index.lock` 等）が残りやすい。
- 本セッション中に `.git/index` を一度壊し、`git reset` で復旧した。**コミット履歴への影響なし**、作業ファイルの喪失なし。
- 退避したゴミ（stale lock、tmp_obj、旧 tarball 等）は **`~/Documents/Codex/2026-07-17/p/_to_delete/`** にある。中身を確認のうえ削除してよい。
- 旧リポジトリ配下に `.git/index 2` `.git/index 3` `node_modules/.bin 2` など**重複名ファイルが20件**あった。同期ツールの疑い。これが `~/Developer` へ移した理由。

---

## 9. 参考: 主要な識別子

```
LINE account (D1)   9943c6f5-a8a7-4143-a4bd-ec3f5fa40fa1  （表示名: 鈴木薬局 / @suzuyaku）
LIFF ID             2007647470-rsoWqPxv
Basic ID            @xat.0000195448.3uw
Worker (内部名)      suzuki-yakupo-os      ← 旧表記のまま。データ保護のため変更しない
公開URL             suzuki-yakuho-os.kentao999.workers.dev   ← エイリアスWorkerが中継
管理画面            suzuki-pharmacy-admin.pages.dev
D1                  suzuki-yakupo-os / 542ff2d7-fd80-442e-b630-3ca59400845e
R2                  line-harness-images
rich menu group     6fcac26e-5adc-4117-8b22-ce458a3744a7
rich menu (LINE)    richmenu-ee0330cf4a660bc90a2d54383a9d434a  ← 現デフォルト
form (初回問診)      23b37749-96ec-4c3d-8d19-6e56fdd03261
```

本番D1バックアップ: `~/Documents/Codex/production-backups/suzuki-yakupo-os-before-20260814-1415.sql`（2026-08-14 時点、健康情報を含むため Git 追加禁止）。

---

## 10. 追記 2026-09-04 — 既存のお客様に新メニューが出ない件（Claude / Opus 5）

### 症状
2026-09-02 に「アカウント全体のデフォルト」を OS 側メニュー
（`richmenu-ee0330cf4a660bc90a2d54383a9d434a`）へ切り替え、プロラインの
「基本リッチメニュー」を `LINE`（なし）にしたにもかかわらず、
**既存のお客様の画面は旧メニューのまま**（並びも変わらず）。

### 原因（LINE 仕様）
LINE では **ユーザー個別のリッチメニュー割り当てが、アカウント全体のデフォルトより優先される**。
プロラインは 1 人ずつ link を張る方式なので、デフォルトを差し替えても
**既に個別割り当てが残っている人には効かない**。
新規のお客様には個別割り当てが無いので、デフォルト＝新メニューが出る。
「新規と既存で見え方が違う」という報告はこれで説明がつく。

未確認: プロラインの超ステップ配信のシナリオ単位指定（第7章 項目2）が
イベント発生のたびに link を貼り直している可能性。**先にそちらを止めないと、
unlink しても再び上書きされる**。ブラウザ拡張が未接続で本日は確認できていない。

### 追加したもの（コミット 8096625）
`POST /api/line-accounts/:accountId/rich-menu/unlink-all`

個別割り当てだけを外す。外れた人はアカウント既定のメニューにフォールバックする。

```
body: { "tagId": null, "dryRun": true }
  tagId  null なら該当アカウントの全フォロワー。タグ指定で絞れる。
  dryRun 省略時 true。件数だけ返して LINE には一切触らない。
         実行するには明示的に false を渡す。
```

安全側の作り:
- `requireRole('owner')`
- 既定 dry run（事故防止）
- アカウント全体のデフォルトが未設定なら **409 で中止**
  （デフォルトが無い状態で unlink すると全員のメニューが消える）
- **リッチメニューは 1 つも削除しない。** 元に戻すには
  `POST /api/rich-menu-groups/:groupId/apply-to-tag` の `bulk-link`、
  またはプロライン側で割り当て直せばよい

実装: `unlinkRichMenuBulk` (`routes/rich-menu-groups.ts` の createLineClient) →
`unlinkRichMenuBulkChunked` (`lib/rich-menu-publisher.ts`、500件ずつ)。
テスト 8 本追加、worker 全体 733 passed、`tsc --noEmit` clean。

### 未実施（意図的に止めてある）
- **本番では一度も実行していない。** dry run も含めてゼロ。
  ブランチ `agent/external-booking-conflict` に置いてあるだけで、
  main へマージ＝自動デプロイなのでマージも保留。
- プロラインのシナリオ単位設定は未確認・未変更。
- 想定手順は 1) プロラインのシナリオ側の指定を「なし」にする →
  2) dry run で件数確認 → 3) `dryRun:false` で実行 → 4) 実機で確認。

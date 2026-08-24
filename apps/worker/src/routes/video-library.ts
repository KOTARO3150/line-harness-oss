import { Hono } from 'hono';
import {
  createVideoLibraryItem,
  deleteVideoLibraryItem,
  getVideoLibraryItem,
  getVideoLibraryItems,
  updateVideoLibraryItem,
  type VideoLibraryItem,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const videoLibrary = new Hono<Env>();

const SUZUKI_VIDEO_PRESET = [
  { title: 'アトピー性皮膚炎', description: '皮膚の状態だけでなく、からだ全体をどのように見ていくかをお話しします。', category: '皮膚・アレルギー', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_973f93f59d535fa4716ebdd7832abe25.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/ca44cb92520d1b677e60c441647b4860082fdaf74d3fe66d630dcefda95dcee2/video_973f93f59d535fa4716ebdd7832abe25_thumbnail.0000000.jpg' },
  { title: '妊活について', description: '妊活中のからだを整えるときに、鈴木薬舗が大切にしている視点をお伝えします。', category: '女性の健康', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_0a355430f21c33e9ef6b1094cef493f5.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/654abdec0e8d47d2d9645902d1e832d7bb81c73c601e8e6ded855e92023bac8c/video_0a355430f21c33e9ef6b1094cef493f5_thumbnail.0000000.jpg' },
  { title: '悪性腫瘍・がんと向き合う方へ', description: '治療中のからだと生活を支えるために、相談時に一緒に確認したいことをお話しします。', category: '治療中の支え', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_c797894a146ac93deb6d64618be88354.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/344fd0130d6caab1499fc00fc2ebeb06fc9ae3131a0e72dafb4c823f5e42ecec/video_c797894a146ac93deb6d64618be88354_thumbnail.0000001.jpg' },
  { title: '眠りのお悩み', description: '眠れない背景を急いで決めつけず、生活と体調から一緒に考えるための動画です。', category: 'からだと生活', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_60948cc6af287dc2c474f21dcea93d5f.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/3b3bb40a5a6f9055eaee2479f3bf896f18fc6e7176cc85649cec89fd276c2325/video_60948cc6af287dc2c474f21dcea93d5f_thumbnail.0000000.jpg' },
  { title: 'AGA・EDなど男性特有のお悩み', description: '話しにくいお悩みも含め、体調全体から考えるための入口をご案内します。', category: '男性の健康', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_e560059aa9416f0c19e3aa3a75f6695a.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/4f039a100b36a0ec0a42a187cee71823b64d0b078da3be636980083a087dc013/video_e560059aa9416f0c19e3aa3a75f6695a_thumbnail.0000000.jpg' },
  { title: '花粉症', description: '季節の症状だけに目を向けず、日頃の体調も含めて整える考え方をお話しします。', category: '皮膚・アレルギー', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_f656dc52d6ba4d0107429a182ec565c1.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/3c91564250c7fa2b1bd6f55ea167d3cc481066b0c2f083ae80728b915a289d1d/video_f656dc52d6ba4d0107429a182ec565c1_thumbnail.0000000.jpg' },
  { title: 'アレルギーと蕁麻疹', description: '症状が出たときの様子や生活の変化から、相談で確認したい点をお伝えします。', category: '皮膚・アレルギー', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_3ff05a97686e19b601ffb36fcccfbadc.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/131336bf6717877ea0e1b1c1635d265652cc04b88982fdad3341269526913653/video_3ff05a97686e19b601ffb36fcccfbadc_thumbnail.0000001.jpg' },
  { title: '体質に合わせたダイエット', description: '数字だけを追わず、無理なく続けられる整え方を考えるための動画です。', category: 'からだと生活', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_86b72a117c47a6b7bf3c724abb1ddf0f.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/0c70d3f909af1d3fb666446fc2af143d6c5460f885546490719d003a105129c0/video_86b72a117c47a6b7bf3c724abb1ddf0f_thumbnail.0000001.jpg' },
  { title: 'ニキビの整え方', description: '皮膚の状態と生活の両方を見ながら、焦らず整える考え方をご案内します。', category: '皮膚・アレルギー', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_837a60a7c3ae8e4fb0f860c5d4c28843.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/5a3f1f70eaa637e955c7f56f0e23ae673f7b5d91f969e8d8bb7676685fbbf801/video_837a60a7c3ae8e4fb0f860c5d4c28843_thumbnail.0000000.jpg' },
  { title: '痛みをやさしく理解する', description: '痛みを我慢するのではなく、状態を言葉にして相談するための手がかりをお伝えします。', category: 'からだと生活', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_6e24f0f4e7b983d26ba72265f64d85ac.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/19108e64c25d362d9674dc9ab68f741ba0754466a05090292557fb39b8d0667f/video_6e24f0f4e7b983d26ba72265f64d85ac_thumbnail.0000000.jpg' },
  { title: '汗のお悩み', description: '汗の出方や困る場面を整理し、相談につなげるための見方をご案内します。', category: '皮膚・アレルギー', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_0264a14eda4a60dcc2a8a56e214d4b1b.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/25b392091122b469b3febcb32f1c2add2fe105801d64fd730c361c72f5ebe5db/video_0264a14eda4a60dcc2a8a56e214d4b1b_thumbnail.0000000.jpg' },
  { title: '気象病・天気痛', description: '天候と体調の関係を記録しながら、自分の傾向を知るための動画です。', category: 'からだと生活', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_250a50d5208a6b86c0d9a82a915286af.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/e68653baffa8dc68ec2ce023f4fd51651461d8a957ccadfb6e487b5414e4caf9/video_250a50d5208a6b86c0d9a82a915286af_thumbnail.0000000.jpg' },
  { title: '原因がはっきりしない不調', description: 'うまく説明できない不調でも大丈夫です。相談の糸口を見つけるための考え方をお話しします。', category: 'からだと生活', videoUrl: 'https://autolinejp.s3.ap-northeast-1.amazonaws.com/bSCZTtdpI4/video_7efed8291ad472a2dee38b2f69b0d3ca.mp4', thumbnailUrl: 'https://autolinejp.s3.amazonaws.com/hls/4dc61eb43b1cd02b96381ba1313a4001ba80e5b5c85ba9a28cb3e37bc3357b4a/video_7efed8291ad472a2dee38b2f69b0d3ca_thumbnail.0000000.jpg' },
] as const;

function canManage(role: 'owner' | 'admin' | 'staff'): boolean {
  return role === 'owner' || role === 'admin';
}

function serialize(item: VideoLibraryItem) {
  return {
    id: item.id,
    lineAccountId: item.line_account_id,
    title: item.title,
    description: item.description,
    category: item.category,
    videoUrl: item.video_url,
    thumbnailUrl: item.thumbnail_url,
    sortOrder: item.sort_order,
    isFeatured: Boolean(item.is_featured),
    isActive: Boolean(item.is_active),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]!);
}

function requestOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function selfHostedAssetUrl(origin: string, sourceUrl: string): string {
  const filename = new URL(sourceUrl).pathname.split('/').pop();
  if (!filename) throw new Error('video preset asset filename is missing');
  return `${origin}/video-assets/videos/suzuki/${encodeURIComponent(filename)}`;
}

function parseByteRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

/**
 * R2 に保管した鈴木薬舗の動画・サムネイルを同一オリジンで公開する。
 * 動画プレイヤーのシークに必要な単一 byte range を扱い、それ以外の
 * R2 オブジェクトはこの経路から公開しない。
 */
videoLibrary.on(['GET', 'HEAD'], '/video-assets/:key{.+}', async (c) => {
  const key = c.req.param('key');
  if (!key.startsWith('videos/suzuki/') || !/^[A-Za-z0-9._/-]+$/.test(key)) return c.notFound();
  const metadata = await c.env.IMAGES.head(key);
  if (!metadata) return c.notFound();

  const headers = new Headers();
  metadata.writeHttpMetadata(headers);
  headers.set('Content-Type', metadata.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('ETag', metadata.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cross-Origin-Resource-Policy', 'same-site');

  if (c.req.method === 'HEAD') {
    headers.set('Content-Length', String(metadata.size));
    return new Response(null, { status: 200, headers });
  }

  const rangeHeader = c.req.header('Range');
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, metadata.size);
    if (!range) {
      headers.set('Content-Range', `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers });
    }
    const length = range.end - range.start + 1;
    const object = await c.env.IMAGES.get(key, { range: { offset: range.start, length } });
    if (!object) return c.notFound();
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${metadata.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  const object = await c.env.IMAGES.get(key);
  if (!object) return c.notFound();
  headers.set('Content-Length', String(metadata.size));
  return new Response(object.body, { status: 200, headers });
});

videoLibrary.get('/api/video-library', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  const items = await getVideoLibraryItems(c.env.DB, accountId);
  const account = await c.env.DB.prepare(
    'SELECT liff_id FROM line_accounts WHERE id = ?',
  ).bind(accountId).first<{ liff_id: string | null }>();
  const guideUrl = account?.liff_id
    ? `${requestOrigin(c.req.url)}/video-guide?liffId=${encodeURIComponent(account.liff_id)}`
    : null;
  return c.json({ success: true, data: { items: items.map(serialize), guideUrl } });
});

videoLibrary.get('/api/video-library/public', async (c) => {
  const liffId = c.req.query('liffId');
  if (!liffId) return c.json({ success: false, error: 'liffId is required' }, 400);
  const account = await c.env.DB.prepare(
    'SELECT id, name FROM line_accounts WHERE liff_id = ? AND is_active = 1',
  ).bind(liffId).first<{ id: string; name: string }>();
  if (!account) return c.json({ success: false, error: 'Account not found' }, 404);
  const items = await getVideoLibraryItems(c.env.DB, account.id, true);
  return c.json({ success: true, data: { accountName: account.name, items: items.map(serialize) } });
});

videoLibrary.post('/api/video-library', async (c) => {
  if (!canManage(c.get('staff').role)) return c.json({ success: false, error: '管理者権限が必要です' }, 403);
  const body = await c.req.json<{
    lineAccountId?: string; title?: string; description?: string | null; category?: string;
    videoUrl?: string; thumbnailUrl?: string | null; sortOrder?: number;
    isFeatured?: boolean; isActive?: boolean;
  }>();
  if (!body.lineAccountId || !body.title?.trim() || !body.videoUrl?.trim()) {
    return c.json({ success: false, error: 'アカウント・タイトル・動画URLは必須です' }, 400);
  }
  if (!validHttpUrl(body.videoUrl) || (body.thumbnailUrl && !validHttpUrl(body.thumbnailUrl))) {
    return c.json({ success: false, error: 'URLは http または https で入力してください' }, 400);
  }
  const item = await createVideoLibraryItem(c.env.DB, {
    lineAccountId: body.lineAccountId,
    title: body.title.trim(),
    description: body.description?.trim() || null,
    category: body.category?.trim() || 'お悩み別',
    videoUrl: body.videoUrl.trim(),
    thumbnailUrl: body.thumbnailUrl?.trim() || null,
    sortOrder: Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
    isFeatured: body.isFeatured,
    isActive: body.isActive,
  });
  return c.json({ success: true, data: serialize(item) }, 201);
});

videoLibrary.post('/api/video-library/import-suzuki-preset', async (c) => {
  if (!canManage(c.get('staff').role)) return c.json({ success: false, error: '管理者権限が必要です' }, 403);
  const body = await c.req.json<{ lineAccountId?: string }>();
  if (!body.lineAccountId) return c.json({ success: false, error: 'アカウントが必要です' }, 400);
  const account = await c.env.DB.prepare('SELECT id FROM line_accounts WHERE id = ?').bind(body.lineAccountId).first();
  if (!account) return c.json({ success: false, error: 'LINEアカウントが見つかりません' }, 404);
  const existing = await getVideoLibraryItems(c.env.DB, body.lineAccountId);
  const urls = new Set(existing.map((item) => item.video_url));
  let created = 0;
  const origin = requestOrigin(c.req.url);
  for (const [index, item] of SUZUKI_VIDEO_PRESET.entries()) {
    const videoUrl = selfHostedAssetUrl(origin, item.videoUrl);
    const thumbnailUrl = selfHostedAssetUrl(origin, item.thumbnailUrl);
    if (urls.has(videoUrl)) continue;
    await createVideoLibraryItem(c.env.DB, {
      lineAccountId: body.lineAccountId,
      ...item,
      videoUrl,
      thumbnailUrl,
      sortOrder: index + 1,
      isActive: true,
      isFeatured: false,
    });
    created += 1;
  }
  return c.json({ success: true, data: { created, skipped: SUZUKI_VIDEO_PRESET.length - created } });
});

videoLibrary.put('/api/video-library/:id', async (c) => {
  if (!canManage(c.get('staff').role)) return c.json({ success: false, error: '管理者権限が必要です' }, 403);
  const current = await getVideoLibraryItem(c.env.DB, c.req.param('id'));
  if (!current) return c.json({ success: false, error: 'Video not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  if (typeof body.videoUrl === 'string' && !validHttpUrl(body.videoUrl)) {
    return c.json({ success: false, error: '動画URLが正しくありません' }, 400);
  }
  if (typeof body.thumbnailUrl === 'string' && body.thumbnailUrl && !validHttpUrl(body.thumbnailUrl)) {
    return c.json({ success: false, error: '画像URLが正しくありません' }, 400);
  }
  const updated = await updateVideoLibraryItem(c.env.DB, current.id, {
    title: typeof body.title === 'string' ? body.title.trim() : undefined,
    description: body.description === null || typeof body.description === 'string' ? (body.description as string | null) : undefined,
    category: typeof body.category === 'string' ? body.category.trim() : undefined,
    videoUrl: typeof body.videoUrl === 'string' ? body.videoUrl.trim() : undefined,
    thumbnailUrl: body.thumbnailUrl === null || typeof body.thumbnailUrl === 'string' ? (body.thumbnailUrl as string | null) : undefined,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    isFeatured: typeof body.isFeatured === 'boolean' ? body.isFeatured : undefined,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
  });
  return c.json({ success: true, data: serialize(updated!) });
});

videoLibrary.delete('/api/video-library/:id', async (c) => {
  if (!canManage(c.get('staff').role)) return c.json({ success: false, error: '管理者権限が必要です' }, 403);
  const deleted = await deleteVideoLibraryItem(c.env.DB, c.req.param('id'));
  if (!deleted) return c.json({ success: false, error: 'Video not found' }, 404);
  return c.json({ success: true, data: null });
});

videoLibrary.get('/video-guide', async (c) => {
  const liffId = c.req.query('liffId') || '';
  const account = liffId ? await c.env.DB.prepare(
    'SELECT id, name FROM line_accounts WHERE liff_id = ? AND is_active = 1',
  ).bind(liffId).first<{ id: string; name: string }>() : null;
  if (!account) return c.html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>動画案内</title><p>動画案内を表示できませんでした。</p></html>', 404);
  const items = await getVideoLibraryItems(c.env.DB, account.id, true);
  const featured = items.filter((item) => item.is_featured);
  const categories = new Map<string, VideoLibraryItem[]>();
  for (const item of items.filter((entry) => !entry.is_featured)) {
    const list = categories.get(item.category) || [];
    list.push(item);
    categories.set(item.category, list);
  }
  const card = (item: VideoLibraryItem) => `<a class="card" href="/video-watch?liffId=${encodeURIComponent(liffId)}&id=${encodeURIComponent(item.id)}">
    ${item.thumbnail_url ? `<img src="${escapeHtml(item.thumbnail_url)}" alt="" loading="lazy">` : '<div class="placeholder">▶</div>'}
    <div class="body"><span class="play">動画を見る</span><h3>${escapeHtml(item.title)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}</div></a>`;
  const sections = [
    featured.length ? `<section class="featured"><h2>まず最初に</h2><p class="lead">鈴木薬舗が大切にしている考え方を、焦らずご覧ください。</p><div class="grid">${featured.map(card).join('')}</div></section>` : '',
    ...Array.from(categories.entries()).map(([category, videos]) => `<section><h2>${escapeHtml(category)}</h2><div class="grid">${videos.map(card).join('')}</div></section>`),
  ].join('');
  const empty = items.length === 0 ? '<div class="empty"><h2>ただいま準備中です</h2><p>動画は順次こちらに追加します。ご相談はいつでもLINEへお送りください。</p></div>' : '';
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#173f35"><title>${escapeHtml(account.name)} 動画案内</title><style>
    :root{color-scheme:light;--ink:#173f35;--paper:#f7f3e9;--gold:#a78442;--line:#ddd3bf}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:#25332f;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;line-height:1.75}header{padding:48px 22px 38px;background:var(--ink);color:white}header small{letter-spacing:.18em;color:#dfcfaa}header h1{margin:.35em 0 .2em;font-family:serif;font-size:30px}header p{margin:0;max-width:680px;color:#e9eee9}main{max-width:900px;margin:auto;padding:28px 18px 70px}section{margin:0 0 42px}h2{font-family:serif;color:var(--ink);border-bottom:1px solid var(--line);padding-bottom:8px}.lead{margin-top:-8px;color:#5d6b66}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{display:block;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:#fff;color:inherit;text-decoration:none;box-shadow:0 6px 22px rgba(33,44,39,.06)}.card img,.placeholder{width:100%;aspect-ratio:16/9;object-fit:cover;background:#dfe8e1}.placeholder{display:grid;place-items:center;font-size:40px;color:var(--ink)}.body{padding:17px}.body h3{margin:.25em 0;font-family:serif;font-size:19px}.body p{margin:.4em 0 0;color:#66716d;font-size:14px}.play{font-size:12px;font-weight:700;color:var(--gold);letter-spacing:.08em}.featured .card{border-color:#bda66e}.empty{padding:28px;background:white;border:1px solid var(--line);border-radius:14px}footer{text-align:center;padding:24px;color:#71807a;font-size:12px}@media(max-width:520px){header{padding-top:38px}.grid{grid-template-columns:1fr}}
  </style></head><body><header><small>SUZUKI PHARMACY</small><h1>からだと向き合うための動画案内</h1><p>急がず、必要なときに、気になるものからご覧ください。すべてを見る必要はありません。</p></header><main>${sections}${empty}</main><footer>動画は一般的な情報です。体調の急な変化や強い症状は、動画を待たず医療機関へご相談ください。</footer></body></html>`;
  c.header('Content-Security-Policy', "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.html(html);
});

videoLibrary.get('/video-watch', async (c) => {
  const liffId = c.req.query('liffId') || '';
  const id = c.req.query('id') || '';
  const item = liffId && id ? await c.env.DB.prepare(
    `SELECT v.* FROM video_library_items v
     INNER JOIN line_accounts a ON a.id = v.line_account_id
     WHERE v.id = ? AND v.is_active = 1 AND a.liff_id = ? AND a.is_active = 1`,
  ).bind(id, liffId).first<VideoLibraryItem>() : null;
  if (!item) return c.html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>動画</title><p>動画を表示できませんでした。</p></html>', 404);
  const back = `/video-guide?liffId=${encodeURIComponent(liffId)}`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#173f35"><title>${escapeHtml(item.title)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f7f3e9;color:#25332f;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;line-height:1.75}header,main{max-width:900px;margin:auto;padding:20px}header a{color:#173f35;text-decoration:none;font-weight:700}h1{font-family:serif;font-size:26px;color:#173f35}video{display:block;width:100%;max-height:70vh;background:#111;border-radius:14px;box-shadow:0 10px 35px rgba(0,0,0,.13)}.note{margin-top:18px;padding:18px;border:1px solid #ddd3bf;border-radius:14px;background:white}.note p{margin:0}.foot{font-size:12px;color:#6b7772;margin-top:18px}
  </style></head><body><header><a href="${back}">← 動画一覧へ戻る</a></header><main><h1>${escapeHtml(item.title)}</h1><video controls playsinline preload="metadata"${item.thumbnail_url ? ` poster="${escapeHtml(item.thumbnail_url)}"` : ''}><source src="${escapeHtml(item.video_url)}" type="video/mp4"></video>${item.description ? `<div class="note"><p>${escapeHtml(item.description)}</p></div>` : ''}<p class="foot">急いですべてを見る必要はありません。体調の急な変化や強い症状は、動画を待たず医療機関へご相談ください。</p></main></body></html>`;
  c.header('Content-Security-Policy', "default-src 'none'; media-src https:; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.html(html);
});

import { Hono } from 'hono';
import type { Env } from '../index.js';
import { computeUnansweredInbox } from '../services/unanswered-inbox.js';
import { matchingConditionalTagIds } from '../services/form-field-rules.js';
import { jstDayBounds } from '../services/jst-day.js';

const consultationCharts = new Hono<Env>();

async function friendInAccount(db: D1Database, friendId: string, accountId: string) {
  return db.prepare(
    `SELECT id, display_name, picture_url FROM friends WHERE id = ? AND line_account_id = ?`,
  ).bind(friendId, accountId).first<{ id: string; display_name: string | null; picture_url: string | null }>();
}

async function audit(
  db: D1Database,
  input: { accountId: string; chartId: string | null; friendId: string; staffId: string; action: string },
) {
  await db.prepare(
    `INSERT INTO consultation_audit_logs
      (id, line_account_id, chart_id, friend_id, staff_id, action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.accountId, input.chartId, input.friendId,
    input.staffId, input.action, new Date().toISOString(),
  ).run();
}

consultationCharts.get('/api/suzuki/today', async (c) => {
  const accountId = c.req.query('account_id');
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const { date, start, end } = jstDayBounds();
  const [bookings, submissions, warnings, followUps, unanswered] = await Promise.all([
    c.env.DB.prepare(
      `SELECT b.id, b.friend_id, b.starts_at, b.status, f.display_name AS friend_name,
              m.name AS menu_name, s.display_name AS staff_name
         FROM bookings b
         INNER JOIN friends f ON f.id = b.friend_id
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
        WHERE b.line_account_id = ? AND b.starts_at >= ? AND b.starts_at < ?
          AND b.status IN ('requested', 'confirmed')
        ORDER BY b.starts_at ASC`,
    ).bind(accountId, start, end).all(),
    c.env.DB.prepare(
      `SELECT fs.id, fs.friend_id, fs.created_at, f.display_name AS friend_name, fm.name AS form_name
         FROM form_submissions fs
         INNER JOIN friends f ON f.id = fs.friend_id
         INNER JOIN forms fm ON fm.id = fs.form_id
         LEFT JOIN consultation_records cr ON cr.source_form_submission_id = fs.id
        WHERE f.line_account_id = ? AND cr.id IS NULL
        ORDER BY fs.created_at DESC LIMIT 20`,
    ).bind(accountId).all(),
    c.env.DB.prepare(
      `SELECT cc.friend_id, COALESCE(cc.customer_name, f.display_name) AS customer_name,
              CASE WHEN TRIM(COALESCE(cc.safety_notes, '')) <> '' THEN 1 ELSE 0 END AS has_safety_notes,
              CASE WHEN TRIM(COALESCE(cc.allergies, '')) <> '' THEN 1 ELSE 0 END AS has_allergies,
              CASE WHEN TRIM(COALESCE(cc.current_medications, '')) <> '' THEN 1 ELSE 0 END AS has_medications
         FROM consultation_charts cc INNER JOIN friends f ON f.id = cc.friend_id
        WHERE cc.line_account_id = ? AND (
          TRIM(COALESCE(cc.safety_notes, '')) <> '' OR TRIM(COALESCE(cc.allergies, '')) <> ''
          OR TRIM(COALESCE(cc.current_medications, '')) <> '')
        ORDER BY CASE WHEN TRIM(COALESCE(cc.safety_notes, '')) <> '' THEN 0 ELSE 1 END, cc.updated_at DESC
        LIMIT 20`,
    ).bind(accountId).all(),
    c.env.DB.prepare(
      `SELECT cr.id, cc.friend_id, COALESCE(cc.customer_name, f.display_name) AS customer_name,
              cr.follow_up_plan, cr.follow_up_due_date
         FROM consultation_records cr
         INNER JOIN consultation_charts cc ON cc.id = cr.chart_id
         INNER JOIN friends f ON f.id = cc.friend_id
        WHERE cc.line_account_id = ? AND cr.follow_up_due_date IS NOT NULL
          AND cr.follow_up_due_date <= ? AND cr.follow_up_completed_at IS NULL
        ORDER BY cr.follow_up_due_date ASC LIMIT 20`,
    ).bind(accountId, date).all(),
    computeUnansweredInbox(c.env.DB, { account: accountId, page: 1, pageSize: 20 }),
  ]);
  return c.json({
    date,
    bookings: bookings.results,
    submissions: submissions.results,
    warnings: warnings.results,
    followUps: followUps.results,
    unanswered: unanswered.rows,
    counts: {
      bookings: bookings.results.length,
      submissions: submissions.results.length,
      warnings: warnings.results.length,
      followUps: followUps.results.length,
      unanswered: unanswered.total,
    },
  });
});

consultationCharts.get('/api/suzuki/operation-test', async (c) => {
  const accountId = c.req.query('account_id');
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const [account, form, tags, menuCount, staffCount, calendarCount, chartColumns, recordColumns] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, is_active, liff_id, channel_access_token FROM line_accounts WHERE id = ?`,
    ).bind(accountId).first<{ id: string; name: string; is_active: number; liff_id: string | null; channel_access_token: string | null }>(),
    c.env.DB.prepare(
      `SELECT id, name, fields, on_submit_tag_id FROM forms WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1`,
    ).first<{ id: string; name: string; fields: string; on_submit_tag_id: string | null }>(),
    c.env.DB.prepare(`SELECT id, name FROM tags`).all<{ id: string; name: string }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM menus WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL`,
    ).bind(accountId).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM staff WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL`,
    ).bind(accountId).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM google_calendar_connections WHERE is_active = 1 AND access_token IS NOT NULL AND access_token <> ''`,
    ).first<{ count: number }>(),
    c.env.DB.prepare(`PRAGMA table_info(consultation_charts)`).all<{ name: string }>(),
    c.env.DB.prepare(`PRAGMA table_info(consultation_records)`).all<{ name: string }>(),
  ]);

  type TestField = {
    name: string; label: string; type?: string; placeholder?: string; chartTarget?: string;
    tagRules?: Array<{ operator: 'equals' | 'contains' | 'not_empty'; value?: string; tagId: string }>;
  };
  let fields: TestField[] = [];
  try { fields = form ? JSON.parse(form.fields || '[]') as TestField[] : []; } catch { fields = []; }
  const sampleAnswers: Record<string, unknown> = {};
  for (const field of fields) {
    const conditionValue = field.tagRules?.find((rule) => rule.operator !== 'not_empty')?.value;
    sampleAnswers[field.name] = conditionValue || field.placeholder || (field.type === 'date' ? '1990-01-01' : field.name.includes('name') ? 'テスト 太郎' : 'テスト回答');
  }
  const matchedTagIds = new Set(form ? matchingConditionalTagIds(fields, sampleAnswers) : []);
  if (form?.on_submit_tag_id) matchedTagIds.add(form.on_submit_tag_id);
  const tagNames = new Map(tags.results.map((tag) => [tag.id, tag.name]));
  const mappings = fields.filter((field) => field.chartTarget).map((field) => ({
    question: field.label, target: field.chartTarget!, value: String(sampleAnswers[field.name] ?? ''),
  }));
  const recordColumnNames = new Set(recordColumns.results.map((column) => column.name));
  const chartReady = chartColumns.results.some((column) => column.name === 'safety_notes');
  const followUpReady = ['follow_up_due_date', 'follow_up_completed_at', 'follow_up_last_sent_at']
    .every((column) => recordColumnNames.has(column));
  const checks = [
    { key: 'line', label: 'LINE公式アカウント', status: account?.is_active && account.channel_access_token ? 'ready' : 'error', detail: account ? (account.is_active ? 'アクセストークン設定済み' : 'アカウントが停止中') : 'アカウントが見つかりません', href: '/accounts' },
    { key: 'liff', label: 'フォーム公開（LIFF）', status: account?.liff_id ? 'ready' : 'warning', detail: account?.liff_id ? 'LIFF ID設定済み' : 'LIFF IDが未設定です', href: '/accounts' },
    { key: 'form', label: 'フォーム・タグ・カルテ振り分け', status: form && mappings.length > 0 ? 'ready' : form ? 'warning' : 'error', detail: form ? `${form.name}：質問${fields.length}件・カルテ振り分け${mappings.length}件` : '受付中フォームがありません', href: '/forms' },
    { key: 'booking', label: '予約受付', status: menuCount?.count && staffCount?.count ? 'ready' : 'warning', detail: `有効メニュー ${menuCount?.count || 0}件・担当者 ${staffCount?.count || 0}名`, href: '/booking/setup' },
    { key: 'calendar', label: 'Googleカレンダー', status: calendarCount?.count === 1 ? 'ready' : 'warning', detail: calendarCount?.count === 1 ? '接続は1件で安全に同期できます' : `有効な接続 ${calendarCount?.count || 0}件（1件だけ必要）`, href: '/booking/setup' },
    { key: 'zoom', label: 'Zoom', status: c.env.ZOOM_ACCOUNT_ID && c.env.ZOOM_CLIENT_ID && c.env.ZOOM_CLIENT_SECRET ? 'ready' : 'warning', detail: c.env.ZOOM_ACCOUNT_ID && c.env.ZOOM_CLIENT_ID && c.env.ZOOM_CLIENT_SECRET ? 'Server-to-Server OAuth設定済み' : 'Zoom認証情報が未設定です', href: '/booking/setup' },
    { key: 'chart', label: '相談カルテDB', status: chartReady ? 'ready' : 'error', detail: chartReady ? '基本カルテを保存できます' : 'カルテ用DB移行が必要です', href: '/charts' },
    { key: 'followup', label: 'フォロー期限・LINE履歴', status: followUpReady ? 'ready' : 'error', detail: followUpReady ? '期限・完了・送信日時を保存できます' : 'DB移行 052 が必要です', href: '/charts' },
  ];
  return c.json({
    generatedAt: new Date().toISOString(), checks,
    simulation: {
      customerName: 'テスト 太郎', formName: form?.name || null, answers: sampleAnswers,
      tags: [...matchedTagIds].map((id) => ({ id, name: tagNames.get(id) || '削除済みのタグ' })),
      mappings,
      booking: { menus: menuCount?.count || 0, staff: staffCount?.count || 0 },
      externalWritesPerformed: false,
    },
  });
});

consultationCharts.get('/api/consultation-charts', async (c) => {
  const accountId = c.req.query('account_id');
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const search = (c.req.query('search') || '').trim();
  const safety = c.req.query('safety') || 'all';
  const tagId = (c.req.query('tag_id') || '').trim();
  if (!['all', 'allergies', 'medications', 'safety_notes'].includes(safety)) {
    return c.json({ error: 'invalid_safety_filter' }, 400);
  }
  const like = `%${search}%`;
  const rows = await c.env.DB.prepare(
    `SELECT f.id AS friend_id, f.display_name AS friend_name, f.picture_url,
            cc.id AS chart_id, cc.customer_name, cc.customer_name_kana,
            cc.updated_at,
            CASE WHEN TRIM(COALESCE(cc.allergies, '')) <> '' THEN 1 ELSE 0 END AS has_allergies,
            CASE WHEN TRIM(COALESCE(cc.current_medications, '')) <> '' THEN 1 ELSE 0 END AS has_medications,
            CASE WHEN TRIM(COALESCE(cc.safety_notes, '')) <> '' THEN 1 ELSE 0 END AS has_safety_notes,
            (SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color))
               FROM friend_tags ft INNER JOIN tags t ON t.id = ft.tag_id
              WHERE ft.friend_id = f.id) AS tags_json,
            (SELECT MAX(cr.consultation_at) FROM consultation_records cr WHERE cr.chart_id = cc.id) AS last_consultation_at,
            (SELECT COUNT(*) FROM consultation_records cr WHERE cr.chart_id = cc.id) AS consultation_count
       FROM friends f
       LEFT JOIN consultation_charts cc ON cc.friend_id = f.id
      WHERE f.line_account_id = ?
        AND (? = '' OR f.display_name LIKE ? OR cc.customer_name LIKE ? OR cc.customer_name_kana LIKE ?)
        AND (? = 'all'
          OR (? = 'allergies' AND TRIM(COALESCE(cc.allergies, '')) <> '')
          OR (? = 'medications' AND TRIM(COALESCE(cc.current_medications, '')) <> '')
          OR (? = 'safety_notes' AND TRIM(COALESCE(cc.safety_notes, '')) <> ''))
        AND (? = '' OR EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?))
      ORDER BY CASE WHEN cc.id IS NULL THEN 1 ELSE 0 END,
               COALESCE(last_consultation_at, cc.updated_at, f.created_at) DESC
      LIMIT 200`,
  ).bind(accountId, search, like, like, like, safety, safety, safety, safety, tagId, tagId).all<{
    tags_json: string | null; has_allergies: number; has_medications: number; has_safety_notes: number;
    [key: string]: unknown;
  }>();
  return c.json({
    charts: rows.results.map(({ tags_json, has_allergies, has_medications, has_safety_notes, ...row }) => ({
      ...row,
      has_allergies: Boolean(has_allergies),
      has_medications: Boolean(has_medications),
      has_safety_notes: Boolean(has_safety_notes),
      tags: JSON.parse(tags_json || '[]') as Array<{ id: string; name: string; color: string }>,
    })),
  });
});

consultationCharts.get('/api/consultation-charts/:friendId', async (c) => {
  const accountId = c.req.query('account_id');
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const friendId = c.req.param('friendId');
  const friend = await friendInAccount(c.env.DB, friendId, accountId);
  if (!friend) return c.json({ error: 'friend_not_found' }, 404);
  const chart = await c.env.DB.prepare(
    `SELECT * FROM consultation_charts WHERE friend_id = ? AND line_account_id = ?`,
  ).bind(friendId, accountId).first<Record<string, unknown>>();
  const records = chart ? await c.env.DB.prepare(
    `SELECT * FROM consultation_records WHERE chart_id = ? ORDER BY consultation_at DESC, created_at DESC`,
  ).bind(chart.id).all() : { results: [] };
  const bookings = await c.env.DB.prepare(
    `SELECT b.id, b.starts_at, b.status, m.name AS menu_name
       FROM bookings b INNER JOIN menus m ON m.id = b.menu_id
      WHERE b.friend_id = ? AND b.line_account_id = ?
      ORDER BY b.starts_at DESC LIMIT 20`,
  ).bind(friendId, accountId).all();
  const submissions = await c.env.DB.prepare(
    `SELECT fs.id, fs.created_at, fs.data, fm.name AS form_name, fm.fields,
            CASE WHEN cr.id IS NULL THEN 0 ELSE 1 END AS imported
       FROM form_submissions fs
       INNER JOIN forms fm ON fm.id = fs.form_id
       LEFT JOIN consultation_records cr ON cr.source_form_submission_id = fs.id
      WHERE fs.friend_id = ?
      ORDER BY fs.created_at DESC LIMIT 20`,
  ).bind(friendId).all<{
    id: string; created_at: string; data: string; form_name: string; fields: string; imported: number;
  }>();
  const tags = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.color FROM tags t
       INNER JOIN friend_tags ft ON ft.tag_id = t.id
      WHERE ft.friend_id = ? ORDER BY t.name`,
  ).bind(friendId).all();
  await audit(c.env.DB, {
    accountId, chartId: (chart?.id as string | undefined) ?? null, friendId,
    staffId: c.get('staff').id, action: 'view',
  });
  return c.json({
    friend, chart, records: records.results, bookings: bookings.results,
    tags: tags.results,
    submissions: submissions.results.map((submission) => ({
      id: submission.id,
      created_at: submission.created_at,
      form_name: submission.form_name,
      imported: Boolean(submission.imported),
      data: JSON.parse(submission.data || '{}') as Record<string, unknown>,
      fields: JSON.parse(submission.fields || '[]') as Array<{ name: string; label: string; chartTarget?: string }>,
    })),
  });
});

consultationCharts.put('/api/consultation-charts/:friendId', async (c) => {
  const accountId = c.req.query('account_id');
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const friendId = c.req.param('friendId');
  if (!(await friendInAccount(c.env.DB, friendId, accountId))) {
    return c.json({ error: 'friend_not_found' }, 404);
  }
  const body = await c.req.json<Record<string, string | null | undefined>>();
  if (body.source_form_submission_id) {
    const submission = await c.env.DB.prepare(
      `SELECT id FROM form_submissions WHERE id = ? AND friend_id = ?`,
    ).bind(body.source_form_submission_id, friendId).first<{ id: string }>();
    if (!submission) return c.json({ error: 'form_submission_not_found' }, 404);
    const imported = await c.env.DB.prepare(
      `SELECT id FROM consultation_records WHERE source_form_submission_id = ?`,
    ).bind(body.source_form_submission_id).first<{ id: string }>();
    if (imported) return c.json({ error: 'form_submission_already_imported' }, 409);
  }
  const existing = await c.env.DB.prepare(
    `SELECT id FROM consultation_charts WHERE friend_id = ? AND line_account_id = ?`,
  ).bind(friendId, accountId).first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO consultation_charts
      (id, line_account_id, friend_id, customer_name, customer_name_kana, birth_date,
       phone, allergies, current_medications, safety_notes, general_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(friend_id) DO UPDATE SET
       customer_name=excluded.customer_name, customer_name_kana=excluded.customer_name_kana,
       birth_date=excluded.birth_date, phone=excluded.phone, allergies=excluded.allergies,
       current_medications=excluded.current_medications, safety_notes=excluded.safety_notes,
       general_notes=excluded.general_notes, updated_at=excluded.updated_at`,
  ).bind(
    id, accountId, friendId, body.customer_name ?? null, body.customer_name_kana ?? null,
    body.birth_date || null, body.phone ?? null, body.allergies ?? null,
    body.current_medications ?? null, body.safety_notes ?? null,
    body.general_notes ?? null, now, now,
  ).run();
  await audit(c.env.DB, {
    accountId, chartId: id, friendId, staffId: c.get('staff').id,
    action: existing ? 'update_chart' : 'create_chart',
  });
  return c.json({ id });
});

consultationCharts.post('/api/consultation-charts/:friendId/records', async (c) => {
  const accountId = c.req.query('account_id');
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const friendId = c.req.param('friendId');
  if (!(await friendInAccount(c.env.DB, friendId, accountId))) {
    return c.json({ error: 'friend_not_found' }, 404);
  }
  const chart = await c.env.DB.prepare(
    `SELECT id FROM consultation_charts WHERE friend_id = ? AND line_account_id = ?`,
  ).bind(friendId, accountId).first<{ id: string }>();
  if (!chart) return c.json({ error: 'chart_not_created' }, 409);
  const body = await c.req.json<Record<string, string | null | undefined>>();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO consultation_records
      (id, chart_id, consultation_at, consultation_type, chief_complaint, observations,
       recommendation, products, usage_instructions, follow_up_plan, follow_up_due_date,
       source_form_submission_id, created_by_staff_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, chart.id, body.consultation_at || now,
    body.consultation_type || 'in_person', body.chief_complaint ?? null,
    body.observations ?? null, body.recommendation ?? null, body.products ?? null,
    body.usage_instructions ?? null, body.follow_up_plan ?? null, body.follow_up_due_date || null,
    body.source_form_submission_id ?? null,
    c.get('staff').id, now, now,
  ).run();
  await c.env.DB.prepare(`UPDATE consultation_charts SET updated_at = ? WHERE id = ?`)
    .bind(now, chart.id).run();
  await audit(c.env.DB, {
    accountId, chartId: chart.id, friendId, staffId: c.get('staff').id,
    action: 'create_consultation_record',
  });
  return c.json({ id }, 201);
});

consultationCharts.patch('/api/consultation-charts/:friendId/records/:recordId/follow-up', async (c) => {
  const accountId = c.req.query('account_id');
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const friendId = c.req.param('friendId');
  const recordId = c.req.param('recordId');
  if (!(await friendInAccount(c.env.DB, friendId, accountId))) return c.json({ error: 'friend_not_found' }, 404);
  const record = await c.env.DB.prepare(
    `SELECT cr.id, cr.chart_id FROM consultation_records cr
       INNER JOIN consultation_charts cc ON cc.id = cr.chart_id
      WHERE cr.id = ? AND cc.friend_id = ? AND cc.line_account_id = ?`,
  ).bind(recordId, friendId, accountId).first<{ id: string; chart_id: string }>();
  if (!record) return c.json({ error: 'record_not_found' }, 404);
  const body = await c.req.json<{ completed?: boolean }>();
  const now = new Date().toISOString();
  const completedAt = body.completed === false ? null : now;
  await c.env.DB.prepare(
    `UPDATE consultation_records SET follow_up_completed_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(completedAt, now, recordId).run();
  await audit(c.env.DB, {
    accountId, chartId: record.chart_id, friendId, staffId: c.get('staff').id,
    action: completedAt ? 'complete_follow_up' : 'reopen_follow_up',
  });
  return c.json({ completedAt });
});

consultationCharts.post('/api/consultation-charts/:friendId/records/:recordId/follow-up/send', async (c) => {
  const accountId = c.req.query('account_id');
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const friendId = c.req.param('friendId');
  const recordId = c.req.param('recordId');
  const body = await c.req.json<{ message?: string }>();
  const message = (body.message || '').trim();
  if (!message || message.length > 1000) return c.json({ error: 'message_must_be_1_to_1000_characters' }, 400);
  const record = await c.env.DB.prepare(
    `SELECT cr.id, cr.chart_id, f.line_user_id
       FROM consultation_records cr
       INNER JOIN consultation_charts cc ON cc.id = cr.chart_id
       INNER JOIN friends f ON f.id = cc.friend_id
      WHERE cr.id = ? AND cc.friend_id = ? AND cc.line_account_id = ? AND f.is_following = 1`,
  ).bind(recordId, friendId, accountId).first<{ id: string; chart_id: string; line_user_id: string }>();
  if (!record?.line_user_id) return c.json({ error: 'follow_up_recipient_not_found' }, 404);

  const { getLineAccountById } = await import('@line-crm/db');
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account?.channel_access_token) return c.json({ error: 'line_account_not_configured' }, 409);
  const { LineClient } = await import('@line-crm/line-sdk');
  await new LineClient(account.channel_access_token).pushMessage(record.line_user_id, [{ type: 'text', text: message }]);

  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
       VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'manual', ?)`,
    ).bind(messageId, friendId, message, now),
    c.env.DB.prepare(
      `UPDATE consultation_records SET follow_up_last_sent_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(now, now, recordId),
  ]);
  await audit(c.env.DB, {
    accountId, chartId: record.chart_id, friendId, staffId: c.get('staff').id,
    action: 'send_follow_up_message',
  });
  return c.json({ messageId, sentAt: now });
});

export { consultationCharts };

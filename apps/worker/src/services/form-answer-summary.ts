// フォームの回答を、そのまま人が読める一行ずつの文にする。
//
// 何のためか:
//   自動返信に {{answers}} と書いておくと、ここで作った文が差し込まれる。
//   お客様は自分が何を頼んだか確認でき、店側はチャット画面を見るだけで
//   注文内容が分かる（管理画面の別ページを開かなくてよい）。
//
// 方針:
//   - 質問の並び順をそのまま使う。画面で見た順と同じほうが確認しやすい
//   - 空欄は出さない。個数 0 も「頼んでいない」なので出さない
//   - 質問に無いキー（クライアントが足す「ご計金額」など）は最後に回す

export interface SummaryField {
  name: string;
  label: string;
  type?: string;
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.filter((v) => v !== '' && v != null).join('、');
  if (value === null || value === undefined) return '';
  return String(value);
}

/** 個数の質問で「0個」なら、注文していないので載せない。 */
function isSkippableQuantity(field: SummaryField, value: unknown): boolean {
  if (field.type !== 'quantity') return false;
  const n = Number(value);
  return !Number.isFinite(n) || n <= 0;
}

export function buildAnswerSummary(
  fields: SummaryField[],
  data: Record<string, unknown>,
): string {
  const lines: string[] = [];
  const used = new Set<string>();

  for (const field of fields) {
    used.add(field.name);
    const raw = data[field.name];
    const value = displayValue(raw);
    if (value === '') continue;
    if (isSkippableQuantity(field, raw)) continue;

    // 個数は「板藍茶 120包 × 1」の形にする。「: 1」より注文票らしく読める。
    lines.push(field.type === 'quantity' ? `${field.label} × ${value}` : `${field.label}：${value}`);
  }

  // 質問には無いが回答に入っているもの（合計金額など）を最後に足す。
  for (const [key, raw] of Object.entries(data)) {
    if (used.has(key)) continue;
    if (key.startsWith('_')) continue; // 内部用の値は出さない
    const value = displayValue(raw);
    if (value === '') continue;
    lines.push(`${key}：${value}`);
  }

  return lines.join('\n');
}

/** flex は JSON の中に差し込むので、そのままでは壊れる。文字列として安全な形にする。 */
export function escapeForJsonString(text: string): string {
  // JSON.stringify が付ける前後の " を外して、中身のエスケープだけを使う。
  return JSON.stringify(text).slice(1, -1);
}

/**
 * 自動返信の本文にある {{answers}} を、回答の一覧で置き換える。
 * {{answers}} が無ければ本文をそのまま返す。
 */
export function injectAnswers(
  content: string,
  fields: SummaryField[],
  data: Record<string, unknown>,
  messageType: 'text' | 'flex',
): string {
  if (!content.includes('{{answers}}')) return content;
  const summary = buildAnswerSummary(fields, data);
  const safe = messageType === 'flex' ? escapeForJsonString(summary) : summary;
  return content.split('{{answers}}').join(safe);
}

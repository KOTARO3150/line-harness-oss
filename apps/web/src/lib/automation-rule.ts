/**
 * オートメーションのルールを、画面の選択欄と保存形式のあいだで変換する。
 *
 * これまで管理画面はアクションと条件を「生の JSON を手書きするテキストエリア」で
 * しか編集できなかった。キー名（tagId / scenarioId / richMenuId …）はどこにも
 * 書かれておらず、実質は開発者専用の欄だった。リッチメニューの自動切替に至っては
 * ここにしか無い。
 *
 * ここで一番大事なのは **既存の設定を絶対に壊さないこと**。
 * 本番に手で組まれた設定が何件あるかは分かっていない。そのため:
 *
 *   - 保存形式は一切変えない（従来どおり actions は配列、conditions はオブジェクト）
 *   - 選択式で表せない中身は「表せない」と判定し、画面は JSON 編集に切り替える
 *   - 知らないキーが 1 つでもあれば表せない扱いにする（黙って捨てない）
 *
 * つまり、この層は変換であって移行ではない。
 */

export type FieldKind =
  | 'tag'
  | 'scenario'
  | 'template'
  | 'richMenu'
  | 'text'
  | 'textarea'
  | 'url'
  | 'number'

export interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  required?: boolean
  placeholder?: string
  help?: string
}

export interface ActionDef {
  type: string
  label: string
  help?: string
  fields: FieldDef[]
}

/**
 * 対応するアクション。worker の executeAction (services/event-bus.ts) の
 * switch と 1 対 1 で対応させること。ここに無いものは JSON 編集に回る。
 */
export const ACTION_DEFS: ActionDef[] = [
  {
    type: 'add_tag',
    label: 'タグを付ける',
    fields: [{ key: 'tagId', label: 'タグ', kind: 'tag', required: true }],
  },
  {
    type: 'remove_tag',
    label: 'タグを外す',
    fields: [{ key: 'tagId', label: 'タグ', kind: 'tag', required: true }],
  },
  {
    type: 'start_scenario',
    label: 'シナリオ配信を始める',
    fields: [{ key: 'scenarioId', label: 'シナリオ', kind: 'scenario', required: true }],
  },
  {
    type: 'send_message',
    label: 'メッセージを送る',
    help: 'テンプレートを選ぶと、そのテンプレートの内容が送られます（下の直接入力は無視されます）',
    fields: [
      { key: 'template_id', label: 'テンプレート', kind: 'template' },
      {
        key: 'messageType',
        label: '種類（直接入力のとき）',
        kind: 'text',
        placeholder: 'text / image / flex',
      },
      { key: 'content', label: '本文（直接入力のとき）', kind: 'textarea' },
      { key: 'altText', label: 'Flex の代替テキスト', kind: 'text' },
    ],
  },
  {
    type: 'switch_rich_menu',
    label: 'リッチメニューを切り替える',
    help: 'この人だけのリッチメニューを差し替えます（アカウント全体の既定より優先されます）',
    fields: [
      { key: 'richMenuId', label: 'リッチメニュー', kind: 'richMenu', required: true },
    ],
  },
  {
    type: 'remove_rich_menu',
    label: 'リッチメニューの個別指定を外す',
    help: 'アカウント全体の既定のメニューに戻ります',
    fields: [],
  },
  {
    type: 'set_metadata',
    label: '友だち情報欄に書き込む',
    help: '{{message}} と書くと、受信したメッセージ本文に置き換わります',
    fields: [
      {
        key: 'data',
        label: '書き込む内容（JSON）',
        kind: 'textarea',
        required: true,
        placeholder: '{"体質": "冷え"}',
        help: '項目名と値の組。既存の項目は上書きされ、書かなかった項目は残ります',
      },
    ],
  },
  {
    type: 'send_webhook',
    label: '外部へ通知する（Webhook）',
    fields: [
      { key: 'url', label: '送信先 URL', kind: 'url', required: true, placeholder: 'https://' },
    ],
  },
]

export interface ConditionDef {
  key: string
  label: string
  kind: FieldKind
  help?: string
  placeholder?: string
}

/**
 * 対応する条件。worker の matchConditions と 1 対 1。
 * 条件はオブジェクトで、書いた項目すべてを満たしたときだけ動く（AND）。
 */
export const CONDITION_DEFS: ConditionDef[] = [
  {
    key: 'tag_id',
    label: 'このタグに関する出来事のときだけ',
    kind: 'tag',
    help: 'タグ変更イベント向け',
  },
  {
    key: 'keyword',
    label: 'メッセージにこの言葉が含まれるときだけ',
    kind: 'text',
    placeholder: '予約',
  },
  {
    key: 'keyword_exact',
    label: 'メッセージがこの言葉と完全に同じときだけ',
    kind: 'text',
    placeholder: '予約',
  },
  {
    key: 'score_threshold',
    label: 'スコアがこの値以上のときだけ',
    kind: 'number',
    placeholder: '10',
  },
]

const ACTION_BY_TYPE = new Map(ACTION_DEFS.map((d) => [d.type, d]))
const CONDITION_BY_KEY = new Map(CONDITION_DEFS.map((d) => [d.key, d]))

export interface ActionDraft {
  type: string
  params: Record<string, string>
}

export type ConditionDraft = Record<string, string>

/** 選択式で表せるか。表せないものは JSON 編集に回す。 */
export function actionsAreEditable(actions: unknown): boolean {
  if (!Array.isArray(actions)) return false
  return actions.every((a) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false
    const row = a as { type?: unknown; params?: unknown }
    if (typeof row.type !== 'string') return false
    const def = ACTION_BY_TYPE.get(row.type)
    if (!def) return false
    if (row.params === undefined || row.params === null) return true
    if (typeof row.params !== 'object' || Array.isArray(row.params)) return false
    const known = new Set(def.fields.map((f) => f.key))
    return Object.entries(row.params as Record<string, unknown>).every(
      // 知らないキーがあれば選択式には出せない。出してしまうと保存時に消える。
      ([k, v]) => known.has(k) && (typeof v === 'string' || typeof v === 'number'),
    )
  })
}

export function conditionsAreEditable(conditions: unknown): boolean {
  if (conditions === null || conditions === undefined) return true
  if (typeof conditions !== 'object' || Array.isArray(conditions)) return false
  return Object.entries(conditions as Record<string, unknown>).every(
    ([k, v]) =>
      CONDITION_BY_KEY.has(k) &&
      (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
  )
}

/** 保存されている actions を画面用に分解する。表せない場合は空配列（呼出側が JSON へ切り替える）。 */
export function parseActions(actions: unknown): ActionDraft[] {
  if (!actionsAreEditable(actions)) return []
  return (actions as { type: string; params?: Record<string, unknown> }[]).map((a) => {
    const params: Record<string, string> = {}
    for (const [k, v] of Object.entries(a.params ?? {})) params[k] = String(v)
    return { type: a.type, params }
  })
}

export function parseConditions(conditions: unknown): ConditionDraft {
  if (!conditionsAreEditable(conditions)) return {}
  const out: ConditionDraft = {}
  for (const [k, v] of Object.entries((conditions ?? {}) as Record<string, unknown>)) {
    out[k] = String(v)
  }
  return out
}

/** 画面の入力から保存用の actions を組み立てる。空の項目は送らない。 */
export function buildActions(drafts: ActionDraft[]): { type: string; params: Record<string, string | number> }[] {
  return drafts.map((d) => {
    const def = ACTION_BY_TYPE.get(d.type)
    const params: Record<string, string | number> = {}
    for (const field of def?.fields ?? []) {
      const raw = d.params[field.key]
      if (raw === undefined || raw === '') continue
      params[field.key] = field.kind === 'number' ? Number(raw) : raw
    }
    return { type: d.type, params }
  })
}

export function buildConditions(draft: ConditionDraft): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const def of CONDITION_DEFS) {
    const raw = draft[def.key]
    if (raw === undefined || raw === '') continue
    out[def.key] = def.kind === 'number' ? Number(raw) : raw
  }
  return out
}

/** 保存前の検証。問題があれば日本語のメッセージ、なければ null。 */
export function validateActions(drafts: ActionDraft[]): string | null {
  if (drafts.length === 0) return 'アクションを1つ以上足してください'
  for (const [i, d] of drafts.entries()) {
    const def = ACTION_BY_TYPE.get(d.type)
    if (!def) return `${i + 1}番目のアクションの種類が不明です`
    for (const field of def.fields) {
      if (field.required && !(d.params[field.key] ?? '').trim()) {
        return `${i + 1}番目「${def.label}」の${field.label}を選んでください`
      }
    }
    if (d.type === 'set_metadata') {
      const raw = (d.params.data ?? '').trim()
      // {{message}} は保存時点では JSON として不正なので、検証の前に外しておく。
      const probe = raw.replace(/\{\{message\}\}/g, 'x')
      try {
        const parsed = JSON.parse(probe) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return `${i + 1}番目「友だち情報欄に書き込む」の内容は {"項目名": "値"} の形にしてください`
        }
      } catch {
        return `${i + 1}番目「友だち情報欄に書き込む」の JSON が正しくありません`
      }
    }
    if (d.type === 'send_message') {
      const hasTemplate = !!(d.params.template_id ?? '').trim()
      const hasContent = !!(d.params.content ?? '').trim()
      if (!hasTemplate && !hasContent) {
        return `${i + 1}番目「メッセージを送る」はテンプレートか本文のどちらかが要ります`
      }
    }
  }
  return null
}

export function validateConditions(draft: ConditionDraft): string | null {
  const raw = draft.score_threshold
  if (raw !== undefined && raw !== '' && !Number.isFinite(Number(raw))) {
    return 'スコアの閾値は数字で入れてください'
  }
  return null
}

/** 一覧に出す 1 行の説明文。JSON を読まなくても何をするルールか分かるように。 */
export function describeAction(
  action: { type: string; params?: Record<string, unknown> },
  lookup: {
    tags?: { id: string; name: string }[]
    scenarios?: { id: string; name: string }[]
    templates?: { id: string; name: string }[]
    richMenus?: { richMenuId: string; name: string }[]
  } = {},
): string {
  const def = ACTION_BY_TYPE.get(action.type)
  const p = (action.params ?? {}) as Record<string, unknown>
  const nameOf = (list: { id: string; name: string }[] | undefined, id: unknown) =>
    list?.find((x) => x.id === id)?.name ?? (id ? `(不明: ${String(id).slice(0, 8)})` : '(未設定)')

  switch (action.type) {
    case 'add_tag':
      return `タグ「${nameOf(lookup.tags, p.tagId)}」を付ける`
    case 'remove_tag':
      return `タグ「${nameOf(lookup.tags, p.tagId)}」を外す`
    case 'start_scenario':
      return `シナリオ「${nameOf(lookup.scenarios, p.scenarioId)}」を始める`
    case 'send_message':
      return p.template_id
        ? `テンプレート「${nameOf(lookup.templates, p.template_id)}」を送る`
        : 'メッセージを送る'
    case 'switch_rich_menu': {
      const name =
        lookup.richMenus?.find((m) => m.richMenuId === p.richMenuId)?.name ??
        (p.richMenuId ? `(不明: ${String(p.richMenuId).slice(0, 12)})` : '(未設定)')
      return `リッチメニューを「${name}」に切り替える`
    }
    case 'remove_rich_menu':
      return 'リッチメニューの個別指定を外す'
    case 'set_metadata':
      return '友だち情報欄に書き込む'
    case 'send_webhook':
      return `外部へ通知する（${String(p.url ?? '未設定')}）`
    default:
      return def?.label ?? `不明なアクション: ${action.type}`
  }
}

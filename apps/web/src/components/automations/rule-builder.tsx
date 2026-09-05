'use client'

import { useMemo, useState } from 'react'
import {
  ACTION_DEFS,
  CONDITION_DEFS,
  actionsAreEditable,
  conditionsAreEditable,
  parseActions,
  parseConditions,
  buildActions,
  buildConditions,
  validateActions,
  validateConditions,
  type ActionDraft,
  type ConditionDraft,
  type FieldDef,
  type FieldKind,
} from '@/lib/automation-rule'

/**
 * オートメーションのアクションと条件を、選択式で組み立てる。
 *
 * 選択式で表せない中身（見覚えのないアクションや、余分なキーを持つ params）は
 * 触らずに JSON 編集へ切り替える。本番に手で組まれた設定が何件あるか分からない以上、
 * 「読めないものは黙って書き換えない」を最優先にしている。
 */

export interface RuleValue {
  actions: unknown
  conditions: unknown
}

export interface LookupLists {
  tags: { id: string; name: string }[]
  scenarios: { id: string; name: string }[]
  templates: { id: string; name: string }[]
  richMenus: { richMenuId: string; name: string }[]
}

interface Props {
  value: RuleValue
  onChange: (next: RuleValue) => void
  lookup: LookupLists
  /** 保存前の検証結果を親へ返す。null なら問題なし。 */
  onValidityChange?: (error: string | null) => void
}

function pretty(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback), null, 2)
  } catch {
    return fallback
  }
}

export default function RuleBuilder({ value, onChange, lookup, onValidityChange }: Props) {
  // 開いた時点で表せるかを見て、初期モードを決める。
  const initiallyEditable =
    actionsAreEditable(value.actions) && conditionsAreEditable(value.conditions)

  const [mode, setMode] = useState<'visual' | 'json'>(initiallyEditable ? 'visual' : 'json')
  const [actionsJson, setActionsJson] = useState(() => pretty(value.actions, '[]'))
  const [conditionsJson, setConditionsJson] = useState(() => pretty(value.conditions, '{}'))
  const [jsonError, setJsonError] = useState('')

  const actionDrafts = useMemo<ActionDraft[]>(() => parseActions(value.actions), [value.actions])
  const conditionDraft = useMemo<ConditionDraft>(
    () => parseConditions(value.conditions),
    [value.conditions],
  )

  const report = (next: RuleValue) => {
    onChange(next)
    if (!onValidityChange) return
    if (!actionsAreEditable(next.actions) || !conditionsAreEditable(next.conditions)) {
      // JSON 編集で作られた形はここでは検証しない（保存時に worker が受け取る）。
      onValidityChange(null)
      return
    }
    onValidityChange(
      validateActions(parseActions(next.actions)) ??
        validateConditions(parseConditions(next.conditions)),
    )
  }

  const setDrafts = (drafts: ActionDraft[]) => {
    report({ actions: buildActions(drafts), conditions: value.conditions })
  }

  const setCondition = (key: string, raw: string) => {
    const next = { ...conditionDraft, [key]: raw }
    report({ actions: value.actions, conditions: buildConditions(next) })
  }

  const applyJson = () => {
    let parsedActions: unknown
    let parsedConditions: unknown
    try {
      parsedActions = JSON.parse(actionsJson)
    } catch {
      setJsonError('アクションの JSON が正しくありません')
      return
    }
    try {
      parsedConditions = JSON.parse(conditionsJson)
    } catch {
      setJsonError('条件の JSON が正しくありません')
      return
    }
    if (!Array.isArray(parsedActions)) {
      setJsonError('アクションは [ ] で囲んだ配列にしてください')
      return
    }
    setJsonError('')
    report({ actions: parsedActions, conditions: parsedConditions })
  }

  const switchToVisual = () => {
    if (!actionsAreEditable(value.actions) || !conditionsAreEditable(value.conditions)) {
      setJsonError('今の内容は選択式で表せません。JSON のまま編集してください')
      return
    }
    setJsonError('')
    setMode('visual')
  }

  const switchToJson = () => {
    setActionsJson(pretty(value.actions, '[]'))
    setConditionsJson(pretty(value.conditions, '{}'))
    setJsonError('')
    setMode('json')
  }

  const renderField = (draft: ActionDraft, index: number, field: FieldDef) => {
    const val = draft.params[field.key] ?? ''
    const update = (v: string) => {
      const next = actionDrafts.map((d, i) =>
        i === index ? { ...d, params: { ...d.params, [field.key]: v } } : d,
      )
      setDrafts(next)
    }

    const selectOptions: { value: string; label: string }[] | null =
      field.kind === 'tag'
        ? lookup.tags.map((t) => ({ value: t.id, label: t.name }))
        : field.kind === 'scenario'
          ? lookup.scenarios.map((s) => ({ value: s.id, label: s.name }))
          : field.kind === 'template'
            ? lookup.templates.map((t) => ({ value: t.id, label: t.name }))
            : field.kind === 'richMenu'
              ? lookup.richMenus.map((m) => ({ value: m.richMenuId, label: m.name }))
              : null

    return (
      <div key={field.key}>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {field.label}
          {field.required && <span className="text-red-500"> *</span>}
        </label>
        {selectOptions ? (
          <>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              value={val}
              onChange={(e) => update(e.target.value)}
            >
              <option value="">-- 選択してください --</option>
              {selectOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {/* 一覧に無い ID が保存されている場合も、選択を失わないように残す */}
              {val && !selectOptions.some((o) => o.value === val) && (
                <option value={val}>(一覧にない: {val.slice(0, 12)})</option>
              )}
            </select>
            {selectOptions.length === 0 && (
              <p className="text-xs text-amber-700 mt-0.5">
                選べるものがまだありません。先に作成してください
              </p>
            )}
          </>
        ) : field.kind === 'textarea' ? (
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono resize-y"
            rows={3}
            placeholder={field.placeholder}
            value={val}
            onChange={(e) => update(e.target.value)}
          />
        ) : (
          <input
            type={field.kind === 'number' ? 'number' : 'text'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder={field.placeholder}
            value={val}
            onChange={(e) => update(e.target.value)}
          />
        )}
        {field.help && <p className="text-xs text-gray-400 mt-0.5">{field.help}</p>}
      </div>
    )
  }

  if (mode === 'json') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-700">アクションと条件（JSON）</h4>
          <button
            type="button"
            onClick={switchToVisual}
            className="text-xs text-blue-600 hover:underline"
          >
            選択式で編集する
          </button>
        </div>
        {!initiallyEditable && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            この設定には選択式で表せない項目が入っています。中身を勝手に書き換えないよう、
            JSON のまま開いています。
          </p>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">アクション</label>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono resize-y"
            rows={8}
            value={actionsJson}
            onChange={(e) => setActionsJson(e.target.value)}
            onBlur={applyJson}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">条件</label>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono resize-y"
            rows={4}
            value={conditionsJson}
            onChange={(e) => setConditionsJson(e.target.value)}
            onBlur={applyJson}
          />
        </div>
        {jsonError && <p className="text-xs text-red-600">{jsonError}</p>}
        <button
          type="button"
          onClick={applyJson}
          className="px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          JSON を反映する
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-700">何をするか（アクション）</h4>
        <button
          type="button"
          onClick={switchToJson}
          className="text-xs text-gray-500 hover:underline"
        >
          JSON で編集する
        </button>
      </div>

      {actionDrafts.length === 0 && (
        <p className="text-xs text-gray-400">アクションがまだありません</p>
      )}

      <div className="space-y-3">
        {actionDrafts.map((draft, index) => {
          const def = ACTION_DEFS.find((d) => d.type === draft.type)
          return (
            <div key={index} className="border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 shrink-0">{index + 1}.</span>
                <select
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={draft.type}
                  onChange={(e) =>
                    // 種類を変えたら params は捨てる（別のアクションのキーが残ると保存で消える）
                    setDrafts(
                      actionDrafts.map((d, i) =>
                        i === index ? { type: e.target.value, params: {} } : d,
                      ),
                    )
                  }
                >
                  {ACTION_DEFS.map((d) => (
                    <option key={d.type} value={d.type}>{d.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setDrafts(actionDrafts.filter((_, i) => i !== index))}
                  className="px-2 py-1 text-xs text-gray-400 hover:text-red-600"
                  aria-label="このアクションを消す"
                >
                  ×
                </button>
              </div>
              {def?.help && <p className="text-xs text-gray-400">{def.help}</p>}
              {def?.fields.map((field) => renderField(draft, index, field))}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => setDrafts([...actionDrafts, { type: ACTION_DEFS[0].type, params: {} }])}
        className="text-xs text-blue-600 hover:underline"
      >
        + アクションを足す
      </button>

      <div className="pt-3 border-t border-gray-200 space-y-2">
        <h4 className="text-xs font-semibold text-gray-700">いつだけ動かすか（条件）</h4>
        <p className="text-xs text-gray-400">
          書いた項目をすべて満たしたときだけ動きます。空欄の項目は無視されます。
        </p>
        {CONDITION_DEFS.map((def) => (
          <div key={def.key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{def.label}</label>
            {def.kind === 'tag' ? (
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                value={conditionDraft[def.key] ?? ''}
                onChange={(e) => setCondition(def.key, e.target.value)}
              >
                <option value="">-- 指定しない --</option>
                {lookup.tags.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            ) : (
              <input
                type={def.kind === 'number' ? 'number' : 'text'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder={def.placeholder}
                value={conditionDraft[def.key] ?? ''}
                onChange={(e) => setCondition(def.key, e.target.value)}
              />
            )}
            {def.help && <p className="text-xs text-gray-400 mt-0.5">{def.help}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

export type { FieldKind }

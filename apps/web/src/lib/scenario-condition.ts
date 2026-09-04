import type { ScenarioStep, ScenarioStepConditionType } from '@line-crm/shared'

/**
 * シナリオステップの分岐条件を、画面の入力欄と保存形式のあいだで変換する。
 *
 * エンジン (worker の services/step-delivery.ts) は以前から分岐に対応していたが、
 * 画面に入力欄が無く、API を直接叩ける人しか使えなかった。
 *
 * 保存形式:
 *   tag_exists / tag_not_exists     → conditionValue = タグID（ただの文字列）
 *   metadata_equals / _not_equals   → conditionValue = {"key":"...","value":...} の JSON
 *
 * worker 側は conditionType が設定されているのに conditionValue が空だと 400 を返し、
 * metadata_* の JSON 形をも検証する。ここはその形を必ず満たすように組み立てる。
 */

export const conditionOptions: { value: ScenarioStepConditionType | ''; label: string }[] = [
  { value: '', label: '条件なし（必ず配信する）' },
  { value: 'tag_exists', label: 'このタグが付いている人だけ' },
  { value: 'tag_not_exists', label: 'このタグが付いていない人だけ' },
  { value: 'metadata_equals', label: '友だち情報欄が この値 と同じ人だけ' },
  { value: 'metadata_not_equals', label: '友だち情報欄が この値 と違う人だけ' },
]

export function isMetadataCondition(
  t: ScenarioStepConditionType | '' | null | undefined,
): boolean {
  return t === 'metadata_equals' || t === 'metadata_not_equals'
}

export interface ConditionFields {
  tagId: string | null
  metaKey: string
  metaValue: string
}

const EMPTY: ConditionFields = { tagId: null, metaKey: '', metaValue: '' }

/**
 * 保存されている conditionValue を画面用に分解する。
 * 壊れた JSON や欠けた項目でも例外を投げない — 編集不能にしてしまうと直す手段が無くなる。
 */
export function parseConditionValue(
  conditionType: ScenarioStepConditionType | '' | null | undefined,
  conditionValue: string | null | undefined,
): ConditionFields {
  if (!conditionType || !conditionValue) return { ...EMPTY }
  if (!isMetadataCondition(conditionType)) return { ...EMPTY, tagId: conditionValue }
  try {
    const parsed = JSON.parse(conditionValue) as { key?: unknown; value?: unknown }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY }
    return {
      tagId: null,
      metaKey: typeof parsed.key === 'string' ? parsed.key : '',
      metaValue:
        parsed.value === undefined || parsed.value === null ? '' : String(parsed.value),
    }
  } catch {
    return { ...EMPTY }
  }
}

/** 画面の入力欄から保存用の conditionValue を組み立てる。条件なしなら null。 */
export function buildConditionValue(
  conditionType: ScenarioStepConditionType | '',
  fields: ConditionFields,
): string | null {
  if (!conditionType) return null
  if (isMetadataCondition(conditionType)) {
    return JSON.stringify({ key: fields.metaKey.trim(), value: fields.metaValue })
  }
  return fields.tagId
}

/** 保存前の検証。問題があれば日本語のメッセージ、なければ null。 */
export function validateCondition(input: {
  conditionType: ScenarioStepConditionType | ''
  fields: ConditionFields
  stepOrder: number
  nextStepOnFalse: number | null
}): string | null {
  if (!input.conditionType) return null
  if (isMetadataCondition(input.conditionType)) {
    if (!input.fields.metaKey.trim()) {
      return '条件に使う友だち情報欄の項目名を入れてください'
    }
  } else if (!input.fields.tagId) {
    return '条件に使うタグを選んでください'
  }
  if (input.nextStepOnFalse !== null && input.nextStepOnFalse === input.stepOrder) {
    return '条件に合わないときの飛び先が、このステップ自身になっています'
  }
  return null
}

/** 一覧に出す条件の説明文。編集画面を開かなくても分岐が見えるように。 */
export function describeCondition(
  step: Pick<ScenarioStep, 'conditionType' | 'conditionValue'>,
  tags: { id: string; name: string }[],
): string {
  if (!step.conditionType) return ''
  const parsed = parseConditionValue(step.conditionType, step.conditionValue)
  if (isMetadataCondition(step.conditionType)) {
    const verb = step.conditionType === 'metadata_equals' ? '＝' : '≠'
    return `${parsed.metaKey || '(項目未設定)'} ${verb} ${parsed.metaValue || '(空)'}`
  }
  const name = tags.find((t) => t.id === parsed.tagId)?.name ?? '(不明なタグ)'
  return step.conditionType === 'tag_exists'
    ? `${name} が付いている`
    : `${name} が付いていない`
}

import { describe, expect, it } from 'vitest'
import {
  isMetadataCondition,
  parseConditionValue,
  buildConditionValue,
  validateCondition,
  describeCondition,
} from './scenario-condition'

const tags = [
  { id: 't1', name: '初回相談' },
  { id: 't2', name: '要フォロー' },
]

describe('タグ条件', () => {
  it('保存形式はタグ ID そのもの', () => {
    expect(
      buildConditionValue('tag_exists', { tagId: 't1', metaKey: '', metaValue: '' }),
    ).toBe('t1')
  })

  it('読み戻すとタグ ID に分解される', () => {
    expect(parseConditionValue('tag_exists', 't1')).toEqual({
      tagId: 't1',
      metaKey: '',
      metaValue: '',
    })
  })

  it('往復しても壊れない', () => {
    const fields = { tagId: 't2', metaKey: '', metaValue: '' }
    const stored = buildConditionValue('tag_not_exists', fields)
    expect(parseConditionValue('tag_not_exists', stored)).toEqual(fields)
  })

  it('説明文にタグ名が出る', () => {
    expect(
      describeCondition({ conditionType: 'tag_exists', conditionValue: 't1' }, tags),
    ).toBe('初回相談 が付いている')
    expect(
      describeCondition({ conditionType: 'tag_not_exists', conditionValue: 't2' }, tags),
    ).toBe('要フォロー が付いていない')
  })

  it('消されたタグを指していても説明文は出す（編集の手がかりになる）', () => {
    expect(
      describeCondition({ conditionType: 'tag_exists', conditionValue: 'gone' }, tags),
    ).toBe('(不明なタグ) が付いている')
  })
})

describe('友だち情報欄の条件', () => {
  it('保存形式は {key, value} の JSON', () => {
    const stored = buildConditionValue('metadata_equals', {
      tagId: null,
      metaKey: '体質',
      metaValue: '冷え',
    })
    expect(JSON.parse(stored!)).toEqual({ key: '体質', value: '冷え' })
  })

  it('項目名の前後の空白は落とす', () => {
    const stored = buildConditionValue('metadata_equals', {
      tagId: null,
      metaKey: '  体質  ',
      metaValue: '冷え',
    })
    expect(JSON.parse(stored!).key).toBe('体質')
  })

  it('往復しても壊れない', () => {
    const fields = { tagId: null, metaKey: '体質', metaValue: '冷え' }
    const stored = buildConditionValue('metadata_not_equals', fields)
    expect(parseConditionValue('metadata_not_equals', stored)).toEqual(fields)
  })

  it('値が空でも保存できる（「未記入の人だけ」を作れる）', () => {
    const stored = buildConditionValue('metadata_equals', {
      tagId: null,
      metaKey: '体質',
      metaValue: '',
    })
    expect(JSON.parse(stored!)).toEqual({ key: '体質', value: '' })
  })

  it('数値で保存されていても文字列として読める', () => {
    expect(parseConditionValue('metadata_equals', '{"key":"年齢","value":60}')).toEqual({
      tagId: null,
      metaKey: '年齢',
      metaValue: '60',
    })
  })

  it('壊れた JSON でも例外を投げず空で返す（編集不能にしない）', () => {
    expect(parseConditionValue('metadata_equals', '{壊れている')).toEqual({
      tagId: null,
      metaKey: '',
      metaValue: '',
    })
  })

  it('配列が入っていても空で返す', () => {
    expect(parseConditionValue('metadata_equals', '["a"]')).toEqual({
      tagId: null,
      metaKey: '',
      metaValue: '',
    })
  })

  it('説明文は項目名と値を並べる', () => {
    expect(
      describeCondition(
        { conditionType: 'metadata_equals', conditionValue: '{"key":"体質","value":"冷え"}' },
        tags,
      ),
    ).toBe('体質 ＝ 冷え')
  })
})

describe('条件なし', () => {
  it('保存値は null', () => {
    expect(buildConditionValue('', { tagId: 't1', metaKey: 'a', metaValue: 'b' })).toBeNull()
  })

  it('分解しても空', () => {
    expect(parseConditionValue('', 'なにか')).toEqual({
      tagId: null,
      metaKey: '',
      metaValue: '',
    })
  })

  it('説明文は空', () => {
    expect(describeCondition({ conditionType: null, conditionValue: null }, tags)).toBe('')
  })

  it('検証は素通り', () => {
    expect(
      validateCondition({
        conditionType: '',
        fields: { tagId: null, metaKey: '', metaValue: '' },
        stepOrder: 1,
        nextStepOnFalse: null,
      }),
    ).toBeNull()
  })
})

describe('保存前の検証', () => {
  const base = { stepOrder: 2, nextStepOnFalse: null as number | null }

  it('タグ条件でタグ未選択はエラー', () => {
    expect(
      validateCondition({
        ...base,
        conditionType: 'tag_exists',
        fields: { tagId: null, metaKey: '', metaValue: '' },
      }),
    ).toContain('タグ')
  })

  it('情報欄条件で項目名が空はエラー', () => {
    expect(
      validateCondition({
        ...base,
        conditionType: 'metadata_equals',
        fields: { tagId: null, metaKey: '   ', metaValue: '冷え' },
      }),
    ).toContain('項目名')
  })

  it('飛び先が自分自身ならエラー（その場で止まってしまうため）', () => {
    expect(
      validateCondition({
        conditionType: 'tag_exists',
        fields: { tagId: 't1', metaKey: '', metaValue: '' },
        stepOrder: 2,
        nextStepOnFalse: 2,
      }),
    ).toContain('このステップ自身')
  })

  it('揃っていれば通る', () => {
    expect(
      validateCondition({
        conditionType: 'tag_exists',
        fields: { tagId: 't1', metaKey: '', metaValue: '' },
        stepOrder: 2,
        nextStepOnFalse: 5,
      }),
    ).toBeNull()
  })
})

describe('isMetadataCondition', () => {
  it('metadata_* だけ true', () => {
    expect(isMetadataCondition('metadata_equals')).toBe(true)
    expect(isMetadataCondition('metadata_not_equals')).toBe(true)
    expect(isMetadataCondition('tag_exists')).toBe(false)
    expect(isMetadataCondition('')).toBe(false)
    expect(isMetadataCondition(null)).toBe(false)
  })
})

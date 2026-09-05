import { describe, expect, it } from 'vitest'
import {
  ACTION_DEFS,
  actionsAreEditable,
  conditionsAreEditable,
  parseActions,
  parseConditions,
  buildActions,
  buildConditions,
  validateActions,
  validateConditions,
  describeAction,
} from './automation-rule'

const tags = [{ id: 't1', name: '初回相談' }]
const scenarios = [{ id: 's1', name: '初回フォロー' }]
const templates = [{ id: 'tpl1', name: 'お礼メッセージ' }]
const richMenus = [{ richMenuId: 'richmenu-abc', name: '通常メニュー' }]

describe('選択式で表せるかの判定', () => {
  it('知っているアクションだけなら表せる', () => {
    expect(
      actionsAreEditable([
        { type: 'add_tag', params: { tagId: 't1' } },
        { type: 'remove_rich_menu', params: {} },
      ]),
    ).toBe(true)
  })

  it('params が無くても表せる', () => {
    expect(actionsAreEditable([{ type: 'remove_rich_menu' }])).toBe(true)
  })

  it('知らないアクションがあれば表せない', () => {
    expect(actionsAreEditable([{ type: 'do_something_new', params: {} }])).toBe(false)
  })

  it('知らないキーが混じっていれば表せない（黙って捨てないため）', () => {
    expect(
      actionsAreEditable([{ type: 'add_tag', params: { tagId: 't1', extra: 'x' } }]),
    ).toBe(false)
  })

  it('入れ子のオブジェクトが値なら表せない', () => {
    expect(
      actionsAreEditable([{ type: 'add_tag', params: { tagId: { nested: true } } }]),
    ).toBe(false)
  })

  it('配列でなければ表せない', () => {
    expect(actionsAreEditable({ type: 'add_tag' })).toBe(false)
    expect(actionsAreEditable(null)).toBe(false)
  })

  it('空の配列は表せる（新規作成の初期状態）', () => {
    expect(actionsAreEditable([])).toBe(true)
  })

  it('条件は知っているキーだけなら表せる', () => {
    expect(conditionsAreEditable({ keyword: '予約', score_threshold: 10 })).toBe(true)
    expect(conditionsAreEditable({})).toBe(true)
    expect(conditionsAreEditable(null)).toBe(true)
  })

  it('知らない条件キーがあれば表せない', () => {
    expect(conditionsAreEditable({ future_condition: 'x' })).toBe(false)
  })
})

describe('往復（保存 → 画面 → 保存）', () => {
  it('タグ付けは値が変わらない', () => {
    const stored = [{ type: 'add_tag', params: { tagId: 't1' } }]
    expect(buildActions(parseActions(stored))).toEqual(stored)
  })

  it('複数のアクションが順番どおり保たれる', () => {
    const stored = [
      { type: 'add_tag', params: { tagId: 't1' } },
      { type: 'switch_rich_menu', params: { richMenuId: 'richmenu-abc' } },
      { type: 'start_scenario', params: { scenarioId: 's1' } },
    ]
    expect(buildActions(parseActions(stored))).toEqual(stored)
  })

  it('params の無いアクションは空の params で保存される', () => {
    expect(buildActions(parseActions([{ type: 'remove_rich_menu' }]))).toEqual([
      { type: 'remove_rich_menu', params: {} },
    ])
  })

  it('数値で保存されている条件は数値のまま戻る', () => {
    const stored = { score_threshold: 10 }
    expect(buildConditions(parseConditions(stored))).toEqual(stored)
  })

  it('空にした項目は保存に含めない', () => {
    const built = buildActions([
      { type: 'send_message', params: { template_id: 'tpl1', content: '', altText: '' } },
    ])
    expect(built).toEqual([{ type: 'send_message', params: { template_id: 'tpl1' } }])
  })
})

describe('保存前の検証', () => {
  it('アクションが空ならエラー', () => {
    expect(validateActions([])).toContain('1つ以上')
  })

  it('必須の選択が空ならエラー', () => {
    expect(validateActions([{ type: 'add_tag', params: {} }])).toContain('タグ')
  })

  it('リッチメニュー未選択はエラー', () => {
    expect(validateActions([{ type: 'switch_rich_menu', params: {} }])).toContain(
      'リッチメニュー',
    )
  })

  it('外すだけのアクションは必須項目なしで通る', () => {
    expect(validateActions([{ type: 'remove_rich_menu', params: {} }])).toBeNull()
  })

  it('メッセージはテンプレートか本文のどちらかが要る', () => {
    expect(validateActions([{ type: 'send_message', params: {} }])).toContain(
      'テンプレートか本文',
    )
    expect(
      validateActions([{ type: 'send_message', params: { content: 'こんにちは' } }]),
    ).toBeNull()
    expect(
      validateActions([{ type: 'send_message', params: { template_id: 'tpl1' } }]),
    ).toBeNull()
  })

  it('友だち情報欄の JSON が壊れていればエラー', () => {
    expect(
      validateActions([{ type: 'set_metadata', params: { data: '{壊れている' } }]),
    ).toContain('JSON')
  })

  it('{{message}} が入っていても検証を通す', () => {
    expect(
      validateActions([
        { type: 'set_metadata', params: { data: '{"最後の相談": "{{message}}"}' } },
      ]),
    ).toBeNull()
  })

  it('友だち情報欄に配列を書いたらエラー', () => {
    expect(
      validateActions([{ type: 'set_metadata', params: { data: '["a"]' } }]),
    ).toContain('形にしてください')
  })

  it('スコアの閾値が数字でなければエラー', () => {
    expect(validateConditions({ score_threshold: 'たくさん' })).toContain('数字')
    expect(validateConditions({ score_threshold: '10' })).toBeNull()
    expect(validateConditions({})).toBeNull()
  })
})

describe('一覧の説明文', () => {
  const lookup = { tags, scenarios, templates, richMenus }

  it('タグ名で出る', () => {
    expect(describeAction({ type: 'add_tag', params: { tagId: 't1' } }, lookup)).toBe(
      'タグ「初回相談」を付ける',
    )
  })

  it('リッチメニュー名で出る', () => {
    expect(
      describeAction(
        { type: 'switch_rich_menu', params: { richMenuId: 'richmenu-abc' } },
        lookup,
      ),
    ).toBe('リッチメニューを「通常メニュー」に切り替える')
  })

  it('消えた参照先でも説明文は出す', () => {
    expect(describeAction({ type: 'add_tag', params: { tagId: 'gone' } }, lookup)).toContain(
      '不明',
    )
  })

  it('参照先の一覧が無くても落ちない', () => {
    expect(describeAction({ type: 'add_tag', params: { tagId: 't1' } })).toContain('不明')
  })

  it('知らないアクションでも文字列を返す', () => {
    expect(describeAction({ type: 'future_action' }, lookup)).toContain('future_action')
  })
})

describe('定義の健全性', () => {
  it('アクションの type が重複していない', () => {
    const types = ACTION_DEFS.map((d) => d.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('必須の項目には kind が付いている', () => {
    for (const def of ACTION_DEFS) {
      for (const f of def.fields) {
        expect(f.kind).toBeTruthy()
        expect(f.label).toBeTruthy()
      }
    }
  })
})

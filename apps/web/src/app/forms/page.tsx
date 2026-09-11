'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import Header from '@/components/layout/header'
import { api, fetchApi, type FriendListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type FieldType = 'text' | 'tel' | 'email' | 'number' | 'textarea' | 'date' | 'select' | 'radio' | 'quantity'
type ChartTarget = '' | 'customer_name' | 'customer_name_kana' | 'birth_date' | 'phone' | 'allergies' | 'current_medications' | 'safety_notes' | 'general_notes' | 'chief_complaint' | 'observations' | 'recommendation' | 'products' | 'usage_instructions' | 'follow_up_plan'
type TagRuleOperator = 'equals' | 'contains' | 'not_empty'

interface TagRule {
  operator: TagRuleOperator
  value: string
  tagId: string
}

interface FormField {
  name: string
  label: string
  type: FieldType
  required: boolean
  placeholder?: string
  options?: string[]
  chartTarget?: ChartTarget
  tagRules?: TagRule[]
  /** type: 'quantity' のときの単価（円）。未入力なら金額を出さず個数だけ聞く。 */
  unitPrice?: number
  /** type: 'quantity' で選べる最大個数。既定 10。 */
  maxQuantity?: number
}

interface HarnessForm {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  onSubmitTagId: string | null
  onSubmitMessageType: 'text' | 'flex' | null
  onSubmitMessageContent: string | null
  submitCount: number
  isActive: boolean
}

const initialFields: FormField[] = [
  { name: 'full_name', label: 'お名前', type: 'text', required: true, placeholder: '山田 太郎', chartTarget: 'customer_name' },
  { name: 'birth_date', label: '生年月日', type: 'date', required: true, chartTarget: 'birth_date' },
  { name: 'consultation', label: '今いちばん気になっていること', type: 'textarea', required: true, placeholder: 'うまくまとまっていなくても大丈夫です。', chartTarget: 'chief_complaint' },
  { name: 'consultation_method', label: 'ご希望の相談方法', type: 'radio', required: true, options: ['店頭相談', 'LINE相談', '電話相談', 'オンライン相談'], chartTarget: 'general_notes' },
  { name: 'preferred_datetime', label: 'ご希望の日時（第1・第2希望）', type: 'textarea', required: false, placeholder: '例：8月20日 午後、8月22日 14時以降', chartTarget: 'follow_up_plan' },
]

const fieldTypeLabels: Record<FieldType, string> = {
  text: '一行入力',
  tel: '電話番号',
  email: 'メールアドレス',
  number: '数値',
  textarea: '長文入力',
  date: '日付',
  select: '選択リスト',
  radio: 'ひとつ選択',
  quantity: '商品の個数（予約表）',
}

// 予約表のひな形。
// 「何を何個」だけで予約表として成立するので、単価は空のままでも使える。
// 単価を入れた商品があるときだけ、お客様の画面に合計金額が出る。
const orderPresetDescription = 'ご希望の商品と個数をお選びください。入荷しましたらこちらのLINEでご連絡します。'
const orderPresetReply = `ご予約ありがとうございます。
下記の内容でお受けしました。

{{answers}}

入荷しましたら、こちらの LINE でご連絡します。
お渡しはお店で、お支払いもそのときで大丈夫です。

鈴木薬舗`

const orderPresetFields: FormField[] = [
  { name: 'customer_name', label: 'お名前', type: 'text', required: true, placeholder: '鈴木 太郎', chartTarget: 'customer_name' },
  { name: 'phone', label: '電話番号', type: 'tel', required: true, placeholder: '090-1234-5678', chartTarget: 'phone' },
  { name: 'item_1', label: '商品１', type: 'quantity', required: false, maxQuantity: 10 },
  { name: 'item_2', label: '商品２', type: 'quantity', required: false, maxQuantity: 10 },
  { name: 'item_3', label: '商品３', type: 'quantity', required: false, maxQuantity: 10 },
  { name: 'note', label: '通信欄', type: 'textarea', required: false, placeholder: 'ご予約品やお伝えすることがあればご記入ください。' },
]

const chartTargetLabels: Array<[ChartTarget, string]> = [
  ['', 'カルテへは自動整理しない'],
  ['customer_name', '基本カルテ：氏名'], ['customer_name_kana', '基本カルテ：ふりがな'],
  ['birth_date', '基本カルテ：生年月日'], ['phone', '基本カルテ：電話番号'],
  ['allergies', '基本カルテ：アレルギー・禁忌'], ['current_medications', '基本カルテ：使用中の医薬品'],
  ['safety_notes', '基本カルテ：注意事項'], ['general_notes', '基本カルテ：基本メモ'],
  ['chief_complaint', '相談記録：主な相談内容'], ['observations', '相談記録：観察・聞き取り'],
  ['recommendation', '相談記録：提案内容'], ['products', '相談記録：商品・処方内容'],
  ['usage_instructions', '相談記録：使用方法'], ['follow_up_plan', '相談記録：フォロー計画'],
]

export default function FormsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [forms, setForms] = useState<HarnessForm[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [name, setName] = useState('相談前のかんたん確認フォーム')
  const [description, setDescription] = useState('うまく説明できなくても大丈夫です。分かる範囲でお知らせください。')
  const [selectedTagId, setSelectedTagId] = useState('')
  const [newTagName, setNewTagName] = useState('相談希望')
  const [fields, setFields] = useState<FormField[]>(initialFields)
  const [replyMessage, setReplyMessage] = useState('')
  const [replyType, setReplyType] = useState<'text' | 'flex'>('text')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingActive, setEditingActive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copiedFormId, setCopiedFormId] = useState<string | null>(null)
  const [sendForm, setSendForm] = useState<HarnessForm | null>(null)
  const [friendSearch, setFriendSearch] = useState('')
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [sendMessage, setSendMessage] = useState('')
  const [friendLoading, setFriendLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [previewForm, setPreviewForm] = useState<HarnessForm | null>(null)
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [formsRes, tagsRes] = await Promise.all([
        fetchApi<{ success: boolean; data: HarnessForm[] }>('/api/forms'),
        api.tags.list(),
      ])
      if (formsRes.success) setForms(formsRes.data)
      if (tagsRes.success) setTags(tagsRes.data)
    } catch {
      setError('フォームとタグの読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const formUrl = (formId: string) => selectedAccount?.liffId
    ? `https://liff.line.me/${selectedAccount.liffId}?page=form&id=${encodeURIComponent(formId)}`
    : ''

  const copyFormUrl = async (form: HarnessForm) => {
    const url = formUrl(form.id)
    if (!url) {
      setError('選択中のLINEアカウントにLIFF IDが設定されていません。LINEアカウント設定から登録してください。')
      return
    }
    await navigator.clipboard.writeText(url)
    setCopiedFormId(form.id)
    window.setTimeout(() => setCopiedFormId(null), 2000)
  }

  const openSend = async (form: HarnessForm) => {
    const url = formUrl(form.id)
    if (!url) {
      setError('送信には、選択中のLINEアカウントのLIFF ID設定が必要です。')
      return
    }
    setSendForm(form)
    setSelectedFriendId('')
    setFriendSearch('')
    setSendMessage(`ご相談フォームをお送りします。\n以下からご入力ください。\n${url}`)
    setFriendLoading(true)
    try {
      const response = await api.friends.list({
        accountId: selectedAccountId || undefined,
        limit: 50,
        includeTags: false,
      })
      if (response.success) setFriends(response.data.items)
    } catch {
      setError('お客様一覧を読み込めませんでした。')
    } finally {
      setFriendLoading(false)
    }
  }

  const searchFriends = async () => {
    setFriendLoading(true)
    try {
      const response = await api.friends.list({
        accountId: selectedAccountId || undefined,
        search: friendSearch.trim() || undefined,
        limit: 50,
        includeTags: false,
      })
      if (response.success) setFriends(response.data.items)
    } catch {
      setError('お客様の検索に失敗しました。')
    } finally {
      setFriendLoading(false)
    }
  }

  const sendFormMessage = async () => {
    if (!selectedFriendId) return setError('送信するお客様を選んでください。')
    if (!sendMessage.trim()) return setError('送信メッセージを入力してください。')
    setSending(true)
    setError('')
    try {
      const response = await fetchApi<{ success: boolean; error?: string }>(`/api/friends/${selectedFriendId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ messageType: 'text', content: sendMessage.trim(), trackLinks: false }),
      })
      if (!response.success) throw new Error(response.error || '送信に失敗しました。')
      const friend = friends.find((item) => item.id === selectedFriendId)
      setSuccess(`${friend?.displayName || '選択したお客様'}へフォームを送信しました。`)
      setSendForm(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'LINE送信に失敗しました。')
    } finally {
      setSending(false)
    }
  }

  const updateField = (index: number, patch: Partial<FormField>) => {
    setFields((current) => current.map((field, i) => i === index ? { ...field, ...patch } : field))
  }

  const addField = () => {
    setFields((current) => [
      ...current,
      { name: `field_${current.length + 1}`, label: '新しい質問', type: 'text', required: false },
    ])
  }

  const removeField = (index: number) => {
    setFields((current) => current.filter((_, i) => i !== index))
  }

  const addTagRule = (fieldIndex: number) => {
    const tagId = tags[0]?.id || ''
    setFields((current) => current.map((field, index) => index === fieldIndex
      ? { ...field, tagRules: [...(field.tagRules || []), { operator: 'equals', value: '', tagId }] }
      : field))
  }

  const updateTagRule = (fieldIndex: number, ruleIndex: number, patch: Partial<TagRule>) => {
    setFields((current) => current.map((field, index) => index === fieldIndex
      ? { ...field, tagRules: (field.tagRules || []).map((rule, i) => i === ruleIndex ? { ...rule, ...patch } : rule) }
      : field))
  }

  const removeTagRule = (fieldIndex: number, ruleIndex: number) => {
    setFields((current) => current.map((field, index) => index === fieldIndex
      ? { ...field, tagRules: (field.tagRules || []).filter((_, i) => i !== ruleIndex) }
      : field))
  }

  const resetEditor = () => {
    setEditingId(null)
    setEditingActive(true)
    setName('相談前のかんたん確認フォーム')
    setDescription('うまく説明できなくても大丈夫です。分かる範囲でお知らせください。')
    setSelectedTagId('')
    setNewTagName('相談希望')
    setFields(initialFields.map((field) => ({ ...field })))
    setReplyMessage('')
    setReplyType('text')
  }

  // 予約表のひな形を editor に流し込む。商品名を書き換えるだけで使える状態にする。
  const loadOrderPreset = () => {
    setEditingId(null)
    setEditingActive(true)
    setName('商品ご予約フォーム')
    setDescription(orderPresetDescription)
    setSelectedTagId('')
    setNewTagName('商品予約')
    setFields(orderPresetFields.map((field) => ({ ...field })))
    setReplyMessage(orderPresetReply)
    setReplyType('text')
    setError('')
    setSuccess('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const fillEditor = (form: HarnessForm) => {
    setName(form.name)
    setDescription(form.description || '')
    setSelectedTagId(form.onSubmitTagId || '')
    setNewTagName('')
    setFields(form.fields.map((field, index) => ({
      ...field,
      name: field.name || `field_${index + 1}`,
      chartTarget: field.chartTarget || '',
      tagRules: field.tagRules || [],
    })))
    setReplyMessage(form.onSubmitMessageContent || '')
    setReplyType(form.onSubmitMessageType === 'flex' ? 'flex' : 'text')
    setError('')
    setSuccess('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startEdit = (form: HarnessForm) => {
    setEditingId(form.id)
    setEditingActive(form.isActive)
    fillEditor(form)
  }

  // 複製。元のフォームには触らず、中身だけ写して新規作成の状態にする。
  // 前回の予約表をそのまま持ってきて、商品名と価格を書き換える使い方を想定している。
  const duplicateForm = (form: HarnessForm) => {
    setEditingId(null)
    setEditingActive(true)
    fillEditor(form)
    setName(`${form.name}のコピー`)
    setSuccess('前回の内容を写しました。商品名などを書き換えて「フォームと自動タグを作成」を押すと、新しいフォームになります。元のフォームはそのまま残ります。')
  }

  const openPreview = (form: HarnessForm) => {
    setPreviewForm(form)
    setPreviewAnswers(Object.fromEntries(form.fields.map((field) => [field.name, ''])))
  }

  const previewResult = previewForm ? (() => {
    const tagIds = new Set<string>()
    if (previewForm.onSubmitTagId) tagIds.add(previewForm.onSubmitTagId)
    const mappings: Array<{ label: string; target: string; value: string }> = []
    for (const field of previewForm.fields) {
      const answer = (previewAnswers[field.name] || '').trim()
      if (answer && field.chartTarget) {
        mappings.push({
          label: field.label,
          target: chartTargetLabels.find(([value]) => value === field.chartTarget)?.[1] || field.chartTarget,
          value: answer,
        })
      }
      for (const rule of field.tagRules || []) {
        const expected = rule.value.trim()
        const matched = rule.operator === 'not_empty'
          ? answer.length > 0
          : rule.operator === 'equals'
            ? answer.localeCompare(expected, 'ja', { sensitivity: 'accent' }) === 0
            : expected.length > 0 && answer.includes(expected)
        if (matched && rule.tagId) tagIds.add(rule.tagId)
      }
    }
    const missingRequired = previewForm.fields
      .filter((field) => field.required && !(previewAnswers[field.name] || '').trim())
      .map((field) => field.label)
    return { tagIds: [...tagIds], mappings, missingRequired }
  })() : null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!name.trim()) return setError('フォーム名を入力してください。')
    if (fields.length === 0) return setError('質問を1つ以上追加してください。')
    if (fields.some((field) => !field.label.trim())) return setError('質問文が空欄になっています。')
    if (fields.some((field) => (field.type === 'select' || field.type === 'radio') && !(field.options || []).length)) return setError('選択式の質問には選択肢を1つ以上入力してください。')
    if (fields.some((field) => field.tagRules?.some((rule) => !rule.tagId || (rule.operator !== 'not_empty' && !rule.value.trim())))) return setError('条件タグの条件値とタグを入力してください。')

    // Flex（JSON）の返信は、書式が崩れたまま保存すると送信時に JSON が
    // そのままお客様へ文字として届いてしまう（エラーにならず届く）。
    // 保存前にここで止める。
    if (replyMessage.trim() && replyType === 'flex') {
      try {
        JSON.parse(replyMessage)
      } catch {
        return setError('返信（Flex形式）のJSONが壊れています。保存すると、このJSONがそのままお客様へ文字として届いてしまいます。書式を直すか、この欄を空にしてください。')
      }
    }

    setSaving(true)
    try {
      let tagId = selectedTagId || null
      if (newTagName.trim()) {
        const existing = tags.find((tag) => tag.name === newTagName.trim())
        if (existing) {
          tagId = existing.id
        } else {
          const tagRes = await api.tags.create({ name: newTagName.trim(), color: '#06C755' })
          if (!tagRes.success) throw new Error(tagRes.error)
          tagId = tagRes.data.id
        }
      }

      // 鈴木薬舗の相談前フォームでは、相談方法の回答を自動でタグ化する。
      // これにより店頭・LINE・電話・オンラインを一覧で絞り込める。
      const methodField = fields.find((field) => field.name === 'consultation_method')
      const methodTagIds = new Map<string, string>()
      if (methodField?.options?.length) {
        for (const option of methodField.options) {
          const tagName = `相談方法：${option}`
          const existing = tags.find((tag) => tag.name === tagName)
          if (existing) {
            methodTagIds.set(option, existing.id)
          } else {
            const created = await api.tags.create({ name: tagName, color: '#3B82F6' })
            if (!created.success) throw new Error(created.error)
            methodTagIds.set(option, created.data.id)
          }
        }
      }

      const normalizedFields = fields.map((field, index) => ({
        ...field,
        name: field.name || `field_${index + 1}`,
        label: field.label.trim(),
        // 単価と最大個数は「商品の個数」以外では意味がないので落とす。
        // 単価が空のときはキー自体を送らない（お客様の画面に合計金額を出さないため）。
        ...(field.type === 'quantity'
          ? {
              ...(typeof field.unitPrice === 'number' && Number.isFinite(field.unitPrice) && field.unitPrice > 0
                ? { unitPrice: field.unitPrice }
                : { unitPrice: undefined }),
              maxQuantity: Math.max(1, Math.min(Math.round(field.maxQuantity ?? 10), 99)),
            }
          : { unitPrice: undefined, maxQuantity: undefined }),
        ...(field.name === 'consultation_method' && methodTagIds.size > 0
          ? {
              tagRules: [
                ...(field.tagRules || []).filter((rule) => !rule.value || !methodTagIds.has(rule.value)),
                ...Array.from(methodTagIds, ([value, methodTagId]) => ({ operator: 'equals' as const, value, tagId: methodTagId })),
              ],
            }
          : {}),
      }))

      const result = await fetchApi<{ success: boolean; data: HarnessForm; error?: string }>(editingId ? `/api/forms/${editingId}` : '/api/forms', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          fields: normalizedFields,
          onSubmitTagId: tagId,
          onSubmitMessageType: replyMessage.trim() ? replyType : null,
          onSubmitMessageContent: replyMessage.trim() || null,
          saveToMetadata: true,
          ...(editingId ? { isActive: editingActive } : {}),
        }),
      })
      if (!result.success) throw new Error(result.error || '作成に失敗しました。')

      setSuccess(editingId
        ? `「${result.data.name}」を更新しました。今後の回答から新しい設定が適用されます。`
        : `「${result.data.name}」を作成しました。回答すると設定したタグが付きます。`)
      resetEditor()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'フォームの作成に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header title="フォーム作成" description="質問を作り、回答したお客様へ自動でタグを付けます" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">1. {editingId ? '既存フォームを編集' : 'フォームの名前'}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {!editingId && (
                  <button type="button" onClick={loadOrderPreset} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
                    予約表のひな形を読み込む
                  </button>
                )}
                {editingId && <button type="button" onClick={resetEditor} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">編集をやめる</button>}
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" placeholder="例：漢方相談フォーム" />
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" rows={2} placeholder="お客様に表示する説明" />
            </div>
            {editingId && (
              <label className="mt-3 flex items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                <input type="checkbox" checked={editingActive} onChange={(event) => setEditingActive(event.target.checked)} className="rounded border-gray-300" />
                このフォームで回答を受け付ける
              </label>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">2. お客様への質問</h2>
              <button type="button" onClick={addField} className="rounded-lg border border-[#06C755] px-3 py-1.5 text-sm font-medium text-[#06C755] hover:bg-green-50">質問を追加</button>
            </div>
            <div className="mt-3 space-y-3">
              {fields.map((field, index) => (
                <div key={`${field.name}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                    <input value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" aria-label={`${index + 1}番目の質問`} />
                    <select
                      value={field.type}
                      onChange={(e) => {
                        const next = e.target.value as FieldType
                        // 個数は 0 個も正しい回答なので「必須」にはできない。
                        // 代わりに「1つ以上選んでください」をお客様の画面側で確かめている。
                        updateField(index, next === 'quantity' ? { type: next, required: false } : { type: next })
                      }}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      {Object.entries(fieldTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <button type="button" onClick={() => removeField(index)} className="px-2 text-sm text-red-500 hover:text-red-700">削除</button>
                  </div>
                  {(field.type === 'select' || field.type === 'radio') && (
                    <label className="mt-2 block text-xs font-medium text-gray-600">
                      選択肢（1行に1つ）
                      <textarea
                        value={(field.options || []).join('\n')}
                        onChange={(event) => updateField(index, { options: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })}
                        rows={4}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                        placeholder={'店頭相談\nLINE相談\n電話相談\nオンライン相談'}
                      />
                    </label>
                  )}
                  {field.type === 'quantity' && (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-xs text-emerald-900">
                        上の質問文が、そのまま商品名としてお客様に表示されます。例：<span className="font-semibold">板藍茶 120包</span>
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs font-medium text-gray-600">
                          単価（円）／空欄でもOK
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={typeof field.unitPrice === 'number' ? field.unitPrice : ''}
                            onChange={(event) => {
                              const raw = event.target.value.trim()
                              const parsed = Number(raw)
                              updateField(index, { unitPrice: raw === '' || !Number.isFinite(parsed) ? undefined : parsed })
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                            placeholder="8640"
                          />
                        </label>
                        <label className="block text-xs font-medium text-gray-600">
                          選べる最大個数
                          <input
                            type="number"
                            min={1}
                            max={99}
                            inputMode="numeric"
                            value={field.maxQuantity ?? 10}
                            onChange={(event) => {
                              const parsed = Number(event.target.value)
                              updateField(index, { maxQuantity: Number.isFinite(parsed) ? parsed : 10 })
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <p className="mt-2 text-xs text-emerald-800">
                        単価を入れた商品が1つ以上あるときだけ、お客様の画面の下に<span className="font-semibold">合計金額</span>が自動で出ます。
                        単価が分からないときは空欄のままで、「何を何個」だけの予約表になります。
                      </p>
                    </div>
                  )}
                  {field.type !== 'quantity' && (
                    <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} className="rounded border-gray-300" />
                      必須回答にする
                    </label>
                  )}
                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <label className="block text-xs font-medium text-gray-600">相談カルテの保存先</label>
                    <select value={field.chartTarget || ''} onChange={(e) => updateField(index, { chartTarget: e.target.value as ChartTarget })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                      {chartTargetLabels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">回答の取り込み時に候補として整理します。既存カルテは自動上書きしません。</p>
                  </div>
                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-600">回答条件で付けるタグ</span>
                      <button type="button" onClick={() => addTagRule(index)} disabled={tags.length === 0} className="text-xs font-medium text-[#06C755] disabled:text-gray-400">+ 条件を追加</button>
                    </div>
                    {(field.tagRules || []).map((rule, ruleIndex) => (
                      <div key={ruleIndex} className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr_1fr_auto]">
                        <select value={rule.operator} onChange={(e) => updateTagRule(index, ruleIndex, { operator: e.target.value as TagRuleOperator })} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs">
                          <option value="equals">一致する</option><option value="contains">含まれる</option><option value="not_empty">回答あり</option>
                        </select>
                        <input value={rule.value} disabled={rule.operator === 'not_empty'} onChange={(e) => updateTagRule(index, ruleIndex, { value: e.target.value })} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs disabled:bg-gray-100" placeholder="条件となる回答" />
                        <select value={rule.tagId} onChange={(e) => updateTagRule(index, ruleIndex, { tagId: e.target.value })} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs">
                          <option value="">付けるタグ</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                        </select>
                        <button type="button" onClick={() => removeTagRule(index, ruleIndex)} className="px-2 text-xs text-red-500">削除</button>
                      </div>
                    ))}
                    {tags.length === 0 && <p className="mt-1 text-xs text-gray-500">先にタグを1つ作成すると条件を追加できます。</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900">3. 回答したら付けるタグ</h2>
            <p className="mt-1 text-sm text-gray-500">新しいタグ名を入力するか、既存のタグを選びます。</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm" placeholder="新しいタグ名" />
              <select value={selectedTagId} onChange={(e) => { setSelectedTagId(e.target.value); if (e.target.value) setNewTagName('') }} className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm">
                <option value="">既存タグを選択</option>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900">4. 回答したお客様へ届く返信</h2>
            <p className="mt-1 text-sm text-gray-500">
              空欄にすると返信しません。<span className="font-medium text-gray-700">{'{{answers}}'}</span> と書いた場所に、お客様が選んだ内容がそのまま入ります。
            </p>
            <textarea
              value={replyMessage}
              onChange={(event) => setReplyMessage(event.target.value)}
              rows={9}
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
              placeholder={orderPresetReply}
            />
            {replyType === 'flex' && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                このフォームは Flex（JSON）形式で返信します。書式を崩すと返信できなくなるので、文章だけを入れ替えてください。
              </p>
            )}
            <p className="mt-2 text-xs text-amber-700">この返信はLINEの配信通数を1通消費します（お客様1人につき1通）。</p>
          </section>

          {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {success && <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

          <button type="submit" disabled={saving} className="w-full rounded-lg bg-[#06C755] px-4 py-3 text-sm font-semibold text-white hover:bg-[#05b84e] disabled:opacity-50">
            {saving ? (editingId ? '更新しています…' : '作成しています…') : (editingId ? '変更内容を保存' : 'フォームと自動タグを作成')}
          </button>
        </form>

        <aside className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-semibold text-gray-900">作成済みフォーム</h2>
          <p className="mt-1 text-sm text-gray-500">回答内容は「フォーム回答」で確認できます。</p>
          <div className="mt-4 space-y-3">
            {loading ? <p className="text-sm text-gray-400">読み込み中…</p> : forms.length === 0 ? <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">まだフォームはありません。</p> : forms.map((form) => {
              const tagName = tags.find((tag) => tag.id === form.onSubmitTagId)?.name
              return (
                <div key={form.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-gray-900">{form.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${form.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{form.isActive ? '受付中' : '停止中'}</span>
                  </div>
                  {form.description && <p className="mt-1 text-xs text-gray-500">{form.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">質問 {form.fields.length}件</span>
                    <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">回答 {form.submitCount}件</span>
                    {tagName && <span className="rounded bg-green-100 px-2 py-1 text-green-700">回答後：{tagName}</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => startEdit(form)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50">
                      編集
                    </button>
                    <button type="button" onClick={() => openPreview(form)} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50">
                      設定テスト
                    </button>
                    <button type="button" onClick={() => void copyFormUrl(form)} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      {copiedFormId === form.id ? 'コピーしました' : 'URLをコピー'}
                    </button>
                    <button type="button" onClick={() => void openSend(form)} className="rounded-lg bg-[#06C755] px-3 py-2 text-xs font-semibold text-white hover:bg-[#05b84e]">
                      お客様へ送る
                    </button>
                    <button type="button" onClick={() => duplicateForm(form)} className="col-span-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
                      これを複製して次の予約表を作る
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </aside>
      </div>

      {sendForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="フォームをLINEで送信">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">お客様へLINE送信</h2>
                <p className="mt-1 text-sm text-gray-500">{sendForm.name}</p>
              </div>
              <button type="button" onClick={() => setSendForm(null)} className="text-2xl leading-none text-gray-400 hover:text-gray-600" aria-label="閉じる">×</button>
            </div>

            <div className="mt-5">
              <label className="text-sm font-medium text-gray-700">送信するお客様</label>
              <div className="mt-2 flex gap-2">
                <input value={friendSearch} onChange={(e) => setFriendSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void searchFriends() }} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="お名前で検索" />
                <button type="button" onClick={() => void searchFriends()} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">検索</button>
              </div>
              <select value={selectedFriendId} onChange={(e) => setSelectedFriendId(e.target.value)} disabled={friendLoading} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm">
                <option value="">{friendLoading ? '読み込み中…' : 'お客様を選択'}</option>
                {friends.filter((friend) => friend.isFollowing).map((friend) => <option key={friend.id} value={friend.id}>{friend.displayName}</option>)}
              </select>
            </div>

            <div className="mt-4">
              <label className="text-sm font-medium text-gray-700">送信内容</label>
              <textarea value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} rows={6} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
              <p className="mt-1 text-xs text-amber-700">この操作は実際にLINEメッセージを1通送信し、LINE公式アカウントの配信通数を消費します。</p>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setSendForm(null)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">キャンセル</button>
              <button type="button" onClick={() => void sendFormMessage()} disabled={sending || !selectedFriendId} className="rounded-lg bg-[#06C755] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#05b84e] disabled:opacity-50">
                {sending ? '送信中…' : 'このお客様へ送信'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewForm && previewResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="フォーム設定テスト">
          <div className="my-auto w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">保存・送信されないテスト</div>
                <h2 className="mt-2 text-lg font-semibold text-gray-900">{previewForm.name}</h2>
                {previewForm.description && <p className="mt-1 text-sm text-gray-500">{previewForm.description}</p>}
              </div>
              <button type="button" onClick={() => setPreviewForm(null)} className="text-2xl leading-none text-gray-400 hover:text-gray-600" aria-label="閉じる">×</button>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-800">仮の回答を入力</h3>
                {previewResult.missingRequired.length > 0 && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">未入力の必須項目: {previewResult.missingRequired.join('、')}</div>}
                {previewForm.fields.map((field) => (
                  <label key={field.name} className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">{field.label}{field.required && <span className="ml-1 text-red-500">*</span>}</span>
                    {field.type === 'textarea'
                      ? <textarea rows={3} value={previewAnswers[field.name] || ''} onChange={(event) => setPreviewAnswers((current) => ({ ...current, [field.name]: event.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder={field.placeholder} />
                      : field.type === 'select'
                        ? <select value={previewAnswers[field.name] || ''} onChange={(event) => setPreviewAnswers((current) => ({ ...current, [field.name]: event.target.value }))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="">選択してください</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
                        : field.type === 'radio'
                          ? <div className="space-y-2">{(field.options || []).map((option) => <label key={option} className="flex items-center gap-2 rounded-lg border p-2 text-sm"><input type="radio" name={`preview-${field.name}`} value={option} checked={previewAnswers[field.name] === option} onChange={(event) => setPreviewAnswers((current) => ({ ...current, [field.name]: event.target.value }))} />{option}</label>)}</div>
                          : field.type === 'quantity'
                            ? <div className="flex items-center gap-2">
                                <select value={previewAnswers[field.name] || '0'} onChange={(event) => setPreviewAnswers((current) => ({ ...current, [field.name]: event.target.value }))} className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                                  {Array.from({ length: Math.max(1, Math.min(Math.round(field.maxQuantity ?? 10), 99)) + 1 }, (_, n) => <option key={n} value={String(n)}>{n}</option>)}
                                </select>
                                <span className="text-sm text-gray-500">個{typeof field.unitPrice === 'number' ? `（単価 ${field.unitPrice.toLocaleString('ja-JP')}円）` : ''}</span>
                              </div>
                            : <input type={field.type} value={previewAnswers[field.name] || ''} onChange={(event) => setPreviewAnswers((current) => ({ ...current, [field.name]: event.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder={field.placeholder} />}
                  </label>
                ))}
              </div>

              <div className="space-y-4">
                <section className="rounded-xl border border-green-200 bg-green-50 p-4">
                  <h3 className="text-sm font-semibold text-green-900">付く予定のタグ</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {previewResult.tagIds.map((tagId) => {
                      const tag = tags.find((item) => item.id === tagId)
                      return <span key={tagId} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-green-800">{tag?.name || '削除済みのタグ'}</span>
                    })}
                    {previewResult.tagIds.length === 0 && <span className="text-sm text-green-700">現在の回答ではタグは付きません。</span>}
                  </div>
                </section>

                <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <h3 className="text-sm font-semibold text-blue-900">相談カルテへの振り分け</h3>
                  <div className="mt-3 space-y-2">
                    {previewResult.mappings.map((mapping, index) => (
                      <div key={`${mapping.label}-${index}`} className="rounded-lg bg-white p-3">
                        <div className="text-xs font-medium text-blue-700">{mapping.target}</div>
                        <div className="mt-1 text-xs text-gray-500">{mapping.label}</div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{mapping.value}</div>
                      </div>
                    ))}
                    {previewResult.mappings.length === 0 && <span className="text-sm text-blue-700">回答を入力すると振り分け先が表示されます。</span>}
                  </div>
                </section>
                <p className="text-xs text-gray-500">この画面では回答、タグ、カルテを保存せず、LINEメッセージも送信しません。</p>
              </div>
            </div>
            <div className="mt-5 text-right"><button type="button" onClick={() => setPreviewForm(null)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">テストを終了</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

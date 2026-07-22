'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import Header from '@/components/layout/header'
import { api, fetchApi, type FriendListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type FieldType = 'text' | 'tel' | 'email' | 'number' | 'textarea' | 'date'
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
  chartTarget?: ChartTarget
  tagRules?: TagRule[]
}

interface HarnessForm {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  onSubmitTagId: string | null
  submitCount: number
  isActive: boolean
}

const initialFields: FormField[] = [
  { name: 'full_name', label: 'お名前', type: 'text', required: true, placeholder: '山田 太郎', chartTarget: 'customer_name' },
  { name: 'phone', label: '電話番号', type: 'tel', required: false, chartTarget: 'phone' },
  { name: 'consultation', label: 'ご相談内容', type: 'textarea', required: true, chartTarget: 'chief_complaint' },
]

const fieldTypeLabels: Record<FieldType, string> = {
  text: '一行入力',
  tel: '電話番号',
  email: 'メールアドレス',
  number: '数値',
  textarea: '長文入力',
  date: '日付',
}

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
  const [name, setName] = useState('漢方相談フォーム')
  const [description, setDescription] = useState('ご相談に必要な内容をご入力ください。')
  const [selectedTagId, setSelectedTagId] = useState('')
  const [newTagName, setNewTagName] = useState('漢方相談希望')
  const [fields, setFields] = useState<FormField[]>(initialFields)
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
    ? `https://liff.line.me/${selectedAccount.liffId}?formId=${encodeURIComponent(formId)}`
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
    setName('漢方相談フォーム')
    setDescription('ご相談に必要な内容をご入力ください。')
    setSelectedTagId('')
    setNewTagName('漢方相談希望')
    setFields(initialFields.map((field) => ({ ...field })))
  }

  const startEdit = (form: HarnessForm) => {
    setEditingId(form.id)
    setEditingActive(form.isActive)
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
    setError('')
    setSuccess('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
    if (fields.some((field) => field.tagRules?.some((rule) => !rule.tagId || (rule.operator !== 'not_empty' && !rule.value.trim())))) return setError('条件タグの条件値とタグを入力してください。')

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

      const normalizedFields = fields.map((field, index) => ({
        ...field,
        name: field.name || `field_${index + 1}`,
        label: field.label.trim(),
      }))

      const result = await fetchApi<{ success: boolean; data: HarnessForm; error?: string }>(editingId ? `/api/forms/${editingId}` : '/api/forms', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          fields: normalizedFields,
          onSubmitTagId: tagId,
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
              {editingId && <button type="button" onClick={resetEditor} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">編集をやめる</button>}
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
                    <select value={field.type} onChange={(e) => updateField(index, { type: e.target.value as FieldType })} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                      {Object.entries(fieldTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <button type="button" onClick={() => removeField(index)} className="px-2 text-sm text-red-500 hover:text-red-700">削除</button>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} className="rounded border-gray-300" />
                    必須回答にする
                  </label>
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

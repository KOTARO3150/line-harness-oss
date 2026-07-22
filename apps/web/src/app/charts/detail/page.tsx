'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import {
  consultationChartApi,
  type ConsultationChart,
  type ConsultationRecord,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type Detail = Awaited<ReturnType<typeof consultationChartApi.get>>
type ProlinePreview = Awaited<ReturnType<typeof consultationChartApi.previewProlineBooking>>['preview']

const EMPTY_CHART: Partial<ConsultationChart> = {
  customer_name: '', customer_name_kana: '', birth_date: '', phone: '',
  allergies: '', current_medications: '', safety_notes: '', general_notes: '',
}

function localDateTimeValue() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

const EMPTY_RECORD: Partial<ConsultationRecord> = {
  consultation_at: localDateTimeValue(), consultation_type: 'in_person',
  chief_complaint: '', observations: '', recommendation: '', products: '',
  usage_instructions: '', follow_up_plan: '', follow_up_due_date: null, source_form_submission_id: null,
}

const SAFE_FOLLOW_UP_MESSAGE = '先日はご相談いただき、ありがとうございました。\nその後のご様子はいかがでしょうか。\n気になることがありましたら、このLINEへご返信ください。\n\n鈴木薬舗'

type ChartField = keyof Pick<ConsultationChart, 'customer_name' | 'customer_name_kana' | 'birth_date' | 'phone' | 'allergies' | 'current_medications' | 'safety_notes' | 'general_notes'>
type RecordField = keyof Pick<ConsultationRecord, 'chief_complaint' | 'observations' | 'recommendation' | 'products' | 'usage_instructions' | 'follow_up_plan'>
type ChartSuggestion = { field: ChartField; label: string; value: string; selected: boolean }

const CHAT_IMPORT_HEADINGS: Array<{ field: RecordField; labels: string[] }> = [
  { field: 'chief_complaint', labels: ['主な相談内容', '主訴', '症状', 'お客様の心配事'] },
  { field: 'observations', labels: ['経過', '観察・聞き取り', '事実', '生活状況', '検査結果'] },
  { field: 'recommendation', labels: ['鈴木先生の考察', '考察', '説明した内容', '提案内容'] },
  { field: 'products', labels: ['商品・処方内容', '使用中の漢方・健康食品'] },
  { field: 'usage_instructions', labels: ['使用方法・服用方法'] },
  { field: 'follow_up_plan', labels: ['次回確認事項', 'フォロー計画', '不明点'] },
]

function normalizeImportHeading(value: string) {
  return value.trim().replace(/^[【\[\s#*]+|[】\]\s:*：]+$/g, '').trim()
}

function buildChatImportDraft(sourceTitle: string, rawText: string): Partial<ConsultationRecord> {
  const headingMap = new Map<string, RecordField>()
  for (const item of CHAT_IMPORT_HEADINGS) {
    for (const label of item.labels) headingMap.set(label, item.field)
  }
  const sections = new Map<RecordField, string[]>()
  const unclassified: string[] = []
  let current: RecordField | null = null
  for (const line of rawText.split(/\r?\n/)) {
    const heading = headingMap.get(normalizeImportHeading(line))
    if (heading) {
      current = heading
      continue
    }
    if (current) {
      const values = sections.get(current) ?? []
      values.push(line)
      sections.set(current, values)
    } else {
      unclassified.push(line)
    }
  }
  const clean = (field: RecordField) => (sections.get(field) ?? []).join('\n').trim()
  const sourceNote = `【移行元】${sourceTitle.trim() || 'ChatGPT相談履歴'}\n【取込日】${new Date().toLocaleDateString('ja-JP')}\n【状態】内容確認前の下書き`
  const rawRemainder = unclassified.join('\n').trim()
  return {
    ...EMPTY_RECORD,
    consultation_at: localDateTimeValue(),
    consultation_type: 'line',
    chief_complaint: clean('chief_complaint') || 'ChatGPT相談履歴から移行（内容を確認してください）',
    observations: [sourceNote, clean('observations'), rawRemainder ? `【原文・未分類】\n${rawRemainder}` : ''].filter(Boolean).join('\n\n'),
    recommendation: clean('recommendation'),
    products: clean('products'),
    usage_instructions: clean('usage_instructions'),
    follow_up_plan: clean('follow_up_plan') || '元のChatGPT相談履歴と照合し、不明点を次回確認する。',
  }
}

const chartFieldLabels: Record<ChartField, string> = {
  customer_name: '氏名', customer_name_kana: 'ふりがな', birth_date: '生年月日', phone: '電話番号',
  allergies: 'アレルギー・禁忌', current_medications: '使用中の医薬品・商品',
  safety_notes: '注意事項', general_notes: '基本メモ',
}
const chartFields = new Set<ChartField>(Object.keys(chartFieldLabels) as ChartField[])
const recordFields = new Set<RecordField>(['chief_complaint', 'observations', 'recommendation', 'products', 'usage_instructions', 'follow_up_plan'])

function answerText(value: unknown) {
  return Array.isArray(value) ? value.join('、') : String(value ?? '')
}

function appendAnswer(current: unknown, value: string) {
  const existing = String(current ?? '').trim()
  return existing ? `${existing}\n${value}` : value
}

export default function ChartDetailPage() {
  const friendId = useSearchParams().get('friend') || ''
  const { selectedAccountId } = useAccount()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [chartForm, setChartForm] = useState<Partial<ConsultationChart>>(EMPTY_CHART)
  const [recordForm, setRecordForm] = useState<Partial<ConsultationRecord>>(EMPTY_RECORD)
  const [showRecord, setShowRecord] = useState(false)
  const [showChatImport, setShowChatImport] = useState(false)
  const [chatImportTitle, setChatImportTitle] = useState('')
  const [chatImportText, setChatImportText] = useState('')
  const [chatImportConfirmed, setChatImportConfirmed] = useState(false)
  const [showProlineImport, setShowProlineImport] = useState(false)
  const [prolineNoticeText, setProlineNoticeText] = useState('')
  const [prolinePreview, setProlinePreview] = useState<ProlinePreview | null>(null)
  const [prolineImportConfirmed, setProlineImportConfirmed] = useState(false)
  const [chartSuggestions, setChartSuggestions] = useState<ChartSuggestion[]>([])
  const [sendRecord, setSendRecord] = useState<ConsultationRecord | null>(null)
  const [followMessage, setFollowMessage] = useState(SAFE_FOLLOW_UP_MESSAGE)
  const [sendConfirmed, setSendConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId || !friendId) return
    setLoading(true)
    setError('')
    try {
      const result = await consultationChartApi.get(selectedAccountId, friendId)
      setDetail(result)
      setChartForm(result.chart ?? { ...EMPTY_CHART, customer_name: result.friend.display_name ?? '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'カルテを読み込めませんでした。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, friendId])

  useEffect(() => { void load() }, [load])

  const saveChart = async () => {
    if (!selectedAccountId) return
    setSaving(true); setError(''); setSaved('')
    try {
      await consultationChartApi.save(selectedAccountId, friendId, chartForm)
      setSaved('基本カルテを保存しました。')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'カルテを保存できませんでした。')
    } finally { setSaving(false) }
  }

  const addRecord = async () => {
    if (!selectedAccountId || !detail?.chart) return
    setSaving(true); setError(''); setSaved('')
    try {
      await consultationChartApi.addRecord(selectedAccountId, friendId, {
        ...recordForm,
        consultation_at: recordForm.consultation_at ? new Date(recordForm.consultation_at).toISOString() : new Date().toISOString(),
      })
      setRecordForm({ ...EMPTY_RECORD, consultation_at: localDateTimeValue() })
      setChartSuggestions([])
      setShowRecord(false)
      setSaved('相談記録を追加しました。')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '相談記録を保存できませんでした。')
    } finally { setSaving(false) }
  }

  const previewProlineBooking = async () => {
    if (!selectedAccountId || !prolineNoticeText.trim()) return
    setSaving(true); setError(''); setSaved('')
    try {
      const result = await consultationChartApi.previewProlineBooking(
        selectedAccountId, friendId, prolineNoticeText.trim(),
      )
      setProlinePreview(result.preview)
      setProlineImportConfirmed(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      setProlinePreview(null)
      setError(message.includes('422')
        ? '予約日時を読み取れませんでした。プロラインの予約受付通知またはキャンセル通知を、全文貼り付けてください。'
        : 'プロライン予約の内容を読み取れませんでした。通知内容を確認してください。')
    } finally { setSaving(false) }
  }

  const importProlineBooking = async () => {
    if (!selectedAccountId || !prolinePreview || !prolineImportConfirmed || !prolineNoticeText.trim()) return
    setSaving(true); setError(''); setSaved('')
    try {
      const result = await consultationChartApi.importProlineBooking(
        selectedAccountId, friendId, prolineNoticeText.trim(),
      )
      const cancelled = result.booking.status === 'cancelled'
      setProlineNoticeText('')
      setProlinePreview(null)
      setProlineImportConfirmed(false)
      setShowProlineImport(false)
      setSaved(cancelled ? 'プロラインのキャンセル通知を予約履歴へ反映しました。' : 'プロライン予約を予約履歴へ取り込みました。')
      await load()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      setError(message.includes('422')
        ? '予約日時を読み取れませんでした。プロラインの予約受付通知またはキャンセル通知を、全文貼り付けてください。'
        : 'プロライン予約を取り込めませんでした。通知内容を確認してください。')
    } finally { setSaving(false) }
  }

  const importSubmission = (submission: Detail['submissions'][number]) => {
    const labels = new Map(submission.fields.map((field) => [field.name, field.label]))
    const targets = new Map(submission.fields.map((field) => [field.name, field.chartTarget]))
    const draft: Partial<ConsultationRecord> = {
      ...EMPTY_RECORD,
      consultation_at: localDateTimeValue(),
      source_form_submission_id: submission.id,
    }
    const suggestions = new Map<ChartField, string>()
    const unmapped: string[] = []
    for (const [key, rawValue] of Object.entries(submission.data)) {
      const value = answerText(rawValue).trim()
      if (!value) continue
      const target = targets.get(key)
      if (target && chartFields.has(target as ChartField)) {
        const field = target as ChartField
        suggestions.set(field, appendAnswer(suggestions.get(field), value))
      } else if (target && recordFields.has(target as RecordField)) {
        const field = target as RecordField
        draft[field] = appendAnswer(draft[field], value)
      } else {
        unmapped.push(`${labels.get(key) || key}: ${value}`)
      }
    }
    if (!draft.chief_complaint) draft.chief_complaint = `事前問診「${submission.form_name}」より`
    if (unmapped.length > 0) draft.observations = appendAnswer(draft.observations, unmapped.join('\n'))
    setRecordForm(draft)
    setChartSuggestions([...suggestions].map(([field, value]) => ({
      field, label: chartFieldLabels[field], value, selected: !String(chartForm[field] ?? '').trim(),
    })))
    setShowRecord(true)
    window.setTimeout(() => document.getElementById('consultation-record-editor')?.scrollIntoView({ behavior: 'smooth' }), 0)
  }

  const prepareChatImport = () => {
    if (!chatImportConfirmed || !chatImportText.trim()) return
    setRecordForm(buildChatImportDraft(chatImportTitle, chatImportText.trim()))
    setChartSuggestions([])
    setShowChatImport(false)
    setShowRecord(true)
    setSaved('ChatGPT相談履歴を相談記録の下書きへ整理しました。元の履歴と照合し、修正してから保存してください。')
    window.setTimeout(() => document.getElementById('consultation-record-editor')?.scrollIntoView({ behavior: 'smooth' }), 0)
  }

  const applyChartSuggestions = () => {
    setChartForm((current) => {
      const next = { ...current }
      for (const suggestion of chartSuggestions) {
        if (suggestion.selected) next[suggestion.field] = suggestion.value
      }
      return next
    })
    setChartSuggestions([])
    setSaved('選択した回答を基本カルテの入力欄へ反映しました。「基本カルテを保存」で確定してください。')
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0)
  }

  const setFollowUpCompleted = async (record: ConsultationRecord, completed: boolean) => {
    if (!selectedAccountId) return
    setSaving(true); setError(''); setSaved('')
    try {
      await consultationChartApi.setFollowUpCompleted(selectedAccountId, friendId, record.id, completed)
      setSaved(completed ? 'フォローを完了にしました。' : 'フォローを未完了へ戻しました。')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'フォロー状態を更新できませんでした。')
    } finally { setSaving(false) }
  }

  const openFollowUpDraft = (record: ConsultationRecord) => {
    setSendRecord(record)
    setFollowMessage(SAFE_FOLLOW_UP_MESSAGE)
    setSendConfirmed(false)
    setError('')
  }

  const sendFollowUp = async () => {
    if (!selectedAccountId || !sendRecord || !sendConfirmed || !followMessage.trim()) return
    setSaving(true); setError(''); setSaved('')
    try {
      await consultationChartApi.sendFollowUp(selectedAccountId, friendId, sendRecord.id, followMessage.trim())
      setSendRecord(null)
      setSaved('フォローLINEを1通送信し、相談記録へ送信日時を保存しました。')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'フォローLINEを送信できませんでした。')
    } finally { setSaving(false) }
  }

  if (loading) return <div><Header title="相談カルテ" /><div className="rounded-xl border bg-white p-10 text-center text-sm text-gray-500">読み込み中…</div></div>

  return (
    <div>
      <Header title={detail?.chart?.customer_name || detail?.friend.display_name || '相談カルテ'} description="基本情報・注意事項・相談履歴" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/charts" className="rounded-lg border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">← カルテ一覧</Link>
        <Link href={`/chats?friend=${friendId}`} className="rounded-lg border border-green-200 px-3 py-2 text-sm text-green-700 hover:bg-green-50">個別チャット</Link>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {saved && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{saved}</div>}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-gray-900">基本カルテ</h2><span className="text-xs text-gray-500">LINE表示名: {detail?.friend.display_name || 'なし'}</span></div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Input label="氏名" value={chartForm.customer_name} onChange={(value) => setChartForm({ ...chartForm, customer_name: value })} />
          <Input label="ふりがな" value={chartForm.customer_name_kana} onChange={(value) => setChartForm({ ...chartForm, customer_name_kana: value })} />
          <Input label="生年月日" type="date" value={chartForm.birth_date} onChange={(value) => setChartForm({ ...chartForm, birth_date: value })} />
          <Input label="電話番号" value={chartForm.phone} onChange={(value) => setChartForm({ ...chartForm, phone: value })} />
          <TextArea label="アレルギー・禁忌" value={chartForm.allergies} onChange={(value) => setChartForm({ ...chartForm, allergies: value })} />
          <TextArea label="現在使用中の医薬品・商品" value={chartForm.current_medications} onChange={(value) => setChartForm({ ...chartForm, current_medications: value })} />
          <TextArea label="必ず確認する注意事項" value={chartForm.safety_notes} onChange={(value) => setChartForm({ ...chartForm, safety_notes: value })} className="border-red-200 bg-red-50" />
          <TextArea label="基本メモ" value={chartForm.general_notes} onChange={(value) => setChartForm({ ...chartForm, general_notes: value })} />
        </div>
        <div className="mt-4 text-right"><button type="button" disabled={saving} onClick={() => void saveChart()} className="rounded-lg bg-[#06C755] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : '基本カルテを保存'}</button></div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">フォーム回答・タグ</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {detail?.tags.map((tag) => <span key={tag.id} className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: `${tag.color}20`, color: tag.color }}>{tag.name}</span>)}
          {detail?.tags.length === 0 && <span className="text-sm text-gray-500">タグはありません。</span>}
        </div>
        <div className="mt-4 space-y-2">
          {detail?.submissions.map((submission) => (
            <div key={submission.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
              <div><div className="text-sm font-medium text-gray-900">{submission.form_name}</div><div className="mt-1 text-xs text-gray-500">{new Date(submission.created_at).toLocaleString('ja-JP')} · 回答 {Object.keys(submission.data).length}項目</div></div>
              {submission.imported ? <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-700">カルテ取込済み</span> : <button type="button" disabled={!detail.chart} onClick={() => importSubmission(submission)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40">確認して相談記録へ取り込む</button>}
            </div>
          ))}
          {detail?.submissions.length === 0 && <p className="text-sm text-gray-500">フォーム回答はありません。</p>}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">相談履歴</h2>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={!detail?.chart} onClick={() => { setShowChatImport(!showChatImport); setShowRecord(false); setChatImportConfirmed(false) }} className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 disabled:opacity-40">ChatGPT履歴を取り込む</button>
            <button type="button" disabled={!detail?.chart} onClick={() => { setShowRecord(!showRecord); setShowChatImport(false) }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">+ 相談記録を追加</button>
          </div>
        </div>
        {!detail?.chart && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">先に基本カルテを保存すると、相談記録を追加できます。</p>}
        {showChatImport && (
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              この画面ではAIによる推測を行いません。見出し付きの要約は項目別に整理し、それ以外の文章は「原文・未分類」として残します。
            </div>
            <div className="mt-4 grid gap-4">
              <Input label="移行元のチャット名（例：ヤマダ様 ご相談）" value={chatImportTitle} onChange={(value) => { setChatImportTitle(value); setChatImportConfirmed(false) }} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">ChatGPTの相談履歴または要約</span>
                <textarea rows={12} value={chatImportText} onChange={(event) => { setChatImportText(event.target.value); setChatImportConfirmed(false) }} placeholder={'全文を貼り付けるか、次の見出しを付けた要約を貼り付けます。\n【主な相談内容】【経過】【鈴木先生の考察】【提案内容】【商品・処方内容】【次回確認事項】【不明点】'} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-red-200 bg-white p-3 text-sm text-red-800">
                <input type="checkbox" checked={chatImportConfirmed} onChange={(event) => setChatImportConfirmed(event.target.checked)} className="mt-0.5 rounded border-gray-300" />
                <span>このChatGPT履歴と、現在開いている「{detail?.chart?.customer_name || detail?.friend.display_name || 'お客様'}」が同一人物であることを確認しました。</span>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowChatImport(false)} className="rounded-lg border bg-white px-4 py-2 text-sm">閉じる</button>
              <button type="button" disabled={!chatImportText.trim() || !chatImportConfirmed} onClick={prepareChatImport} className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">確認用の下書きを作る</button>
            </div>
          </div>
        )}
        {showRecord && (
          <div id="consultation-record-editor" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            {recordForm.observations?.includes('【移行元】') && <div className="mb-4 rounded-lg border border-violet-200 bg-white p-3 text-xs text-violet-800">ChatGPT相談履歴から作成した下書きです。事実・考察・別人の情報が混ざっていないか、元の履歴と照合してから保存してください。</div>}
            {recordForm.source_form_submission_id && <div className="mb-4 rounded-lg border border-blue-200 bg-white p-3 text-xs text-blue-800">フォーム回答を下書きへ取り込みました。内容を確認・修正してから保存してください。</div>}
            {chartSuggestions.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-semibold text-amber-900">基本カルテへの反映候補</div>
                <p className="mt-1 text-xs text-amber-800">既存値がある項目は安全のため未選択です。内容を確認してください。</p>
                <div className="mt-3 space-y-2">
                  {chartSuggestions.map((suggestion, index) => (
                    <label key={suggestion.field} className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm">
                      <input type="checkbox" checked={suggestion.selected} onChange={(event) => setChartSuggestions((current) => current.map((item, i) => i === index ? { ...item, selected: event.target.checked } : item))} className="mt-1 rounded border-gray-300" />
                      <span><span className="font-medium text-gray-800">{suggestion.label}</span><span className="ml-2 whitespace-pre-wrap text-gray-600">{suggestion.value}</span>{chartForm[suggestion.field] && <span className="mt-1 block text-xs text-red-600">現在値: {chartForm[suggestion.field]}</span>}</span>
                    </label>
                  ))}
                </div>
                <button type="button" onClick={applyChartSuggestions} disabled={!chartSuggestions.some((item) => item.selected)} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">選択した基本情報を入力欄へ反映</button>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="相談日時" type="datetime-local" value={recordForm.consultation_at} onChange={(value) => setRecordForm({ ...recordForm, consultation_at: value })} />
              <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">相談方法</span><select value={recordForm.consultation_type || 'in_person'} onChange={(event) => setRecordForm({ ...recordForm, consultation_type: event.target.value })} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="in_person">対面</option><option value="zoom">Zoom</option><option value="phone">電話</option><option value="line">LINE</option></select></label>
              <TextArea label="主な相談内容" value={recordForm.chief_complaint} onChange={(value) => setRecordForm({ ...recordForm, chief_complaint: value })} />
              <TextArea label="観察・聞き取り" value={recordForm.observations} onChange={(value) => setRecordForm({ ...recordForm, observations: value })} />
              <TextArea label="提案内容" value={recordForm.recommendation} onChange={(value) => setRecordForm({ ...recordForm, recommendation: value })} />
              <TextArea label="商品・処方内容" value={recordForm.products} onChange={(value) => setRecordForm({ ...recordForm, products: value })} />
              <TextArea label="使用方法・服用方法" value={recordForm.usage_instructions} onChange={(value) => setRecordForm({ ...recordForm, usage_instructions: value })} />
              <TextArea label="次回確認・フォロー計画" value={recordForm.follow_up_plan} onChange={(value) => setRecordForm({ ...recordForm, follow_up_plan: value })} />
              <Input label="フォロー期限" type="date" value={recordForm.follow_up_due_date} onChange={(value) => setRecordForm({ ...recordForm, follow_up_due_date: value || null })} />
            </div>
            <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setShowRecord(false)} className="rounded-lg border bg-white px-4 py-2 text-sm">閉じる</button><button type="button" disabled={saving} onClick={() => void addRecord()} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">相談記録を保存</button></div>
          </div>
        )}
        <div className="mt-4 space-y-3">
          {detail?.records.map((record) => <RecordCard key={record.id} record={record} saving={saving} onFollowUp={(completed) => void setFollowUpCompleted(record, completed)} onDraft={() => openFollowUpDraft(record)} />)}
          {detail?.records.length === 0 && <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500">相談記録はまだありません。</div>}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">予約履歴</h2>
          <button type="button" onClick={() => { setShowProlineImport(!showProlineImport); setProlinePreview(null); setProlineImportConfirmed(false) }} className="rounded-lg border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800">プロライン予約を取り込む</button>
        </div>
        {showProlineImport && (
          <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
            <h3 className="text-sm font-semibold text-cyan-950">プロライン予約を3段階で取り込む</h3>
            <p className="mt-1 text-xs leading-5 text-cyan-900">LINE送信やプロライン側の変更は行いません。通知文そのものは保存せず、日時・相談メニュー・予約状態だけを保存します。</p>
            <div className="mt-3 text-xs font-semibold text-cyan-950">1. 予約受付またはキャンセルの通知文を貼り付ける</div>
            <textarea rows={8} maxLength={12000} value={prolineNoticeText} onChange={(event) => { setProlineNoticeText(event.target.value); setProlinePreview(null); setProlineImportConfirmed(false) }} placeholder={'例：\nスケジュール/イベント予約機能で、予約を受け付けました。\n予約カレンダー：2:（購入のお客様）オンライン個別カウンセリング\n予約日時：2026年07月28日（火）10:00 ～ 11:00'} className="mt-2 w-full rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm" />
            <div className="mt-3 flex justify-end">
              <button type="button" disabled={saving || !prolineNoticeText.trim()} onClick={() => void previewProlineBooking()} className="rounded-lg bg-cyan-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? '読取中…' : '2. 通知内容を読み取る'}</button>
            </div>
            {prolinePreview && (
              <div className="mt-4 rounded-lg border border-cyan-300 bg-white p-4">
                <div className="text-sm font-semibold text-cyan-950">読み取った内容</div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-gray-500">お客様</dt><dd className="font-medium text-gray-900">{detail?.chart?.customer_name || detail?.friend.display_name || 'お客様'}</dd></div>
                  <div><dt className="text-xs text-gray-500">予約状態</dt><dd className={`font-semibold ${prolinePreview.status === 'cancelled' ? 'text-red-700' : 'text-green-700'}`}>{prolinePreview.status === 'cancelled' ? 'キャンセル' : '予約済み'}</dd></div>
                  <div><dt className="text-xs text-gray-500">開始日時</dt><dd className="font-medium text-gray-900">{new Date(prolinePreview.starts_at).toLocaleString('ja-JP')}</dd></div>
                  <div><dt className="text-xs text-gray-500">終了日時</dt><dd className="font-medium text-gray-900">{prolinePreview.ends_at ? new Date(prolinePreview.ends_at).toLocaleString('ja-JP') : '通知に記載なし'}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs text-gray-500">相談メニュー</dt><dd className="font-medium text-gray-900">{prolinePreview.menu_name || '通知に記載なし'}</dd></div>
                </dl>
                <label className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <input type="checkbox" checked={prolineImportConfirmed} onChange={(event) => setProlineImportConfirmed(event.target.checked)} className="mt-0.5 rounded border-gray-300" />
                  <span>3. 上の内容が、現在開いている「{detail?.chart?.customer_name || detail?.friend.display_name || 'お客様'}」の予約であることを確認しました。</span>
                </label>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowProlineImport(false); setProlinePreview(null); setProlineImportConfirmed(false) }} className="rounded-lg border bg-white px-4 py-2 text-sm">閉じる</button>
              <button type="button" disabled={saving || !prolinePreview || !prolineImportConfirmed} onClick={() => void importProlineBooking()} className="rounded-lg bg-green-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? '保存中…' : 'この内容を予約履歴へ保存'}</button>
            </div>
          </div>
        )}
        <div className="mt-3 space-y-2">
          {detail?.bookings.map((booking) => {
            const statusLabels: Record<string, string> = { requested: '確認待ち', confirmed: '予約確定', scheduled: '予約済み', cancelled: 'キャンセル', completed: '完了', no_show: '来店なし' }
            const sourceLabel = booking.source === 'proline' ? 'プロライン' : '鈴木薬舗OS'
            return <div key={`${booking.source}-${booking.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"><span>{new Date(booking.starts_at).toLocaleString('ja-JP')} · {booking.menu_name || '予約メニュー未記載'}</span><span className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-xs ${booking.source === 'proline' ? 'bg-cyan-100 text-cyan-800' : 'bg-green-100 text-green-800'}`}>{sourceLabel}</span><span className="text-gray-500">{statusLabels[booking.status] || booking.status}</span></span></div>
          })}
          {detail?.bookings.length === 0 && <p className="text-sm text-gray-500">予約履歴はありません。</p>}
        </div>
      </section>
      {sendRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="フォローLINE送信確認">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">フォローLINEの確認</h2><p className="mt-1 text-sm text-gray-500">送信先: {detail?.chart?.customer_name || detail?.friend.display_name || 'お客様'}</p></div><button type="button" onClick={() => setSendRecord(null)} className="text-2xl text-gray-400" aria-label="閉じる">×</button></div>
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">症状・商品名・薬・アレルギーなどの健康情報は自動挿入していません。追記する場合は、LINEで送ってよい内容か確認してください。</div>
            <label className="mt-4 block"><span className="text-sm font-medium text-gray-700">送信文面</span><textarea rows={7} maxLength={1000} value={followMessage} onChange={(event) => { setFollowMessage(event.target.value); setSendConfirmed(false) }} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" /><span className="mt-1 block text-right text-xs text-gray-400">{followMessage.length}/1000</span></label>
            <label className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800"><input type="checkbox" checked={sendConfirmed} onChange={(event) => setSendConfirmed(event.target.checked)} className="mt-0.5 rounded border-gray-300" /><span>送信先と文面を確認しました。LINE公式アカウントの配信通数を1通消費して送信します。</span></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setSendRecord(null)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm">キャンセル</button><button type="button" disabled={saving || !sendConfirmed || !followMessage.trim()} onClick={() => void sendFollowUp()} className="rounded-lg bg-[#06C755] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? '送信中…' : '確認して1通送信'}</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value?: string | null; onChange: (value: string) => void; type?: string }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">{label}</span><input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" /></label>
}

function TextArea({ label, value, onChange, className = '' }: { label: string; value?: string | null; onChange: (value: string) => void; className?: string }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">{label}</span><textarea rows={3} value={value || ''} onChange={(event) => onChange(event.target.value)} className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm ${className}`} /></label>
}

function RecordCard({ record, saving, onFollowUp, onDraft }: { record: ConsultationRecord; saving: boolean; onFollowUp: (completed: boolean) => void; onDraft: () => void }) {
  const typeLabel: Record<string, string> = { in_person: '対面', zoom: 'Zoom', phone: '電話', line: 'LINE' }
  const rows = [['相談内容', record.chief_complaint], ['観察・聞き取り', record.observations], ['提案', record.recommendation], ['商品・処方', record.products], ['使用方法', record.usage_instructions], ['次回フォロー', record.follow_up_plan]]
  const overdue = Boolean(record.follow_up_due_date && !record.follow_up_completed_at && record.follow_up_due_date < localDateTimeValue().slice(0, 10))
  return <article className="rounded-xl border border-gray-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium text-gray-900">{new Date(record.consultation_at).toLocaleString('ja-JP')}</h3><span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{typeLabel[record.consultation_type] || record.consultation_type}</span></div><dl className="mt-3 grid gap-3 md:grid-cols-2">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-gray-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{value}</dd></div>)}</dl>{record.follow_up_due_date && <div className={`mt-4 rounded-lg p-3 ${record.follow_up_completed_at ? 'bg-green-50' : overdue ? 'bg-red-50' : 'bg-amber-50'}`}><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold text-gray-800">フォロー期限: {record.follow_up_due_date}</div><div className="mt-0.5 text-xs text-gray-600">{record.follow_up_completed_at ? `完了: ${new Date(record.follow_up_completed_at).toLocaleString('ja-JP')}` : overdue ? '期限を過ぎています' : '未完了'}{record.follow_up_last_sent_at ? ` · LINE送信: ${new Date(record.follow_up_last_sent_at).toLocaleString('ja-JP')}` : ''}</div></div><div className="flex gap-2"><button type="button" disabled={saving} onClick={onDraft} className="rounded-lg border border-green-300 bg-white px-3 py-2 text-xs font-semibold text-green-700 disabled:opacity-50">LINE下書き</button><button type="button" disabled={saving} onClick={() => onFollowUp(!record.follow_up_completed_at)} className={`rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${record.follow_up_completed_at ? 'bg-gray-500' : 'bg-green-600'}`}>{record.follow_up_completed_at ? '未完了へ戻す' : 'フォロー完了'}</button></div></div></div>}</article>
}

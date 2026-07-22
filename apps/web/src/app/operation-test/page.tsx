'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { consultationChartApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type Result = Awaited<ReturnType<typeof consultationChartApi.operationTest>>

const targetLabels: Record<string, string> = {
  customer_name: '基本カルテ：氏名', customer_name_kana: '基本カルテ：ふりがな',
  birth_date: '基本カルテ：生年月日', phone: '基本カルテ：電話番号',
  allergies: '基本カルテ：アレルギー・禁忌', current_medications: '基本カルテ：使用中の医薬品',
  safety_notes: '基本カルテ：注意事項', general_notes: '基本カルテ：基本メモ',
  chief_complaint: '相談記録：主な相談内容', observations: '相談記録：観察・聞き取り',
  recommendation: '相談記録：提案内容', products: '相談記録：商品・処方内容',
  usage_instructions: '相談記録：使用方法', follow_up_plan: '相談記録：フォロー計画',
}

export default function OperationTestPage() {
  const { selectedAccountId } = useAccount()
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true); setError('')
    try { setResult(await consultationChartApi.operationTest(selectedAccountId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '総合テストを実行できませんでした。') }
    finally { setLoading(false) }
  }, [selectedAccountId])

  useEffect(() => { void run() }, [run])

  const ready = result?.checks.filter((check) => check.status === 'ready').length || 0
  const total = result?.checks.length || 0
  return (
    <div>
      <Header title="運用前総合テスト" description="本番データや配信通数を使わず、鈴木薬舗OSの設定を確認します" />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
        <div><div className="text-sm font-semibold text-green-900">読み取り専用テスト</div><p className="mt-1 text-xs text-green-800">お客様作成・予約作成・カルテ保存・LINE送信・外部API通信は行いません。</p></div>
        <button type="button" disabled={loading || !selectedAccountId} onClick={() => void run()} className="rounded-lg bg-[#06C755] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{loading ? '点検中…' : 'もう一度点検'}</button>
      </div>
      {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!selectedAccountId ? <div className="rounded-xl border bg-white p-10 text-center text-sm text-gray-500">LINEアカウントを選択してください。</div> : loading && !result ? <div className="rounded-xl border bg-white p-10 text-center text-sm text-gray-500">設定を点検しています…</div> : result && (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-gray-900">設定点検</h2><span className={`rounded-full px-3 py-1 text-sm font-semibold ${ready === total ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{ready}/{total} 項目準備済み</span></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {result.checks.map((check) => <Link key={check.key} href={check.href} className={`rounded-xl border p-4 hover:shadow-sm ${check.status === 'ready' ? 'border-green-200 bg-green-50' : check.status === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-gray-900">{check.label}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${check.status === 'ready' ? 'bg-green-600 text-white' : check.status === 'warning' ? 'bg-amber-500 text-white' : 'bg-red-600 text-white'}`}>{check.status === 'ready' ? '準備済み' : check.status === 'warning' ? '要確認' : '要対応'}</span></div><p className="mt-2 text-xs text-gray-600">{check.detail}</p><div className="mt-2 text-xs font-medium text-blue-600">設定画面を開く →</div></Link>)}
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="font-semibold text-blue-950">架空のお客様による流れの確認</h2>
            <p className="mt-1 text-xs text-blue-800">「{result.simulation.customerName}」の仮回答で計算した結果です。何も保存していません。</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl bg-white p-4"><h3 className="text-sm font-semibold text-gray-900">1. フォーム回答</h3><p className="mt-1 text-xs text-gray-500">{result.simulation.formName || '受付中フォームなし'}</p><dl className="mt-3 space-y-2">{Object.entries(result.simulation.answers).map(([key, value]) => <div key={key}><dt className="text-[11px] text-gray-400">{key}</dt><dd className="text-xs text-gray-700">{String(value)}</dd></div>)}</dl></div>
              <div className="rounded-xl bg-white p-4"><h3 className="text-sm font-semibold text-gray-900">2. 付く予定のタグ</h3><div className="mt-3 flex flex-wrap gap-2">{result.simulation.tags.map((tag) => <span key={tag.id} className="rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-800">{tag.name}</span>)}{result.simulation.tags.length === 0 && <span className="text-xs text-gray-500">該当タグなし</span>}</div></div>
              <div className="rounded-xl bg-white p-4"><h3 className="text-sm font-semibold text-gray-900">3. カルテ振り分け</h3><div className="mt-3 space-y-2">{result.simulation.mappings.map((mapping, index) => <div key={`${mapping.question}-${index}`} className="rounded-lg bg-blue-50 p-2"><div className="text-[11px] font-medium text-blue-700">{targetLabels[mapping.target] || mapping.target}</div><div className="mt-0.5 text-xs text-gray-700">{mapping.question}: {mapping.value}</div></div>)}{result.simulation.mappings.length === 0 && <span className="text-xs text-gray-500">振り分け設定なし</span>}</div></div>
            </div>
            <div className="mt-4 rounded-lg bg-white/70 p-3 text-xs text-blue-900">予約候補: 有効メニュー {result.simulation.booking.menus}件・担当者 {result.simulation.booking.staff}名 ／ 外部への書き込み: 0件</div>
          </section>
        </>
      )}
    </div>
  )
}

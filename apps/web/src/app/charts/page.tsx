'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { consultationChartApi, type ConsultationChartListItem } from '@/lib/api'
import { api } from '@/lib/api'
import type { Tag } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'

export default function ChartsPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<ConsultationChartListItem[]>([])
  const [search, setSearch] = useState('')
  const [safety, setSafety] = useState('all')
  const [tagId, setTagId] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError('')
    try {
      const result = await consultationChartApi.list(selectedAccountId, { search, safety, tagId })
      setItems(result.charts)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'カルテ一覧を読み込めませんでした。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, search, safety, tagId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void api.tags.list().then((result) => { if (result.success) setTags(result.data) }).catch(() => undefined)
  }, [])

  return (
    <div>
      <Header title="相談カルテ" description="お客様ごとの基本情報と相談履歴を安全に管理します" />
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        健康情報はLINEメッセージやGoogleカレンダーへ自動転記されません。必要な担当者だけがこの管理画面で確認します。
      </div>
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex gap-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="LINE表示名・氏名・ふりがなで検索" className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm" />
          <button type="button" onClick={() => void load()} className="rounded-lg bg-[#06C755] px-4 py-2 text-sm font-semibold text-white">検索</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[['all', 'すべて'], ['safety_notes', '要注意事項'], ['allergies', 'アレルギーあり'], ['medications', '服薬・使用中']].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setSafety(value)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${safety === value ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{label}</button>
          ))}
          <select value={tagId} onChange={(event) => setTagId(event.target.value)} className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700">
            <option value="">すべてのタグ</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
          {(safety !== 'all' || tagId) && <button type="button" onClick={() => { setSafety('all'); setTagId('') }} className="px-2 text-xs text-blue-600 hover:underline">絞り込みを解除</button>}
        </div>
      </div>
      {!selectedAccountId ? (
        <div className="rounded-xl border bg-white p-10 text-center text-sm text-gray-500">LINEアカウントを選択してください。</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <div className="rounded-xl border bg-white p-10 text-center text-sm text-gray-500">読み込み中…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {items.map((item) => (
            <Link key={item.friend_id} href={`/charts/detail?friend=${encodeURIComponent(item.friend_id)}`} className="flex items-center gap-3 border-b border-gray-100 p-4 last:border-0 hover:bg-gray-50">
              {item.picture_url ? <img src={item.picture_url} alt="" className="h-11 w-11 rounded-full object-cover" /> : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-100 font-bold text-green-700">{(item.customer_name || item.friend_name || '?').slice(0, 1)}</div>}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900">{item.customer_name || item.friend_name || '名前未設定'}</div>
                <div className="mt-1 text-xs text-gray-500">LINE: {item.friend_name || '表示名なし'} · 相談記録 {item.consultation_count || 0}件</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.has_safety_notes && <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">要注意事項</span>}
                  {item.has_allergies && <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">アレルギーあり</span>}
                  {item.has_medications && <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">服薬・使用中</span>}
                  {item.tags.slice(0, 3).map((tag) => <span key={tag.id} className="rounded px-2 py-0.5 text-[11px]" style={{ backgroundColor: `${tag.color}20`, color: tag.color }}>{tag.name}</span>)}
                  {item.tags.length > 3 && <span className="text-[11px] text-gray-400">+{item.tags.length - 3}</span>}
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs ${item.chart_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{item.chart_id ? 'カルテあり' : '未作成'}</span>
            </Link>
          ))}
          {items.length === 0 && <div className="p-10 text-center text-sm text-gray-500">該当するお客様はいません。</div>}
        </div>
      )}
    </div>
  )
}

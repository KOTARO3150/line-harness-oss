'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type VideoItem = {
  id: string
  title: string
  description: string | null
  category: string
  videoUrl: string
  thumbnailUrl: string | null
  sortOrder: number
  isFeatured: boolean
  isActive: boolean
}

const emptyForm = {
  title: '', description: '', category: 'お悩み別', videoUrl: '', thumbnailUrl: '',
  sortOrder: 0, isFeatured: false, isActive: true,
}

export default function VideoLibraryPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [items, setItems] = useState<VideoItem[]>([])
  const [guideUrl, setGuideUrl] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    const res = await fetchApi<{ success: boolean; data: { items: VideoItem[]; guideUrl: string | null } }>(
      `/api/video-library?accountId=${encodeURIComponent(selectedAccountId)}`,
    )
    if (res.success) {
      setItems(res.data.items)
      setGuideUrl(res.data.guideUrl)
    }
  }, [selectedAccountId])

  useEffect(() => { load().catch(() => setError('動画一覧を読み込めませんでした。')) }, [load])

  const reset = () => { setEditingId(null); setForm(emptyForm) }

  const save = async () => {
    if (!selectedAccountId || !form.title.trim() || !form.videoUrl.trim()) {
      setError('タイトルと動画URLを入力してください。')
      return
    }
    setSaving(true); setError(''); setMessage('')
    try {
      const path = editingId ? `/api/video-library/${editingId}` : '/api/video-library'
      const res = await fetchApi<{ success: boolean; error?: string }>(path, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, lineAccountId: selectedAccountId }),
      })
      if (!res.success) throw new Error(res.error || '保存できませんでした。')
      setMessage(editingId ? '動画を更新しました。' : '動画を追加しました。')
      reset(); await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存できませんでした。')
    } finally { setSaving(false) }
  }

  const edit = (item: VideoItem) => {
    setEditingId(item.id)
    setForm({
      title: item.title, description: item.description || '', category: item.category,
      videoUrl: item.videoUrl, thumbnailUrl: item.thumbnailUrl || '', sortOrder: item.sortOrder,
      isFeatured: item.isFeatured, isActive: item.isActive,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (item: VideoItem) => {
    if (!confirm(`「${item.title}」を削除しますか？`)) return
    await fetchApi(`/api/video-library/${item.id}`, { method: 'DELETE' })
    await load()
  }

  const importPreset = async () => {
    if (!selectedAccountId) return
    setImporting(true); setError(''); setMessage('')
    try {
      const res = await fetchApi<{ success: boolean; data?: { created: number; skipped: number }; error?: string }>(
        '/api/video-library/import-suzuki-preset',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineAccountId: selectedAccountId }) },
      )
      if (!res.success) throw new Error(res.error || '動画を取り込めませんでした。')
      setMessage(`${res.data?.created ?? 0}本を取り込みました。重複している動画は追加していません。`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '動画を取り込めませんでした。')
    } finally { setImporting(false) }
  }

  return (
    <>
      <div className="px-4 pt-6 sm:px-6"><Header title="動画案内所" description="ステップとは別に、お客様が必要なときにいつでも見られる動画を整えます" /></div>
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-lg font-bold text-emerald-950">LINEメニューの「動画を見る」に設定するURL</h2>
          <p className="mt-1 text-sm text-emerald-800">このURLをリッチメニューのURIに設定すると、ステップに参加していない方もすぐ見られます。</p>
          {guideUrl ? <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input readOnly value={guideUrl} className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm" />
            <button onClick={() => navigator.clipboard.writeText(guideUrl).then(() => setMessage('URLをコピーしました。'))} className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white">URLをコピー</button>
            <a href={guideUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-700 bg-white px-4 py-2 text-center font-bold text-emerald-800">お客様画面を確認</a>
          </div> : <p className="mt-3 font-bold text-amber-700">このLINEアカウントのLIFF IDを設定するとURLが表示されます。</p>}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">{editingId ? '動画を編集' : '動画を追加'}</h2>
          <p className="mt-1 text-sm text-gray-500">まず「鈴木薬舗の考え方」を1本だけおすすめ動画にし、ほかは症状別に整理するのがおすすめです。</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">タイトル<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="例：はじめての方へ" /></label>
            <label className="text-sm font-medium">分類<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="例：皮膚のお悩み" /></label>
            <label className="text-sm font-medium sm:col-span-2">短い説明<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" rows={2} placeholder="この動画で分かることを、安心できる言葉で1〜2行" /></label>
            <label className="text-sm font-medium sm:col-span-2">動画URL<input value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="https://www.youtube.com/watch?v=..." /></label>
            <label className="text-sm font-medium">サムネイル画像URL（任意）<input value={form.thumbnailUrl} onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="https://..." /></label>
            <label className="text-sm font-medium">表示順<input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          </div>
          <div className="mt-4 flex flex-wrap gap-5 text-sm">
            <label><input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} className="mr-2" />「まず最初に」に表示</label>
            <label><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="mr-2" />お客様に公開</label>
          </div>
          <div className="mt-5 flex gap-3"><button disabled={saving} onClick={save} className="rounded-lg bg-emerald-700 px-5 py-2 font-bold text-white disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>{editingId && <button onClick={reset} className="rounded-lg border px-5 py-2">編集をやめる</button>}</div>
          {message && <p className="mt-3 text-sm font-bold text-emerald-700">{message}</p>}
          {error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">登録済み動画（{items.length}本）</h2>
          {items.length < 13 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-bold text-amber-950">プロラインにある13本を一度に取り込めます</p><p className="mt-1 text-sm text-amber-800">取り込み後も、題名・説明・公開状態・順番を1本ずつ変更できます。同じ動画は重複登録しません。</p><button disabled={importing} onClick={importPreset} className="mt-3 rounded-lg bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50">{importing ? '取り込み中…' : '13本の動画を取り込む'}</button></div>}
          {items.length === 0 ? <div className="mt-4 rounded-xl bg-gray-50 p-6 text-gray-600">まだ動画は登録されていません。上のボタンから13本をまとめて取り込めます。</div> : <div className="mt-4 space-y-3">{items.map((item) => <article key={item.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs">{item.category}</span>{item.isFeatured && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">まず最初に</span>}{!item.isActive && <span className="rounded-full bg-red-50 px-2 py-1 text-xs text-red-700">非公開</span>}</div><h3 className="mt-2 font-bold">{item.title}</h3><p className="truncate text-sm text-gray-500">{item.description || item.videoUrl}</p></div>
            <div className="flex gap-2"><button onClick={() => edit(item)} className="rounded-lg border px-3 py-2 text-sm">編集</button><button onClick={() => remove(item)} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">削除</button></div>
          </article>)}</div>}
        </section>
        <p className="text-xs text-gray-500">選択中のLINEアカウント：{selectedAccount?.displayName || selectedAccount?.name || '未選択'}</p>
      </main>
    </>
  )
}

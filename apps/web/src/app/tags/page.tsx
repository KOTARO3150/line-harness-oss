'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type TagWithUsage, type TagUsage } from '@/lib/api'
import Header from '@/components/layout/header'

// タグはお客様の分類の土台。プロラインを畳んだあと、ここが唯一の管理場所になる。
//
// 削除には注意が要る: tags を消すと、参照している列は ON DELETE SET NULL で
// 黙って NULL になる（シナリオの起動タグ、フォームのタグ付与、流入経路のタグ…）。
// シナリオ自体は残るのに起動条件だけ消える、という気づきにくい壊れ方をするので、
// 参照が残っているタグは API 側が 409 で止め、この画面で内訳を見せてから消す。

const PRESET_COLORS = [
  '#3B82F6', '#06C755', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#6B7280',
]

const USAGE_LABELS: { key: keyof TagUsage; label: string; href?: string }[] = [
  { key: 'scenarioTriggers', label: 'シナリオの起動条件', href: '/scenarios' },
  { key: 'scenarioSteps', label: 'シナリオの到達タグ', href: '/scenarios' },
  { key: 'forms', label: 'フォームの回答時付与', href: '/forms' },
  { key: 'entryRoutes', label: '流入経路', href: '/inflow-links' },
  { key: 'trackedLinks', label: '計測リンク' },
  { key: 'bookingMenus', label: '予約メニュー', href: '/booking/menus' },
  { key: 'affiliateOffers', label: 'アフィリエイト案件' },
  { key: 'broadcasts', label: '一斉配信の宛先' },
]

type Draft = { id: string | null; name: string; color: string }

export default function TagsPage() {
  const [items, setItems] = useState<TagWithUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TagWithUsage | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.tags.listWithUsage()
      if (res.success) setItems(res.data)
      else setError(res.error || '読み込みに失敗しました')
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) { setError('タグ名を入れてください'); return }
    setSaving(true)
    setError('')
    try {
      const res = draft.id
        ? await api.tags.update(draft.id, { name, color: draft.color })
        : await api.tags.create({ name, color: draft.color })
      if (!res.success) { setError(res.error || '保存に失敗しました'); return }
      setDraft(null)
      await load()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (tag: TagWithUsage, force: boolean) => {
    setDeleting(true)
    setError('')
    try {
      const res = await api.tags.delete(tag.id, { force })
      if (!res.success) { setError(res.error || '削除に失敗しました'); return }
      setConfirmDelete(null)
      await load()
    } catch {
      setError('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  const usedIn = (usage: TagUsage) =>
    USAGE_LABELS.filter((u) => usage[u.key] > 0)

  // API は「設定からの参照」か「友だちへの付与」が残っていると 409 で断る。
  // どちらも取り消しがきかないので、画面で内訳を見せてから force を渡す。
  const needsForce = (t: TagWithUsage) => t.automationRefs > 0 || t.usage.friends > 0

  return (
    <div>
      <Header
        title="タグ管理"
        action={
          <button
            onClick={() => setDraft({ id: null, name: '', color: PRESET_COLORS[0] })}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規タグ
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
        <p>タグ名を変えても、シナリオやフォームとの紐づけは切れません（内部の ID は変わらないため）。</p>
        <p>削除は別です。<strong>使われているタグを消すと、シナリオの起動条件などが黙って外れます。</strong>「使われている場所」が空のタグだけがそのまま消せます。</p>
      </div>

      {draft && (
        <div className="mb-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">
            {draft.id ? 'タグを編集' : '新しいタグ'}
          </h2>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">タグ名</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例: 体質:冷え"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">色</label>
              <div className="flex gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`色 ${c}`}
                    onClick={() => setDraft({ ...draft, color: c })}
                    className={`w-7 h-7 rounded-full border-2 ${draft.color === c ? 'border-gray-900' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => { setDraft(null); setError('') }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg"
              >
                やめる
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-lg">
          <h2 className="text-sm font-semibold text-amber-900 mb-2">
            「{confirmDelete.name}」を削除しますか？
          </h2>
          {confirmDelete.usage.friends > 0 && (
            <p className="text-xs text-amber-900 mb-2">
              <strong>このタグが付いているお客様 {confirmDelete.usage.friends} 人ぶんの付与が消えます。</strong>
              お客様の情報自体は残りますが、「誰がこの分類か」は元に戻せません。
            </p>
          )}
          {confirmDelete.automationRefs > 0 ? (
            <>
              <p className="text-xs text-amber-900 mb-1">
                <strong>次の設定が、警告なしに無効になります。</strong>
              </p>
              <ul className="text-xs text-amber-900 list-disc pl-5 mb-3">
                {usedIn(confirmDelete.usage)
                  .filter((u) => u.key !== 'friends')
                  .map((u) => (
                    <li key={u.key}>
                      {u.label}: {confirmDelete.usage[u.key]} 件
                      {u.href && (
                        <a href={u.href} className="ml-2 text-blue-600 hover:underline">確認する</a>
                      )}
                    </li>
                  ))}
              </ul>
              <p className="text-xs text-amber-900 mb-3">
                先に上の設定から外してから消すことをおすすめします。
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-900 mb-3">
              このタグを参照している設定はありません。
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => remove(confirmDelete, needsForce(confirmDelete))}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg disabled:opacity-50"
            >
              {deleting
                ? '削除中...'
                : needsForce(confirmDelete)
                  ? '承知のうえで削除'
                  : '削除'}
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg"
            >
              やめる
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">タグ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">付いている人数</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">使われている場所</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">読み込み中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">タグがまだありません</td></tr>
              ) : (
                items.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: t.color }}
                      >
                        {t.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{t.usage.friends} 人</td>
                    <td className="px-4 py-3">
                      {t.automationRefs === 0 ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {usedIn(t.usage).map((u) => (
                            <span
                              key={u.key}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-700"
                            >
                              {u.label} {t.usage[u.key]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => { setDraft({ id: t.id, name: t.name, color: t.color }); setError('') }}
                        className="text-xs text-blue-600 hover:underline mr-3"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => { setConfirmDelete(t); setError('') }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

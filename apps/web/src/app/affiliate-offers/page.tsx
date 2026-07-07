'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api, type AffiliateOffer, type ConversionApprovalItem } from '@/lib/api'
import type { Tag, Scenario, LineAccount } from '@line-crm/shared'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatYen(n: number | null): string {
  if (n === null) return '—'
  return `¥${Math.round(n).toLocaleString('ja-JP')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Offer form modal
// ─────────────────────────────────────────────────────────────────────────────

interface OfferFormProps {
  initial?: AffiliateOffer | null
  accounts: LineAccount[]
  tags: Tag[]
  scenarios: (Scenario & { stepCount?: number })[]
  onClose: () => void
  onSaved: () => void
}

function OfferFormModal({ initial, accounts, tags, scenarios, onClose, onSaved }: OfferFormProps) {
  const isEdit = Boolean(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [rewardAmount, setRewardAmount] = useState(
    initial?.rewardAmount != null ? String(initial.rewardAmount) : '',
  )
  const [lineAccountId, setLineAccountId] = useState(initial?.lineAccountId ?? '')
  const [tagId, setTagId] = useState(initial?.tagId ?? '')
  const [scenarioId, setScenarioId] = useState(initial?.scenarioId ?? '')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setFormError(null)
    if (!name.trim()) {
      setFormError('案件名は必須です')
      return
    }
    const reward =
      rewardAmount.trim() === ''
        ? undefined
        : Number(rewardAmount)
    if (reward !== undefined && (!Number.isInteger(reward) || reward < 0)) {
      setFormError('報酬額は0以上の整数で入力してください')
      return
    }

    setSubmitting(true)
    try {
      if (isEdit && initial) {
        const res = await api.affiliateOffers.update(initial.id, {
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
          isActive,
        })
        if (!res.success) {
          setFormError('更新に失敗しました')
          setSubmitting(false)
          return
        }
      } else {
        const res = await api.affiliateOffers.create({
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
        })
        if (!res.success) {
          setFormError('作成に失敗しました')
          setSubmitting(false)
          return
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, name, description, rewardAmount, lineAccountId, tagId, scenarioId, isActive, isEdit, initial, onSaved, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? '案件を編集' : '案件を新規作成'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="閉じる"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              案件名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 無料体験申込"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">説明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="案件の説明（任意）"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">報酬額（円）</label>
            <input
              type="number"
              min="0"
              step="1"
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
              placeholder="例: 3000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">誘導 LINE アカウント</label>
            <select
              value={lineAccountId}
              onChange={(e) => setLineAccountId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">タグ</label>
            <select
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">シナリオ</label>
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {isEdit && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isActive ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm text-gray-700">{isActive ? '有効' : '無効'}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={() => { void handleSubmit() }}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            {submitting ? '保存中...' : isEdit ? '更新' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval queue tab
// ─────────────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'pending' | 'approved' | 'rejected'

function ApprovalQueue() {
  const [status, setStatus] = useState<ApprovalStatus>('pending')
  const [items, setItems] = useState<ConversionApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actioning, setActioning] = useState<string | null>(null)

  const loadItems = useCallback(async (s: ApprovalStatus) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.conversionApprovals.list({ status: s, limit: 200 })
      if (res.success) {
        setItems(res.data)
      } else {
        setError('読み込みに失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みエラー')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadItems(status) }, [status, loadItems])

  const handleApprove = useCallback(async (eventId: string) => {
    if (actioning) return
    setActioning(eventId)
    setError(null)
    try {
      const res = await api.conversionApprovals.approve(eventId)
      if (res.success) {
        setItems((prev) => prev.filter((i) => i.eventId !== eventId))
      } else {
        setError(res.error ?? '承認に失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '承認に失敗しました')
    }
    setActioning(null)
  }, [actioning])

  const handleReject = useCallback(async (eventId: string) => {
    if (actioning) return
    setActioning(eventId)
    setError(null)
    try {
      const res = await api.conversionApprovals.reject(eventId)
      if (res.success) {
        setItems((prev) => prev.filter((i) => i.eventId !== eventId))
      } else {
        setError(res.error ?? '却下に失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '却下に失敗しました')
    }
    setActioning(null)
  }, [actioning])

  return (
    <div>
      {/* Status filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-4 py-1.5 text-sm rounded-full font-medium transition-colors ${
              status === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'pending' ? '承認待ち' : s === 'approved' ? '承認済み' : '却下済み'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          {status === 'pending' ? '承認待ちの成果がありません' : `${status === 'approved' ? '承認済み' : '却下済み'}の成果がありません`}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">日時</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">友だち</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">アフィリエイター</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CV ポイント</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">金額</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">フラグ</th>
                {status === 'pending' && (
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => (
                <tr key={item.eventId} className={item.duplicateFlag ? 'bg-amber-50' : ''}>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {item.friendName ?? <span className="text-gray-400 italic">不明</span>}
                    <span className="block text-xs font-mono text-gray-400">{item.friendId.slice(0, 8)}…</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {item.affiliateName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {item.offerName ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {item.offerName}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {item.conversionPointName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                    {formatYen(item.value)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.duplicateFlag ? (
                      <span className="text-amber-500 text-base" title="重複 identity_key 検出">⚠</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  {status === 'pending' && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => { void handleApprove(item.eventId) }}
                          disabled={actioning === item.eventId}
                          className="px-3 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md"
                        >
                          承認
                        </button>
                        <button
                          onClick={() => { void handleReject(item.eventId) }}
                          disabled={actioning === item.eventId}
                          className="px-3 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-md"
                        >
                          却下
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Offers list tab
// ─────────────────────────────────────────────────────────────────────────────

function OffersList({
  offers,
  accounts,
  tags,
  scenarios,
  loading,
  error,
  onEdit,
  onRefresh,
}: {
  offers: AffiliateOffer[]
  accounts: LineAccount[]
  tags: Tag[]
  scenarios: (Scenario & { stepCount?: number })[]
  loading: boolean
  error: string | null
  onEdit: (offer: AffiliateOffer) => void
  onRefresh: () => void
}) {
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]))
  const tagMap = new Map(tags.map((t) => [t.id, t.name]))
  const scenarioMap = new Map(scenarios.map((s) => [s.id, s.name]))

  return (
    <div>
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : offers.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          案件がまだ登録されていません。右上の「+ 新規案件」から作成してください。
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">説明</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">報酬額</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">LINEアカウント</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">タグ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">シナリオ</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">状態</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {offers.map((offer) => (
                <tr key={offer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{offer.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">
                    {offer.description ?? <span className="italic text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-emerald-700">
                    {formatYen(offer.rewardAmount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {offer.lineAccountId ? accountMap.get(offer.lineAccountId) ?? offer.lineAccountId : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {offer.tagId ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        {tagMap.get(offer.tagId) ?? offer.tagId}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {offer.scenarioId ? scenarioMap.get(offer.scenarioId) ?? offer.scenarioId : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {offer.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">有効</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">無効</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => onEdit(offer)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      編集
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 text-right">
        <button
          onClick={onRefresh}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          更新
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'offers' | 'approvals'

export default function AffiliateOffersPage() {
  const [tab, setTab] = useState<Tab>('offers')

  // ── offer list ─────────────────────────────────────────────────────────────
  const [offers, setOffers] = useState<AffiliateOffer[]>([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [offersError, setOffersError] = useState<string | null>(null)

  // ── select options ─────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<(Scenario & { stepCount?: number })[]>([])

  // ── modal state ────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AffiliateOffer | null>(null)

  const loadOffers = useCallback(async () => {
    setOffersLoading(true)
    setOffersError(null)
    try {
      const res = await api.affiliateOffers.list()
      if (res.success) {
        setOffers(res.data)
      } else {
        setOffersError('案件の読み込みに失敗しました')
      }
    } catch (e) {
      setOffersError(e instanceof Error ? e.message : '読み込みエラー')
    } finally {
      setOffersLoading(false)
    }
  }, [])

  const loadOptions = useCallback(async () => {
    try {
      const [accountsRes, tagsRes, scenariosRes] = await Promise.all([
        api.lineAccounts.list(),
        api.tags.list(),
        api.scenarios.list(),
      ])
      if (accountsRes.success) setAccounts(accountsRes.data as unknown as LineAccount[])
      if (tagsRes.success) setTags(tagsRes.data as unknown as Tag[])
      if (scenariosRes.success) setScenarios(scenariosRes.data as unknown as (Scenario & { stepCount?: number })[])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    void loadOffers()
    void loadOptions()
  }, [loadOffers, loadOptions])

  const handleOpenCreate = () => {
    setEditTarget(null)
    setFormOpen(true)
  }

  const handleEdit = (offer: AffiliateOffer) => {
    setEditTarget(offer)
    setFormOpen(true)
  }

  return (
    <div>
      <Header
        title="案件・承認管理"
        description="ASP 案件の CRUD と成果承認キュー"
      />

      {/* Tab switcher + action button */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setTab('offers')}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
              tab === 'offers'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            案件
          </button>
          <button
            onClick={() => setTab('approvals')}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
              tab === 'approvals'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            成果承認
          </button>
        </div>

        {tab === 'offers' && (
          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
          >
            + 新規案件
          </button>
        )}
      </div>

      {/* Tab content */}
      {tab === 'offers' ? (
        <OffersList
          offers={offers}
          accounts={accounts}
          tags={tags}
          scenarios={scenarios}
          loading={offersLoading}
          error={offersError}
          onEdit={handleEdit}
          onRefresh={loadOffers}
        />
      ) : (
        <ApprovalQueue />
      )}

      {/* Create / edit modal */}
      {formOpen && (
        <OfferFormModal
          initial={editTarget}
          accounts={accounts}
          tags={tags}
          scenarios={scenarios}
          onClose={() => setFormOpen(false)}
          onSaved={() => { void loadOffers() }}
        />
      )}
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { lineSendPauseApi, type LineSendPauseState } from '@/lib/api'
import { LINE_SEND_PAUSE_EVENT } from './send-pause-banner'

/**
 * 緊急コントロール画面の最上段に置く、LINE送信のマスタースイッチ。
 * 一斉配信・シナリオ・リマインド・自動返信・個別送信・発送案内をまとめて止める。
 * 予約済みの配信や有効なシナリオの設定は変えないので、再開すれば元どおり動く。
 */
export function SendPauseCard() {
  const [state, setState] = useState<LineSendPauseState | null>(null)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await lineSendPauseApi.get()
      if (res.success) setState(res.data)
    } catch {
      setError('現在の状態を読み込めませんでした。')
    }
  }
  useEffect(() => { void load() }, [])

  const change = async (paused: boolean) => {
    setSaving(true); setError('')
    try {
      const res = await lineSendPauseApi.set(paused, paused ? reason.trim() : undefined)
      if (res.success) setState(res.data)
      setConfirming(false); setReason('')
      window.dispatchEvent(new Event(LINE_SEND_PAUSE_EVENT))
    } catch (err) {
      setError(err instanceof Error && err.message.endsWith('403')
        ? '送信の再開は管理者だけが行えます。'
        : '切り替えられませんでした。もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const paused = state?.paused === true
  return (
    <section className={`mb-6 rounded-lg border-2 p-5 ${paused ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">LINE送信の緊急停止</h2>
          <p className="mt-1 text-sm text-gray-600">
            一斉配信・シナリオ・リマインド・自動返信・個別送信・発送案内を、すべてのアカウントでまとめて止めます。
            予約や設定は消えないので、再開すると止めていた分の配信が送られます。
          </p>
          <p className={`mt-3 text-sm font-semibold ${paused ? 'text-red-700' : 'text-green-700'}`}>
            {state === null ? '状態を確認中…' : paused ? '現在：停止中（何も送られません）' : '現在：通常どおり送信中'}
          </p>
          {paused && state?.reason && <p className="mt-1 text-sm text-red-700">理由：{state.reason}</p>}
          {paused && state?.updatedAt && <p className="mt-1 text-xs text-gray-500">停止した日時：{state.updatedAt}</p>}
        </div>

        {state !== null && !paused && !confirming && (
          <button onClick={() => setConfirming(true)} className="rounded-lg bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-700">
            今すぐ全送信を止める
          </button>
        )}
        {paused && (
          <button disabled={saving} onClick={() => { void change(false) }} className="rounded-lg border border-gray-400 bg-white px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50">
            {saving ? '切り替え中…' : '原因を直したので再開する（管理者）'}
          </button>
        )}
      </div>

      {confirming && !paused && (
        <div className="mt-4 rounded-lg border border-red-300 bg-white p-4">
          <label className="block text-sm font-semibold text-gray-800" htmlFor="send-pause-reason">止める理由（任意）</label>
          <input
            id="send-pause-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="例：一斉配信の文面に誤り"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={saving} onClick={() => { void change(true) }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
              {saving ? '停止中…' : '止める'}
            </button>
            <button disabled={saving} onClick={() => { setConfirming(false); setReason('') }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">
              やめる
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  )
}

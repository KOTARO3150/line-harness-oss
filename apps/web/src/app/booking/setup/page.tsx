'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import { bookingApi, fetchApi, type BookingMenu, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

interface CalendarConnection {
  id: string
  calendarId: string
  authType: string
  isActive: boolean
}

interface StepCardProps {
  number: number
  title: string
  description: string
  ready: boolean
  readyText: string
  href: string
  action: string
}

function StepCard({ number, title, description, ready, readyText, href, action }: StepCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start gap-4">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${ready ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {ready ? '✓' : number}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-900">{title}</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ready ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {ready ? readyText : '設定が必要'}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-gray-600">{description}</p>
          <Link href={href} className="mt-4 inline-flex rounded-lg border border-[#06C755] px-3 py-2 text-sm font-medium text-[#06C755] hover:bg-green-50">
            {action}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function BookingSetupPage() {
  const searchParams = useSearchParams()
  const { selectedAccountId, selectedAccount } = useAccount()
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [staff, setStaff] = useState<BookingStaff[]>([])
  const [calendars, setCalendars] = useState<CalendarConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [zoomConfigured, setZoomConfigured] = useState(false)

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const bookingUrl = workerBase && selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : ''

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [menuResult, staffResult, calendarResult, zoomResult] = await Promise.all([
        bookingApi.listMenus(selectedAccountId),
        bookingApi.listStaff(selectedAccountId),
        fetchApi<{ success: boolean; data: CalendarConnection[] }>('/api/integrations/google-calendar'),
        bookingApi.zoomStatus(selectedAccountId),
      ])
      setMenus(menuResult.menus)
      setStaff(staffResult.staff)
      if (calendarResult.success) setCalendars(calendarResult.data)
      setZoomConfigured(zoomResult.configured)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '予約設定を読み込めませんでした。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const copyUrl = async () => {
    if (!bookingUrl) return
    await navigator.clipboard.writeText(bookingUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const activeMenus = menus.filter((menu) => menu.is_active).length
  const activeStaff = staff.filter((person) => person.is_active).length
  const activeCalendars = calendars.filter((calendar) => calendar.isActive).length
  const calendarResult = searchParams.get('calendar')

  const connectCalendar = async () => {
    setCalendarBusy(true)
    setError('')
    try {
      const result = await fetchApi<{ success: boolean; data: { authorizationUrl: string } }>(
        '/api/integrations/google-calendar/oauth/start',
      )
      window.location.assign(result.data.authorizationUrl)
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes('503')
        ? 'Google OAuthの環境設定がまだ完了していません。'
        : 'Googleの接続画面を開けませんでした。')
      setCalendarBusy(false)
    }
  }

  const disconnectCalendar = async () => {
    const active = calendars.filter((calendar) => calendar.isActive)
    if (active.length !== 1 || !window.confirm('Googleカレンダー連携を解除しますか？')) return
    setCalendarBusy(true)
    try {
      await fetchApi(`/api/integrations/google-calendar/${active[0].id}`, { method: 'DELETE' })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '連携を解除できませんでした。')
    } finally {
      setCalendarBusy(false)
    }
  }

  return (
    <div>
      <Header title="予約設定" description="上から順番に準備すると、お客様がLINEから予約できるようになります" />

      {!selectedAccountId ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">サイドバーでLINEアカウントを選択してください。</div>
      ) : loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">予約設定を確認しています…</div>
      ) : (
        <>
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {calendarResult === 'connected' && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">Googleカレンダーを接続しました。今後、確定・取消した予約が自動同期されます。</div>}
          {calendarResult && calendarResult !== 'connected' && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Googleカレンダーの接続は完了しませんでした。もう一度お試しください。</div>}

          <div className="grid gap-4 lg:grid-cols-2">
            <StepCard number={1} title="相談メニューを作る" description="漢方相談、再相談、オンライン相談など、所要時間と料金を登録します。予約後に付けるタグも選べます。" ready={activeMenus > 0} readyText={`${activeMenus}件 利用中`} href="/booking/menus" action="相談メニューを設定" />
            <StepCard number={2} title="担当者と受付時間を決める" description="担当者を登録し、対応できる曜日と時間をシフトに設定します。一人運用でも担当者を1名登録します。" ready={activeStaff > 0} readyText={`${activeStaff}名 利用中`} href="/booking/staff" action="担当者を設定" />
            <StepCard number={3} title="LINE予約画面を準備する" description="選択中のLINEアカウントにLIFF IDが設定されていると、お客様専用の予約URLを発行できます。" ready={Boolean(selectedAccount?.liffId)} readyText="LIFF設定済み" href="/accounts" action="LINEアカウント設定" />
            <StepCard number={4} title="Googleカレンダー連携" description="接続が1件だけ有効な場合、予約の確定時に予定を作り、キャンセル時に削除します。安全のため、複数の接続がある場合は自動選択しません。" ready={activeCalendars === 1} readyText="予約と自動同期" href="/booking/bookings" action="現在の予約を確認" />
            <StepCard number={5} title="Zoom連携" description="オンライン相談に指定したメニューは、予約確定時にZoomを発行します。参加URLはLINEとGoogleカレンダーへ入り、取消時は会議も削除されます。" ready={zoomConfigured} readyText="自動発行可能" href="/booking/menus" action="オンライン相談を設定" />
          </div>

          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-900">Googleカレンダー接続</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">Googleの公式許可画面を使用します。パスワードやアクセストークンをこの画面へ入力する必要はありません。</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {activeCalendars === 1 ? (
                <button type="button" disabled={calendarBusy} onClick={() => void disconnectCalendar()} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">{calendarBusy ? '処理中…' : '連携を解除'}</button>
              ) : (
                <button type="button" disabled={calendarBusy} onClick={() => void connectCalendar()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{calendarBusy ? 'Googleを開いています…' : 'Googleカレンダーに接続'}</button>
              )}
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="font-semibold text-blue-950">お客様へ送る予約URL</h2>
            {bookingUrl && activeMenus > 0 && activeStaff > 0 ? (
              <>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input readOnly value={bookingUrl} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2.5 font-mono text-xs" />
                  <button type="button" onClick={() => void copyUrl()} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">{copied ? 'コピーしました' : 'URLをコピー'}</button>
                </div>
                <p className="mt-2 text-xs text-blue-700">このURLを個別チャットや配信メッセージへ貼り付けます。</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-amber-800">メニュー・担当者・LIFF IDの設定が完了すると、ここに送信用URLが表示されます。</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}

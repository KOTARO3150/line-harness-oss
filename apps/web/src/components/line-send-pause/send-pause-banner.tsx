'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { lineSendPauseApi, type LineSendPauseState } from '@/lib/api'

export const LINE_SEND_PAUSE_EVENT = 'line-send-pause-changed'

/**
 * 緊急停止中だけ、全ページの最上部に赤い帯を出す。
 * 止めたまま忘れて「なぜか配信されない」となるのを防ぐため。
 */
export function SendPauseBanner() {
  const [state, setState] = useState<LineSendPauseState | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      lineSendPauseApi.get()
        .then((res) => { if (alive && res.success) setState(res.data) })
        .catch(() => { /* 取れなければ何も出さない */ })
    }
    load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener(LINE_SEND_PAUSE_EVENT, load)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(LINE_SEND_PAUSE_EVENT, load)
    }
  }, [])

  if (!state?.paused) return null
  return (
    <div role="alert" className="bg-red-600 px-4 py-2 text-sm font-semibold text-white">
      LINE送信を緊急停止中です。お客様へのメッセージは一切送られていません。
      {state.reason && <span className="font-normal">（理由：{state.reason}）</span>}
      <Link href="/emergency" className="ml-2 underline">緊急コントロールへ</Link>
    </div>
  )
}

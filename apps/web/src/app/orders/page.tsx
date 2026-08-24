'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api, orderApi, type OrderLedgerItem, type OrderRefundStatus, type OrderRefundType, type OrderSource, type OrderStatus } from '@/lib/api'

const stages: Array<{ status: OrderStatus; label: string; short: string; tone: string }> = [
  { status: 'unconfirmed', label: '未確認', short: '内容を確認', tone: 'border-red-200 bg-red-50 text-red-800' },
  { status: 'preparing', label: '準備中', short: '商品を準備', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  { status: 'ready_to_ship', label: '発送待ち', short: '発送を確認', tone: 'border-blue-200 bg-blue-50 text-blue-800' },
  { status: 'shipped', label: '発送済み', short: '完了', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
]

const sourceLabels: Record<OrderSource, string> = { line: 'LINE', phone: '電話', store: '店頭', other: 'その他' }
const lifecycleLabels = { cancelled: '発送前キャンセル', voided: '誤登録の取り消し', returned: '返品・返金' } as const
const quantityUnits = ['個', '包', '本', '箱', '袋', 'セット', '枚', '台']
type EditableItem = { itemName: string; quantity: number; quantityUnit: string; unitPrice: string }

const emptyItem = (): EditableItem => ({ itemName: '', quantity: 1, quantityUnit: '個', unitPrice: '' })

function stageIndex(status: OrderStatus) { return stages.findIndex((stage) => stage.status === status) }

function buildShippingMessage(input: {
  customerName: string
  expectedDeliveryDate: string
  deliveryTimeSlot: string
  deliveryInstruction: string
  carrier: string
  trackingNumber: string
}) {
  const dateLabel = input.expectedDeliveryDate
    ? `${new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${input.expectedDeliveryDate}T00:00:00+09:00`))}頃`
    : ''
  const details = [
    dateLabel ? `到着予定日：${dateLabel}` : '',
    input.deliveryTimeSlot.trim() ? `時間指定：${input.deliveryTimeSlot.trim()}` : '',
    input.deliveryInstruction.trim() ? `お受取方法：${input.deliveryInstruction.trim()}` : '',
    input.carrier.trim() ? `配送会社：${input.carrier.trim()}` : '',
    input.trackingNumber.trim() ? `お問い合わせ番号：${input.trackingNumber.trim()}` : '',
  ].filter(Boolean)
  return [
    `${input.customerName.trim()}様`, '',
    'ご注文いただいたお品物を、本日発送いたしました。',
    ...(details.length > 0 ? ['', ...details] : []), '',
    'お届けまで、もう少しお待ちください。',
    '届きましたら、内容をご確認ください。',
    '届いた際に何か不都合があれば、早めにご連絡くださいね。', '', '鈴木薬舗',
  ].join('\n')
}

function OrderCard({ order, checked, onChecked, onMove, onEdit, onLifecycle, moving }: {
  order: OrderLedgerItem
  checked: boolean
  onChecked: (value: boolean) => void
  onMove: (status: OrderStatus) => void
  onEdit: () => void
  onLifecycle: () => void
  moving: boolean
}) {
  const index = stageIndex(order.status)
  const total = order.items.reduce((sum, item) => sum + (item.unitPrice ?? 0) * item.quantity, 0)
  const active = order.lifecycleStatus === 'active'
  return (
    <article className={`rounded-xl border bg-white p-3 shadow-sm ${active ? 'border-gray-200' : 'border-gray-300 opacity-90'}`}>
      <div className="flex items-start gap-2">
        {active && order.status !== 'shipped' && (
          <input aria-label="注文を選択" type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} className="mt-1 h-4 w-4 rounded border-gray-300 text-green-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-gray-900">{order.customerName}</p>
              <p className="text-[11px] text-gray-400">#{order.id.slice(0, 8)} · {sourceLabels[order.source]}</p>
            </div>
            <time className="shrink-0 text-[11px] text-gray-400">{new Date(order.updatedAt).toLocaleDateString('ja-JP')}</time>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {order.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-2">
                <span className="min-w-0 break-words">{item.itemName} × {item.quantity}{item.quantityUnit || '個'}</span>
                {item.unitPrice != null && <span className="shrink-0">{(item.unitPrice * item.quantity).toLocaleString()}円</span>}
              </li>
            ))}
          </ul>
          {total > 0 && <p className="mt-2 text-right text-sm font-semibold text-gray-900">合計 {total.toLocaleString()}円</p>}
          {order.shippingMethod && <p className="mt-2 text-xs text-gray-500">発送方法：{order.shippingMethod}</p>}
          {order.note && <p className="mt-1 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-600 whitespace-pre-wrap">{order.note}</p>}
          {!active && (
            <div className="mt-2 rounded-lg bg-slate-100 px-2.5 py-2 text-xs text-slate-700">
              <p className="font-semibold">{lifecycleLabels[order.lifecycleStatus as keyof typeof lifecycleLabels]}</p>
              {order.lifecycleReason && <p className="mt-1 whitespace-pre-wrap">理由：{order.lifecycleReason}</p>}
              {order.lifecycleStatus === 'returned' && order.refundType !== 'none' && (
                <p className="mt-1 font-medium">
                  {order.refundType === 'partial' ? '一部返金' : '全額返金'}
                  {order.refundAmount != null ? ` ${order.refundAmount.toLocaleString()}円` : ''}
                  {' · '}{order.refundStatus === 'completed' ? '返金済み' : '未返金'}
                </p>
              )}
            </div>
          )}
          {order.status === 'shipped' && (order.carrier || order.trackingNumber) && (
            <p className="mt-2 text-xs text-emerald-700">{[order.carrier, order.trackingNumber].filter(Boolean).join(' · ')}</p>
          )}
          {order.status === 'shipped' && (order.expectedDeliveryDate || order.deliveryTimeSlot || order.deliveryInstruction) && (
            <div className="mt-2 rounded-lg bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
              {order.expectedDeliveryDate && <p>到着予定：{order.expectedDeliveryDate}</p>}
              {order.deliveryTimeSlot && <p>時間帯：{order.deliveryTimeSlot}</p>}
              {order.deliveryInstruction && <p>受取希望：{order.deliveryInstruction}</p>}
            </div>
          )}
          {order.status === 'shipped' && order.shippingNotificationStatus === 'sent' && <p className="mt-2 text-xs font-semibold text-green-700">✓ LINE発送案内済み</p>}
          {order.status === 'shipped' && order.shippingNotificationStatus === 'failed' && <p className="mt-2 text-xs font-semibold text-red-700">LINE送信失敗（発送記録は保存済み）</p>}
          <div className="mt-3 flex gap-2">
            <button disabled={moving} onClick={onEdit} className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-100 disabled:opacity-50">編集</button>
            {active && index > 0 && (
              <button disabled={moving} onClick={() => onMove(stages[index - 1].status)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">一つ戻す</button>
            )}
            {active && index < stages.length - 1 && (
              <button disabled={moving} onClick={() => onMove(stages[index + 1].status)} className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${index === 2 ? 'bg-emerald-700' : 'bg-gray-900'}`}>
                {index === 2 ? '発送完了を確認' : `「${stages[index + 1].label}」へ`}
              </button>
            )}
            {active ? (
              <button disabled={moving} onClick={onLifecycle} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">{order.status === 'shipped' ? '返品・返金' : '中止・取り消し'}</button>
            ) : order.lifecycleStatus === 'returned' ? (
              <button disabled={moving} onClick={onLifecycle} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">返金状況を更新</button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export default function OrdersPage() {
  const { selectedAccountId } = useAccount()
  const searchParams = useSearchParams()
  const friendId = searchParams.get('friend') || ''
  const [orders, setOrders] = useState<OrderLedgerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(Boolean(friendId))
  const [customerName, setCustomerName] = useState('')
  const [source, setSource] = useState<OrderSource>('line')
  const [shippingMethod, setShippingMethod] = useState('宅配便')
  const [note, setNote] = useState('')
  const [items, setItems] = useState<EditableItem[]>([emptyItem()])
  const [editing, setEditing] = useState<OrderLedgerItem | null>(null)
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editSource, setEditSource] = useState<OrderSource>('line')
  const [editShippingMethod, setEditShippingMethod] = useState('')
  const [editCarrier, setEditCarrier] = useState('')
  const [editTrackingNumber, setEditTrackingNumber] = useState('')
  const [editExpectedDeliveryDate, setEditExpectedDeliveryDate] = useState('')
  const [editDeliveryTimeSlot, setEditDeliveryTimeSlot] = useState('')
  const [editDeliveryInstruction, setEditDeliveryInstruction] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editItems, setEditItems] = useState<EditableItem[]>([emptyItem()])
  const [saving, setSaving] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [shippingOrder, setShippingOrder] = useState<OrderLedgerItem | null>(null)
  const [shipCarrier, setShipCarrier] = useState('')
  const [shipTrackingNumber, setShipTrackingNumber] = useState('')
  const [shipExpectedDeliveryDate, setShipExpectedDeliveryDate] = useState('')
  const [shipDeliveryTimeSlot, setShipDeliveryTimeSlot] = useState('')
  const [shipDeliveryInstruction, setShipDeliveryInstruction] = useState('')
  const [shipNotifyLine, setShipNotifyLine] = useState(true)
  const [shipMessage, setShipMessage] = useState('')
  const [shipMessageEdited, setShipMessageEdited] = useState(false)
  const [shipConfirmed, setShipConfirmed] = useState(false)
  const [lifecycleOrder, setLifecycleOrder] = useState<OrderLedgerItem | null>(null)
  const [lifecycleAction, setLifecycleAction] = useState<'cancel' | 'void' | 'return_refund' | 'update_refund'>('cancel')
  const [lifecycleReason, setLifecycleReason] = useState('')
  const [refundType, setRefundType] = useState<OrderRefundType>('none')
  const [refundStatus, setRefundStatus] = useState<OrderRefundStatus>('not_required')
  const [refundAmount, setRefundAmount] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [checked, setChecked] = useState<Record<OrderStatus, Set<string>>>(() => ({
    unconfirmed: new Set(), preparing: new Set(), ready_to_ship: new Set(), shipped: new Set(),
  }))

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true); setError('')
    try {
      const res = await orderApi.list(selectedAccountId)
      setOrders(res.data.orders)
    } catch { setError('注文台帳を読み込めませんでした。再読み込みしてください。') }
    finally { setLoading(false) }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!friendId) return
    void api.friends.get(friendId).then((res) => {
      if (res.success) setCustomerName(res.data.displayName || '')
    }).catch(() => {})
  }, [friendId])

  const byStage = useMemo(() => Object.fromEntries(
    stages.map((stage) => [stage.status, orders.filter((order) => order.lifecycleStatus === 'active' && order.status === stage.status)]),
  ) as Record<OrderStatus, OrderLedgerItem[]>, [orders])
  const closedOrders = useMemo(() => orders.filter((order) => order.lifecycleStatus !== 'active'), [orders])
  const defaultShippingMessage = useMemo(() => shippingOrder ? buildShippingMessage({
    customerName: shippingOrder.customerName,
    expectedDeliveryDate: shipExpectedDeliveryDate,
    deliveryTimeSlot: shipDeliveryTimeSlot,
    deliveryInstruction: shipDeliveryInstruction,
    carrier: shipCarrier,
    trackingNumber: shipTrackingNumber,
  }) : '', [shippingOrder, shipExpectedDeliveryDate, shipDeliveryTimeSlot, shipDeliveryInstruction, shipCarrier, shipTrackingNumber])

  useEffect(() => {
    if (shippingOrder && !shipMessageEdited) setShipMessage(defaultShippingMessage)
  }, [shippingOrder, shipMessageEdited, defaultShippingMessage])

  const create = async () => {
    if (!selectedAccountId || !customerName.trim() || !items.some((item) => item.itemName.trim())) return
    setSaving(true); setError('')
    try {
      await orderApi.create({
        lineAccountId: selectedAccountId, friendId: friendId || null, customerName: customerName.trim(), source,
        shippingMethod: shippingMethod.trim() || null, note: note.trim() || null,
        items: items.filter((item) => item.itemName.trim()).map((item) => ({
          itemName: item.itemName.trim(), quantity: item.quantity,
          quantityUnit: item.quantityUnit.trim() || '個',
          unitPrice: item.unitPrice === '' ? null : Number(item.unitPrice),
        })),
      })
      setShowCreate(false); setCustomerName(''); setNote(''); setItems([emptyItem()])
      await load()
    } catch { setError('注文を登録できませんでした。入力内容を確認してください。') }
    finally { setSaving(false) }
  }

  const openEdit = (order: OrderLedgerItem) => {
    setEditing(order)
    setEditCustomerName(order.customerName)
    setEditSource(order.source)
    setEditShippingMethod(order.shippingMethod || '')
    setEditCarrier(order.carrier || '')
    setEditTrackingNumber(order.trackingNumber || '')
    setEditExpectedDeliveryDate(order.expectedDeliveryDate || '')
    setEditDeliveryTimeSlot(order.deliveryTimeSlot || '')
    setEditDeliveryInstruction(order.deliveryInstruction || '')
    setEditNote(order.note || '')
    setEditItems(order.items.map((item) => ({
      itemName: item.itemName,
      quantity: item.quantity,
      quantityUnit: item.quantityUnit || '個',
      unitPrice: item.unitPrice == null ? '' : String(item.unitPrice),
    })))
  }

  const saveEdit = async () => {
    if (!editing || !selectedAccountId || !editCustomerName.trim() || !editItems.some((item) => item.itemName.trim())) return
    setSaving(true); setError('')
    try {
      await orderApi.update(editing.id, {
        lineAccountId: selectedAccountId,
        expectedUpdatedAt: editing.updatedAt,
        customerName: editCustomerName.trim(), source: editSource,
        shippingMethod: editShippingMethod.trim() || null,
        carrier: editCarrier.trim() || null,
        trackingNumber: editTrackingNumber.trim() || null,
        expectedDeliveryDate: editExpectedDeliveryDate || null,
        deliveryTimeSlot: editDeliveryTimeSlot.trim() || null,
        deliveryInstruction: editDeliveryInstruction.trim() || null,
        note: editNote.trim() || null,
        items: editItems.filter((item) => item.itemName.trim()).map((item) => ({
          itemName: item.itemName.trim(), quantity: item.quantity,
          quantityUnit: item.quantityUnit.trim() || '個',
          unitPrice: item.unitPrice === '' ? null : Number(item.unitPrice),
        })),
      })
      setEditing(null)
      await load()
    } catch { setError('注文内容を保存できませんでした。画面を再読み込みして確認してください。') }
    finally { setSaving(false) }
  }

  const move = async (order: OrderLedgerItem, status: OrderStatus) => {
    const shipping = status === 'shipped'
    if (shipping) {
      setShippingOrder(order)
      setShipCarrier(order.carrier || '')
      setShipTrackingNumber(order.trackingNumber || '')
      setShipExpectedDeliveryDate(order.expectedDeliveryDate || '')
      setShipDeliveryTimeSlot(order.deliveryTimeSlot || '')
      setShipDeliveryInstruction(order.deliveryInstruction || '')
      setShipNotifyLine(Boolean(order.friendId))
      setShipMessage('')
      setShipMessageEdited(false)
      setShipConfirmed(false)
      return
    }
    setMovingId(order.id); setError('')
    try {
      const result = await orderApi.transition(order.id, {
        lineAccountId: selectedAccountId || '', status,
      })
      if (result.notification?.error) window.alert(result.notification.error)
      await load()
    } catch { setError('進捗を変更できませんでした。画面を再読み込みして確認してください。') }
    finally { setMovingId(null) }
  }

  const completeShipping = async () => {
    if (!shippingOrder || !selectedAccountId || !shipConfirmed) return
    setMovingId(shippingOrder.id); setError('')
    try {
      const result = await orderApi.transition(shippingOrder.id, {
        lineAccountId: selectedAccountId,
        status: 'shipped',
        confirmShipped: true,
        carrier: shipCarrier.trim() || null,
        trackingNumber: shipTrackingNumber.trim() || null,
        expectedDeliveryDate: shipExpectedDeliveryDate || null,
        deliveryTimeSlot: shipDeliveryTimeSlot.trim() || null,
        deliveryInstruction: shipDeliveryInstruction.trim() || null,
        notifyLine: shipNotifyLine && Boolean(shippingOrder.friendId),
        notificationText: shipNotifyLine ? shipMessage.trim() || defaultShippingMessage : null,
      })
      setShippingOrder(null)
      if (result.notification?.error) window.alert(result.notification.error)
      await load()
    } catch { setError('発送完了を保存できませんでした。入力内容を確認してください。') }
    finally { setMovingId(null) }
  }

  const bulkAdvance = async (status: OrderStatus) => {
    const index = stageIndex(status)
    const from = stages[index - 1]?.status
    if (!from) return
    const ids = [...checked[from]]
    if (ids.length === 0) return
    setMovingId('bulk'); setError('')
    try {
      await orderApi.bulkAdvance(ids, status)
      setChecked((current) => ({ ...current, [from]: new Set() }))
      await load()
    } catch { setError('一括変更できませんでした。進捗が変わっていないか確認してください。') }
    finally { setMovingId(null) }
  }

  const openLifecycle = (order: OrderLedgerItem) => {
    const action = order.lifecycleStatus === 'returned' ? 'update_refund'
      : order.status === 'shipped' ? 'return_refund' : 'cancel'
    setLifecycleOrder(order)
    setLifecycleAction(action)
    setLifecycleReason(order.lifecycleReason || '')
    setRefundType(order.refundType || 'none')
    setRefundStatus(order.refundStatus || 'not_required')
    setRefundAmount(order.refundAmount == null ? '' : String(order.refundAmount))
  }

  const saveLifecycle = async () => {
    if (!lifecycleOrder || !selectedAccountId || !lifecycleReason.trim()) return
    const needsRefund = lifecycleAction === 'return_refund' || lifecycleAction === 'update_refund'
    setSaving(true); setError('')
    try {
      await orderApi.updateLifecycle(lifecycleOrder.id, {
        lineAccountId: selectedAccountId,
        expectedUpdatedAt: lifecycleOrder.updatedAt,
        action: lifecycleAction,
        reason: lifecycleReason.trim(),
        refundType: needsRefund ? refundType : 'none',
        refundStatus: needsRefund ? (refundType === 'none' ? 'not_required' : refundStatus) : 'not_required',
        refundAmount: needsRefund && refundAmount !== '' ? Number(refundAmount) : null,
      })
      setLifecycleOrder(null)
      setShowClosed(true)
      await load()
    } catch { setError('処理を保存できませんでした。入力内容と現在の状態を確認してください。') }
    finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">注文・発送台帳</h1>
          <p className="mt-1 text-sm text-gray-500">注文をチャット対応と分け、発送が終わるまで見失わないための画面です。</p>
        </div>
        <button onClick={() => setShowCreate((value) => !value)} className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700">＋ 注文を登録</button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {stages.map((stage, index) => (
          <div key={stage.status} className={`rounded-xl border p-3 ${stage.tone}`}>
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">{index + 1}. {stage.label}</span><span className="text-xl font-bold">{byStage[stage.status]?.length ?? 0}</span></div>
            <p className="mt-1 text-xs opacity-75">{stage.short}</p>
          </div>
        ))}
      </div>

      {showCreate && (
        <section className="mt-5 rounded-2xl border border-green-200 bg-green-50 p-4 sm:p-5">
          <div className="flex items-center justify-between"><h2 className="font-bold text-green-950">新しい注文</h2><button onClick={() => setShowCreate(false)} className="text-sm text-gray-500">閉じる</button></div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-sm font-medium text-gray-700">お客様名<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700">受付<select value={source} onChange={(e) => setSource(e.target.value as OrderSource)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="line">LINE</option><option value="phone">電話</option><option value="store">店頭</option><option value="other">その他</option></select></label>
            <label className="text-sm font-medium text-gray-700">発送方法<input value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" /></label>
          </div>
          <div className="mt-4 space-y-2">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-[64px_64px_minmax(96px,1fr)_34px] gap-2 sm:grid-cols-[minmax(120px,1fr)_70px_70px_minmax(100px,130px)_36px]">
                <input aria-label="商品名" placeholder="商品名" value={item.itemName} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, itemName: e.target.value } : row))} className="col-span-4 min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm sm:col-span-1" />
                <input aria-label="数量" title="数量" type="number" min="1" value={item.quantity} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, quantity: Math.max(1, Number(e.target.value)) } : row))} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm" />
                <input aria-label="数量の単位" title="単位（個・包・本など）" list="order-quantity-units" value={item.quantityUnit} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, quantityUnit: e.target.value } : row))} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm" />
                <label className="flex min-w-0 items-center rounded-lg border border-gray-300 bg-white pr-2 text-sm text-gray-500"><input aria-label="単価" type="number" min="0" placeholder="単価 任意" value={item.unitPrice} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, unitPrice: e.target.value } : row))} className="min-w-0 flex-1 rounded-lg px-2 py-2 text-sm outline-none" /><span>円</span></label>
                <button aria-label="商品を削除" disabled={items.length === 1} onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))} className="rounded-lg text-gray-400 hover:bg-white disabled:opacity-30 sm:col-auto">×</button>
              </div>
            ))}
            <datalist id="order-quantity-units">{quantityUnits.map((unit) => <option key={unit} value={unit} />)}</datalist>
            <p className="text-xs text-gray-500">数量の右に「個・包・本・箱・袋」などの単位を入力できます。</p>
            <button onClick={() => setItems((rows) => [...rows, emptyItem()])} className="text-sm font-medium text-green-700">＋ 商品を追加</button>
          </div>
          <label className="mt-3 block text-sm font-medium text-gray-700">作業メモ<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" /></label>
          <button disabled={saving || !customerName.trim() || !items.some((item) => item.itemName.trim())} onClick={() => { void create() }} className="mt-4 rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? '登録中…' : '未確認として登録'}</button>
        </section>
      )}

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {loading ? <div className="mt-6 h-56 animate-pulse rounded-xl bg-gray-100" /> : (
        <div className="mt-6 grid items-start gap-4 xl:grid-cols-4">
          {stages.map((stage, index) => {
            const rows = byStage[stage.status]
            const allChecked = rows.length > 0 && stage.status !== 'shipped' && rows.every((order) => checked[stage.status].has(order.id))
            return (
              <section key={stage.status} className="min-w-0 rounded-2xl bg-gray-50 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-bold text-gray-900">{stage.label} <span className="text-gray-400">{rows.length}</span></h2>
                  {stage.status !== 'shipped' && rows.length > 0 && <label className="flex items-center gap-1 text-xs text-gray-500"><input type="checkbox" checked={allChecked} onChange={(e) => setChecked((current) => ({ ...current, [stage.status]: e.target.checked ? new Set(rows.map((row) => row.id)) : new Set() }))} />全て</label>}
                </div>
                {index < 2 && checked[stage.status].size > 0 && (
                  <button disabled={movingId === 'bulk'} onClick={() => { void bulkAdvance(stages[index + 1].status) }} className="mb-3 w-full rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white">選択した{checked[stage.status].size}件を{stages[index + 1].label}へ</button>
                )}
                <div className="space-y-3">
                  {rows.length === 0 ? <p className="rounded-xl border border-dashed border-gray-200 bg-white py-10 text-center text-sm text-gray-400">該当なし</p> : rows.map((order) => (
                    <OrderCard key={order.id} order={order} checked={checked[stage.status].has(order.id)} onChecked={(value) => setChecked((current) => { const next = new Set(current[stage.status]); if (value) next.add(order.id); else next.delete(order.id); return { ...current, [stage.status]: next } })} onMove={(status) => { void move(order, status) }} onEdit={() => openEdit(order)} onLifecycle={() => openLifecycle(order)} moving={movingId === order.id} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
      {!loading && closedOrders.length > 0 && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
          <button onClick={() => setShowClosed((value) => !value)} className="flex w-full items-center justify-between text-left">
            <span className="font-bold text-slate-800">キャンセル・取り消し・返品返金 <span className="text-slate-400">{closedOrders.length}</span></span>
            <span className="text-sm text-slate-500">{showClosed ? '閉じる' : '表示する'}</span>
          </button>
          {showClosed && <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{closedOrders.map((order) => (
            <OrderCard key={order.id} order={order} checked={false} onChecked={() => {}} onMove={() => {}} onEdit={() => openEdit(order)} onLifecycle={() => openLifecycle(order)} moving={movingId === order.id} />
          ))}</div>}
        </section>
      )}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="注文を編集">
          <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-bold text-gray-900">注文内容を編集</h2><p className="mt-1 text-xs text-gray-500">進捗は「{stages[stageIndex(editing.status)].label}」のまま、内容だけを変更します。</p></div>
              <button onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">閉じる</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-medium text-gray-700">お客様名<input value={editCustomerName} onChange={(e) => setEditCustomerName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">受付<select value={editSource} onChange={(e) => setEditSource(e.target.value as OrderSource)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="line">LINE</option><option value="phone">電話</option><option value="store">店頭</option><option value="other">その他</option></select></label>
              <label className="text-sm font-medium text-gray-700">発送方法<input value={editShippingMethod} onChange={(e) => setEditShippingMethod(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold text-gray-700">商品</p>
              {editItems.map((item, index) => (
                <div key={index} className="grid grid-cols-[60px_60px_minmax(92px,1fr)_32px] gap-2 sm:grid-cols-[minmax(110px,1fr)_64px_64px_minmax(96px,120px)_34px]">
                  <input aria-label="商品名" placeholder="商品名" value={item.itemName} onChange={(e) => setEditItems((rows) => rows.map((row, i) => i === index ? { ...row, itemName: e.target.value } : row))} className="col-span-4 min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-sm sm:col-span-1" />
                  <input aria-label="数量" title="数量" type="number" min="1" value={item.quantity} onChange={(e) => setEditItems((rows) => rows.map((row, i) => i === index ? { ...row, quantity: Math.max(1, Number(e.target.value)) } : row))} className="rounded-lg border border-gray-300 px-2 py-2 text-sm" />
                  <input aria-label="数量の単位" title="単位" list="order-quantity-units" value={item.quantityUnit} onChange={(e) => setEditItems((rows) => rows.map((row, i) => i === index ? { ...row, quantityUnit: e.target.value } : row))} className="rounded-lg border border-gray-300 px-2 py-2 text-sm" />
                  <label className="flex min-w-0 items-center rounded-lg border border-gray-300 pr-2 text-sm text-gray-500"><input aria-label="単価" type="number" min="0" value={item.unitPrice} onChange={(e) => setEditItems((rows) => rows.map((row, i) => i === index ? { ...row, unitPrice: e.target.value } : row))} className="min-w-0 flex-1 rounded-lg px-2 py-2 text-sm outline-none" /><span>円</span></label>
                  <button aria-label="商品を削除" disabled={editItems.length === 1} onClick={() => setEditItems((rows) => rows.filter((_, i) => i !== index))} className="rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-30">×</button>
                </div>
              ))}
              <button onClick={() => setEditItems((rows) => [...rows, emptyItem()])} className="text-sm font-medium text-green-700">＋ 商品を追加</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">配送会社<input value={editCarrier} onChange={(e) => setEditCarrier(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">追跡番号<input value={editTrackingNumber} onChange={(e) => setEditTrackingNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">到着予定日<input type="date" value={editExpectedDeliveryDate} onChange={(e) => setEditExpectedDeliveryDate(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">時間指定<input value={editDeliveryTimeSlot} onChange={(e) => setEditDeliveryTimeSlot(e.target.value)} placeholder="午前中／14時〜16時" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">お受取方法<input value={editDeliveryInstruction} onChange={(e) => setEditDeliveryInstruction(e.target.value)} placeholder="手渡し／宅配ボックス／寮の受付へ" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            </div>
            <label className="mt-3 block text-sm font-medium text-gray-700">作業メモ<textarea rows={3} value={editNote} onChange={(e) => setEditNote(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm">キャンセル</button><button disabled={saving || !editCustomerName.trim() || !editItems.some((item) => item.itemName.trim())} onClick={() => { void saveEdit() }} className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : '変更を保存'}</button></div>
          </section>
        </div>
      )}
      {shippingOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="発送完了とLINE案内">
          <section className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-bold text-gray-900">発送完了を登録</h2><p className="mt-1 text-sm text-gray-500">{shippingOrder.customerName}様への配送情報とLINE案内を確認します。</p></div>
              <button onClick={() => setShippingOrder(null)} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">閉じる</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">到着予定日<input type="date" value={shipExpectedDeliveryDate} onChange={(e) => setShipExpectedDeliveryDate(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">時間指定<input value={shipDeliveryTimeSlot} onChange={(e) => setShipDeliveryTimeSlot(e.target.value)} placeholder="午前中／14時〜16時" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">お受取方法<input value={shipDeliveryInstruction} onChange={(e) => setShipDeliveryInstruction(e.target.value)} placeholder="手渡し／宅配ボックス／寮の受付へ" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">配送会社<input value={shipCarrier} onChange={(e) => setShipCarrier(e.target.value)} placeholder="佐川急便" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">お問い合わせ番号<input value={shipTrackingNumber} onChange={(e) => setShipTrackingNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            </div>
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
              <label className="flex items-center gap-2 text-sm font-semibold text-green-950"><input type="checkbox" checked={shipNotifyLine} disabled={!shippingOrder.friendId} onChange={(e) => setShipNotifyLine(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-green-600" />お客様へLINEで発送案内を送る</label>
              {!shippingOrder.friendId && <p className="mt-2 text-xs text-amber-700">この注文にはLINEが紐づいていないため、発送記録だけを保存します。</p>}
              {shipNotifyLine && shippingOrder.friendId && <>
                <div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-green-900">送信前に編集できます</span><button onClick={() => { setShipMessage(defaultShippingMessage); setShipMessageEdited(false) }} className="text-xs font-medium text-green-700 underline">定型文に戻す</button></div>
                <textarea rows={11} maxLength={2000} value={shipMessage} onChange={(e) => { setShipMessage(e.target.value); setShipMessageEdited(true) }} className="mt-1 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-sm leading-6" />
                <p className="mt-1 text-right text-xs text-gray-400">{shipMessage.length}/2000文字</p>
              </>}
            </div>
            <label className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><input type="checkbox" checked={shipConfirmed} onChange={(e) => setShipConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" /><span>実際に発送したことと、上の配送情報を確認しました。</span></label>
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setShippingOrder(null)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm">戻る</button><button disabled={!shipConfirmed || movingId === shippingOrder.id || (shipNotifyLine && Boolean(shippingOrder.friendId) && !shipMessage.trim())} onClick={() => { void completeShipping() }} className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{movingId === shippingOrder.id ? '保存中…' : shipNotifyLine && shippingOrder.friendId ? '発送完了・LINE送信' : '発送完了を保存'}</button></div>
          </section>
        </div>
      )}
      {lifecycleOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="注文の中止・返品返金">
          <section className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-bold text-gray-900">{lifecycleOrder.status === 'shipped' || lifecycleOrder.lifecycleStatus === 'returned' ? '返品・返金を記録' : '注文を中止・取り消し'}</h2><p className="mt-1 text-xs text-gray-500">注文は削除せず、理由と処理履歴を残します。</p></div>
              <button onClick={() => setLifecycleOrder(null)} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">閉じる</button>
            </div>
            {lifecycleOrder.lifecycleStatus === 'active' && lifecycleOrder.status !== 'shipped' && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => setLifecycleAction('cancel')} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${lifecycleAction === 'cancel' ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-gray-200 text-gray-600'}`}>発送前キャンセル</button>
                <button onClick={() => setLifecycleAction('void')} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${lifecycleAction === 'void' ? 'border-red-400 bg-red-50 text-red-800' : 'border-gray-200 text-gray-600'}`}>誤登録を取り消す</button>
              </div>
            )}
            <label className="mt-4 block text-sm font-medium text-gray-700">理由（必須）<textarea rows={3} value={lifecycleReason} onChange={(e) => setLifecycleReason(e.target.value)} placeholder="お客様都合、重複登録、商品違いなど" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            {(lifecycleAction === 'return_refund' || lifecycleAction === 'update_refund') && (
              <div className="mt-4 rounded-xl bg-blue-50 p-4">
                <label className="block text-sm font-medium text-gray-700">返金区分<select value={refundType} onChange={(e) => { const value = e.target.value as OrderRefundType; setRefundType(value); setRefundStatus(value === 'none' ? 'not_required' : 'pending') }} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="none">返品のみ（返金なし）</option><option value="partial">一部返金</option><option value="full">全額返金</option></select></label>
                {refundType !== 'none' && <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="text-sm font-medium text-gray-700">返金額<label className="mt-1 flex items-center rounded-lg border border-gray-300 bg-white pr-3"><input type="number" min="1" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={refundType === 'full' ? '自動計算' : '金額'} className="min-w-0 flex-1 rounded-lg px-3 py-2 outline-none" /><span>円</span></label></div>
                  <label className="text-sm font-medium text-gray-700">返金状況<select value={refundStatus} onChange={(e) => setRefundStatus(e.target.value as OrderRefundStatus)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="pending">未返金</option><option value="completed">返金済み</option></select></label>
                </div>}
                {refundType === 'full' && <p className="mt-2 text-xs text-blue-700">商品金額が登録済みなら全額を自動計算します。</p>}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setLifecycleOrder(null)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm">戻る</button><button disabled={saving || !lifecycleReason.trim()} onClick={() => { void saveLifecycle() }} className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : lifecycleAction === 'update_refund' ? '返金状況を更新' : '記録して処理を終了'}</button></div>
          </section>
        </div>
      )}
      {friendId && <p className="mt-5 text-sm text-gray-500"><Link href={`/chats?friend=${encodeURIComponent(friendId)}`} className="text-green-700 underline">このお客様のチャットへ戻る</Link></p>}
    </div>
  )
}

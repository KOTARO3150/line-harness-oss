import { Hono } from 'hono';
import {
  createOrder,
  getOrder,
  getOrderStatusHistory,
  jstNow,
  listOrders,
  recordOrderShippingNotification,
  transitionOrder,
  updateOrder,
  updateOrderLifecycle,
  type Order,
  type OrderLifecycleStatus,
  type OrderRefundStatus,
  type OrderRefundType,
  type OrderSource,
  type OrderStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const orders = new Hono<Env>();

const STATUS_ORDER: OrderStatus[] = ['unconfirmed', 'preparing', 'ready_to_ship', 'shipped'];
const SOURCES = new Set<OrderSource>(['line', 'phone', 'store', 'other']);

export function buildShippingNotificationText(input: {
  customerName: string;
  expectedDeliveryDate?: string | null;
  deliveryTimeSlot?: string | null;
  deliveryInstruction?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
}) {
  const dateLabel = input.expectedDeliveryDate
    ? new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
      .format(new Date(`${input.expectedDeliveryDate}T00:00:00+09:00`)) + '頃'
    : null;
  const details = [
    dateLabel ? `到着予定日：${dateLabel}` : null,
    input.deliveryTimeSlot?.trim() ? `時間指定：${input.deliveryTimeSlot.trim()}` : null,
    input.deliveryInstruction?.trim() ? `お受取方法：${input.deliveryInstruction.trim()}` : null,
    input.carrier?.trim() ? `配送会社：${input.carrier.trim()}` : null,
    input.trackingNumber?.trim() ? `お問い合わせ番号：${input.trackingNumber.trim()}` : null,
  ].filter((line): line is string => line !== null);
  return [
    `${input.customerName.trim()}様`,
    '',
    'ご注文いただいたお品物を、本日発送いたしました。',
    ...(details.length > 0 ? ['', ...details] : []),
    '',
    'お届けまで、もう少しお待ちください。',
    '届きましたら、内容をご確認ください。',
    '届いた際に何か不都合があれば、早めにご連絡くださいね。',
    '',
    '鈴木薬舗',
  ].join('\n');
}

function isStatus(value: string | undefined): value is OrderStatus {
  return Boolean(value && STATUS_ORDER.includes(value as OrderStatus));
}

function serialize(order: Order) {
  return {
    id: order.id,
    lineAccountId: order.line_account_id,
    friendId: order.friend_id,
    friendName: order.friend_name ?? null,
    friendPictureUrl: order.friend_picture_url ?? null,
    status: order.status,
    source: order.source,
    customerName: order.customer_name_snapshot,
    shippingMethod: order.shipping_method,
    carrier: order.carrier,
    trackingNumber: order.tracking_number,
    expectedDeliveryDate: order.expected_delivery_date,
    deliveryTimeSlot: order.delivery_time_slot,
    deliveryInstruction: order.delivery_instruction,
    shippingNotificationStatus: order.shipping_notification_status,
    shippingNotificationSentAt: order.shipping_notification_sent_at,
    shippingNotificationError: order.shipping_notification_error,
    note: order.note,
    preparingAt: order.preparing_at,
    readyToShipAt: order.ready_to_ship_at,
    shippedAt: order.shipped_at,
    lifecycleStatus: order.lifecycle_status,
    lifecycleReason: order.lifecycle_reason,
    lifecycleAt: order.lifecycle_at,
    refundType: order.refund_type,
    refundStatus: order.refund_status,
    refundAmount: order.refund_amount,
    refundProcessedAt: order.refund_processed_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: (order.items ?? []).map((item) => ({
      id: item.id,
      itemName: item.item_name,
      quantity: item.quantity,
      quantityUnit: item.quantity_unit,
      unitPrice: item.unit_price,
    })),
  };
}

async function friendForAccount(db: D1Database, friendId: string, accountId: string) {
  return db.prepare(
    'SELECT id, display_name FROM friends WHERE id = ? AND line_account_id = ?',
  ).bind(friendId, accountId).first<{ id: string; display_name: string | null }>();
}

orders.get('/api/orders', async (c) => {
  const lineAccountId = c.req.query('lineAccountId');
  const status = c.req.query('status');
  const friendId = c.req.query('friendId');
  if (!lineAccountId) return c.json({ success: false, error: 'LINEアカウントが必要です' }, 400);
  if (status && !isStatus(status)) return c.json({ success: false, error: '不正な進捗です' }, 400);
  const rows = await listOrders(c.env.DB, {
    lineAccountId,
    status: isStatus(status) ? status : undefined,
    friendId,
  });
  const counts = STATUS_ORDER.reduce<Record<OrderStatus, number>>((acc, key) => {
    acc[key] = rows.filter((row) => row.status === key).length;
    return acc;
  }, { unconfirmed: 0, preparing: 0, ready_to_ship: 0, shipped: 0 });
  return c.json({ success: true, data: { orders: rows.map(serialize), counts } });
});

orders.get('/api/orders/:id/history', async (c) => {
  const order = await getOrder(c.env.DB, c.req.param('id'));
  if (!order) return c.json({ success: false, error: '注文が見つかりません' }, 404);
  const history = await getOrderStatusHistory(c.env.DB, order.id);
  return c.json({ success: true, data: history.map((row) => ({
    id: row.id, fromStatus: row.from_status, toStatus: row.to_status,
    staffId: row.staff_id, note: row.note, createdAt: row.created_at,
  })) });
});

orders.post('/api/orders', async (c) => {
  const body = await c.req.json<{
    lineAccountId?: string; friendId?: string | null; customerName?: string;
    source?: OrderSource; shippingMethod?: string | null; note?: string | null;
    items?: Array<{ itemName?: string; quantity?: number; quantityUnit?: string; unitPrice?: number | null }>;
  }>();
  if (!body.lineAccountId) return c.json({ success: false, error: 'LINEアカウントが必要です' }, 400);
  if (body.source && !SOURCES.has(body.source)) return c.json({ success: false, error: '受付方法が不正です' }, 400);
  const items = (body.items ?? []).map((item) => ({
    itemName: item.itemName?.trim() || '',
    quantity: Number(item.quantity ?? 1),
    quantityUnit: item.quantityUnit?.trim() || '個',
    unitPrice: item.unitPrice == null ? null : Number(item.unitPrice),
  })).filter((item) => item.itemName);
  if (items.length === 0) return c.json({ success: false, error: '商品を1件以上入力してください' }, 400);
  if (items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
    item.quantityUnit.length > 12 ||
    (item.unitPrice != null && (!Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0)))) {
    return c.json({ success: false, error: '数量または金額が不正です' }, 400);
  }
  let customerName = body.customerName?.trim() || '';
  if (body.friendId) {
    const friend = await friendForAccount(c.env.DB, body.friendId, body.lineAccountId);
    if (!friend) return c.json({ success: false, error: 'このLINEアカウントのお客様ではありません' }, 400);
    customerName ||= friend.display_name?.trim() || '';
  }
  if (!customerName) return c.json({ success: false, error: 'お客様名が必要です' }, 400);
  const order = await createOrder(c.env.DB, {
    lineAccountId: body.lineAccountId,
    friendId: body.friendId,
    source: body.source,
    customerName,
    shippingMethod: body.shippingMethod?.trim() || null,
    note: body.note?.trim() || null,
    staffId: c.get('staff').id,
    items,
  });
  return c.json({ success: true, data: serialize(order) }, 201);
});

orders.patch('/api/orders/:id', async (c) => {
  const body = await c.req.json<{
    lineAccountId?: string; expectedUpdatedAt?: string; customerName?: string; source?: OrderSource;
    shippingMethod?: string | null; carrier?: string | null; trackingNumber?: string | null;
    expectedDeliveryDate?: string | null; deliveryTimeSlot?: string | null;
    deliveryInstruction?: string | null;
    note?: string | null;
    items?: Array<{ itemName?: string; quantity?: number; quantityUnit?: string; unitPrice?: number | null }>;
  }>();
  if (!body.expectedUpdatedAt) return c.json({ success: false, error: '画面を再読み込みしてください' }, 400);
  if (!body.customerName?.trim()) return c.json({ success: false, error: 'お客様名が必要です' }, 400);
  if (!body.source || !SOURCES.has(body.source)) return c.json({ success: false, error: '受付方法が不正です' }, 400);
  const items = (body.items ?? []).map((item) => ({
    itemName: item.itemName?.trim() || '',
    quantity: Number(item.quantity ?? 1),
    quantityUnit: item.quantityUnit?.trim() || '個',
    unitPrice: item.unitPrice == null ? null : Number(item.unitPrice),
  })).filter((item) => item.itemName);
  if (items.length === 0) return c.json({ success: false, error: '商品を1件以上入力してください' }, 400);
  if (items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
    item.quantityUnit.length > 12 ||
    (item.unitPrice != null && (!Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0)))) {
    return c.json({ success: false, error: '数量・単位・金額のいずれかが不正です' }, 400);
  }
  const expectedDeliveryDate = body.expectedDeliveryDate?.trim() || null;
  if (expectedDeliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDeliveryDate)) {
    return c.json({ success: false, error: '到着予定日は YYYY-MM-DD 形式で入力してください' }, 400);
  }
  for (const [value, label] of [
    [body.deliveryTimeSlot, '時間指定'],
    [body.deliveryInstruction, '受取方法'],
    [body.carrier, '配送会社'],
    [body.trackingNumber, 'お問い合わせ番号'],
  ] as const) {
    if (value && value.trim().length > 100) {
      return c.json({ success: false, error: `${label}は100文字以内で入力してください` }, 400);
    }
  }
  const current = await getOrder(c.env.DB, c.req.param('id'));
  if (!current) return c.json({ success: false, error: '注文が見つかりません' }, 404);
  if (!body.lineAccountId || current.line_account_id !== body.lineAccountId) {
    return c.json({ success: false, error: 'このLINEアカウントの注文ではありません' }, 403);
  }
  const updated = await updateOrder(c.env.DB, {
    id: current.id,
    expectedUpdatedAt: body.expectedUpdatedAt,
    customerName: body.customerName.trim(),
    source: body.source,
    shippingMethod: body.shippingMethod?.trim() || null,
    carrier: body.carrier?.trim() || null,
    trackingNumber: body.trackingNumber?.trim() || null,
    expectedDeliveryDate,
    deliveryTimeSlot: body.deliveryTimeSlot?.trim() || null,
    deliveryInstruction: body.deliveryInstruction?.trim() || null,
    note: body.note?.trim() || null,
    staffId: c.get('staff').id,
    items,
  });
  if (!updated) return c.json({ success: false, error: '別の画面で注文が変更されました。再読み込みしてください' }, 409);
  return c.json({ success: true, data: serialize(updated) });
});

orders.patch('/api/orders/:id/status', async (c) => {
  const body = await c.req.json<{
    status?: OrderStatus; confirmShipped?: boolean; carrier?: string | null;
    trackingNumber?: string | null; note?: string | null; lineAccountId?: string;
    expectedDeliveryDate?: string | null; deliveryTimeSlot?: string | null;
    deliveryInstruction?: string | null; notifyLine?: boolean; notificationText?: string | null;
  }>();
  if (!isStatus(body.status)) return c.json({ success: false, error: '進捗が不正です' }, 400);
  const current = await getOrder(c.env.DB, c.req.param('id'));
  if (!current) return c.json({ success: false, error: '注文が見つかりません' }, 404);
  if (!body.lineAccountId || current.line_account_id !== body.lineAccountId) {
    return c.json({ success: false, error: 'このLINEアカウントの注文ではありません' }, 403);
  }
  if (current.lifecycle_status !== 'active') {
    return c.json({ success: false, error: 'キャンセル・取り消し・返品済みの注文は進捗を変更できません' }, 409);
  }
  const fromIndex = STATUS_ORDER.indexOf(current.status);
  const toIndex = STATUS_ORDER.indexOf(body.status);
  if (Math.abs(toIndex - fromIndex) !== 1) {
    return c.json({ success: false, error: '進捗は1段階ずつ変更してください' }, 409);
  }
  if (body.status === 'shipped' && body.confirmShipped !== true) {
    return c.json({ success: false, error: '発送完了の個別確認が必要です' }, 400);
  }
  const expectedDeliveryDate = body.expectedDeliveryDate?.trim() || null;
  if (expectedDeliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDeliveryDate)) {
    return c.json({ success: false, error: '到着予定日は YYYY-MM-DD 形式で入力してください' }, 400);
  }
  for (const [value, label] of [
    [body.deliveryTimeSlot, '時間指定'],
    [body.deliveryInstruction, '受取方法'],
    [body.carrier, '配送会社'],
    [body.trackingNumber, 'お問い合わせ番号'],
  ] as const) {
    if (value && value.trim().length > 100) {
      return c.json({ success: false, error: `${label}は100文字以内で入力してください` }, 400);
    }
  }
  const customNotificationText = body.notificationText?.trim() || null;
  if (customNotificationText && customNotificationText.length > 2000) {
    return c.json({ success: false, error: 'LINE発送案内は2000文字以内で入力してください' }, 400);
  }
  if (fromIndex > toIndex && current.status === 'shipped' && c.get('staff').role === 'staff') {
    return c.json({ success: false, error: '発送済みを戻すには管理者権限が必要です' }, 403);
  }
  const updated = await transitionOrder(c.env.DB, {
    id: current.id,
    fromStatus: current.status,
    toStatus: body.status,
    staffId: c.get('staff').id,
    carrier: body.carrier?.trim() || null,
    trackingNumber: body.trackingNumber?.trim() || null,
    expectedDeliveryDate,
    deliveryTimeSlot: body.deliveryTimeSlot?.trim() || null,
    deliveryInstruction: body.deliveryInstruction?.trim() || null,
    note: body.note?.trim() || null,
  });
  if (!updated) return c.json({ success: false, error: '別の画面で進捗が変更されました。再読み込みしてください' }, 409);
  let finalOrder = updated;
  let notification: { sent: boolean; error?: string } | null = null;
  if (body.status === 'shipped' && body.notifyLine) {
    const message = customNotificationText ?? buildShippingNotificationText({
      customerName: updated.customer_name_snapshot,
      expectedDeliveryDate,
      deliveryTimeSlot: body.deliveryTimeSlot,
      deliveryInstruction: body.deliveryInstruction,
      carrier: body.carrier,
      trackingNumber: body.trackingNumber,
    });
    if (!updated.friend_id) {
      finalOrder = (await recordOrderShippingNotification(c.env.DB, {
        id: updated.id, status: 'not_applicable', text: message,
        error: 'LINEが紐づいていません',
      })) ?? updated;
      notification = { sent: false, error: 'LINEが紐づいていないため、発送記録だけ保存しました' };
    } else {
      try {
        const row = await c.env.DB.prepare(
          `SELECT f.id, f.line_user_id, la.channel_access_token
             FROM friends f JOIN line_accounts la ON la.id = f.line_account_id
            WHERE f.id = ? AND f.line_account_id = ?`,
        ).bind(updated.friend_id, updated.line_account_id).first<{
          id: string; line_user_id: string; channel_access_token: string;
        }>();
        if (!row) throw new Error('LINE送信先を確認できません');
        const { LineClient } = await import('@line-crm/line-sdk');
        await new LineClient(row.channel_access_token).pushTextMessage(row.line_user_id, message);
        const now = jstNow();
        await c.env.DB.prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, created_at)
           VALUES (?, ?, 'outgoing', 'text', ?, 'manual', ?)`,
        ).bind(crypto.randomUUID(), row.id, message, now).run();
        finalOrder = (await recordOrderShippingNotification(c.env.DB, {
          id: updated.id, status: 'sent', text: message,
        })) ?? updated;
        notification = { sent: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'LINE送信に失敗しました';
        finalOrder = (await recordOrderShippingNotification(c.env.DB, {
          id: updated.id, status: 'failed', text: message, error: detail.slice(0, 500),
        })) ?? updated;
        notification = { sent: false, error: '発送は記録しましたが、LINE送信に失敗しました' };
      }
    }
  }
  return c.json({ success: true, data: serialize(finalOrder), notification });
});

orders.patch('/api/orders/:id/lifecycle', async (c) => {
  const body = await c.req.json<{
    lineAccountId?: string;
    expectedUpdatedAt?: string;
    action?: 'cancel' | 'void' | 'return_refund' | 'update_refund';
    reason?: string;
    refundType?: OrderRefundType;
    refundStatus?: OrderRefundStatus;
    refundAmount?: number | null;
  }>();
  if (!body.lineAccountId || !body.expectedUpdatedAt) {
    return c.json({ success: false, error: '画面を再読み込みしてください' }, 400);
  }
  const current = await getOrder(c.env.DB, c.req.param('id'));
  if (!current) return c.json({ success: false, error: '注文が見つかりません' }, 404);
  if (current.line_account_id !== body.lineAccountId) {
    return c.json({ success: false, error: 'このLINEアカウントの注文ではありません' }, 403);
  }
  const reason = body.reason?.trim() || current.lifecycle_reason?.trim() || '';
  if (!reason) return c.json({ success: false, error: '処理理由を入力してください' }, 400);

  let lifecycleStatus: Exclude<OrderLifecycleStatus, 'active'>;
  let refundType: OrderRefundType = 'none';
  let refundStatus: OrderRefundStatus = 'not_required';
  let refundAmount: number | null = null;
  if (body.action === 'cancel') {
    if (current.lifecycle_status !== 'active' || current.status === 'shipped') {
      return c.json({ success: false, error: '発送前の有効な注文だけキャンセルできます' }, 409);
    }
    lifecycleStatus = 'cancelled';
  } else if (body.action === 'void') {
    if (current.lifecycle_status !== 'active') {
      return c.json({ success: false, error: '有効な注文だけ取り消せます' }, 409);
    }
    lifecycleStatus = 'voided';
  } else if (body.action === 'return_refund' || body.action === 'update_refund') {
    if (body.action === 'return_refund' && (current.lifecycle_status !== 'active' || current.status !== 'shipped')) {
      return c.json({ success: false, error: '発送済みの有効な注文だけ返品・返金を登録できます' }, 409);
    }
    if (body.action === 'update_refund' && current.lifecycle_status !== 'returned') {
      return c.json({ success: false, error: '返品・返金の登録後に更新できます' }, 409);
    }
    lifecycleStatus = 'returned';
    refundType = body.refundType ?? current.refund_type;
    if (!['none', 'partial', 'full'].includes(refundType)) {
      return c.json({ success: false, error: '返金区分が不正です' }, 400);
    }
    refundStatus = refundType === 'none' ? 'not_required' : (body.refundStatus ?? current.refund_status);
    if (!['not_required', 'pending', 'completed'].includes(refundStatus) ||
      (refundType !== 'none' && refundStatus === 'not_required')) {
      return c.json({ success: false, error: '返金状況が不正です' }, 400);
    }
    const total = (current.items ?? []).reduce(
      (sum, item) => sum + (item.unit_price ?? 0) * item.quantity, 0,
    );
    if (refundType === 'full') {
      refundAmount = total > 0 ? total : Number(body.refundAmount ?? current.refund_amount ?? 0);
      if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0) {
        return c.json({ success: false, error: '全額返金の金額を入力してください' }, 400);
      }
    } else if (refundType === 'partial') {
      refundAmount = Number(body.refundAmount ?? current.refund_amount ?? 0);
      if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0 || (total > 0 && refundAmount >= total)) {
        return c.json({ success: false, error: '一部返金額は合計金額より小さい金額で入力してください' }, 400);
      }
    }
  } else {
    return c.json({ success: false, error: '処理方法が不正です' }, 400);
  }

  const updated = await updateOrderLifecycle(c.env.DB, {
    id: current.id,
    expectedUpdatedAt: body.expectedUpdatedAt,
    lifecycleStatus,
    reason,
    refundType,
    refundStatus,
    refundAmount,
    staffId: c.get('staff').id,
  });
  if (!updated) {
    return c.json({ success: false, error: '別の画面で注文が変更されました。再読み込みしてください' }, 409);
  }
  return c.json({ success: true, data: serialize(updated) });
});

orders.post('/api/orders/bulk-advance', async (c) => {
  const body = await c.req.json<{ ids?: string[]; status?: OrderStatus }>();
  const ids = [...new Set((body.ids ?? []).filter(Boolean))];
  if (ids.length === 0 || !isStatus(body.status)) return c.json({ success: false, error: '注文と進捗を選んでください' }, 400);
  if (body.status === 'shipped') return c.json({ success: false, error: '発送済みは一括処理できません' }, 400);
  const targetIndex = STATUS_ORDER.indexOf(body.status);
  if (targetIndex <= 0) return c.json({ success: false, error: '一括処理できない進捗です' }, 400);
  const previous = STATUS_ORDER[targetIndex - 1];
  const now = new Date().toISOString();
  const timestampColumn = body.status === 'preparing' ? 'preparing_at' : 'ready_to_ship_at';
  const placeholders = ids.map(() => '?').join(',');
  const eligible = await c.env.DB.prepare(
    `SELECT id FROM orders WHERE id IN (${placeholders}) AND status = ? AND lifecycle_status = 'active'`,
  ).bind(...ids, previous).all<{ id: string }>();
  if (eligible.results.length !== ids.length) {
    return c.json({ success: false, error: '選択中に現在の段階と異なる注文があります。再読み込みしてください' }, 409);
  }
  const staffId = c.get('staff').id;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE orders SET status = ?, ${timestampColumn} = ?, updated_by_staff_id = ?, updated_at = ?
        WHERE id IN (${placeholders}) AND status = ? AND lifecycle_status = 'active'`,
    ).bind(body.status, now, staffId, now, ...ids, previous),
    ...ids.map((id) => c.env.DB.prepare(
      `INSERT INTO order_status_history
        (id, order_id, from_status, to_status, staff_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, '一括操作', ?)`,
    ).bind(crypto.randomUUID(), id, previous, body.status, staffId, now)),
  ]);
  return c.json({ success: true, data: { updated: ids.length } });
});

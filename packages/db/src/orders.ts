import { jstNow, toJstString } from './utils.js';

export type OrderStatus = 'unconfirmed' | 'preparing' | 'ready_to_ship' | 'shipped';
export type OrderSource = 'line' | 'phone' | 'store' | 'other';
export type OrderLifecycleStatus = 'active' | 'cancelled' | 'voided' | 'returned';
export type OrderRefundType = 'none' | 'partial' | 'full';
export type OrderRefundStatus = 'not_required' | 'pending' | 'completed';
export type OrderShippingNotificationStatus = 'not_sent' | 'sent' | 'failed' | 'not_applicable';

export interface OrderItem {
  id: string;
  order_id: string;
  item_name: string;
  quantity: number;
  quantity_unit: string;
  unit_price: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  status: OrderStatus;
  source: OrderSource;
  customer_name_snapshot: string;
  shipping_method: string | null;
  carrier: string | null;
  tracking_number: string | null;
  expected_delivery_date: string | null;
  delivery_time_slot: string | null;
  delivery_instruction: string | null;
  shipping_notification_status: OrderShippingNotificationStatus;
  shipping_notification_sent_at: string | null;
  shipping_notification_error: string | null;
  shipping_notification_text: string | null;
  note: string | null;
  preparing_at: string | null;
  ready_to_ship_at: string | null;
  shipped_at: string | null;
  lifecycle_status: OrderLifecycleStatus;
  lifecycle_reason: string | null;
  lifecycle_at: string | null;
  lifecycle_by_staff_id: string | null;
  refund_type: OrderRefundType;
  refund_status: OrderRefundStatus;
  refund_amount: number | null;
  refund_processed_at: string | null;
  created_by_staff_id: string;
  updated_by_staff_id: string;
  created_at: string;
  updated_at: string;
  friend_name?: string | null;
  friend_picture_url?: string | null;
  items?: OrderItem[];
}

export interface CreateOrderInput {
  lineAccountId: string;
  friendId?: string | null;
  source?: OrderSource;
  customerName: string;
  shippingMethod?: string | null;
  note?: string | null;
  staffId: string;
  items: Array<{ itemName: string; quantity: number; quantityUnit?: string; unitPrice?: number | null }>;
}

export interface UpdateOrderInput {
  id: string;
  expectedUpdatedAt: string;
  source: OrderSource;
  customerName: string;
  shippingMethod?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  expectedDeliveryDate?: string | null;
  deliveryTimeSlot?: string | null;
  deliveryInstruction?: string | null;
  note?: string | null;
  staffId: string;
  items: Array<{ itemName: string; quantity: number; quantityUnit?: string; unitPrice?: number | null }>;
}

export async function listOrders(
  db: D1Database,
  input: { lineAccountId: string; status?: OrderStatus; friendId?: string },
): Promise<Order[]> {
  const conditions = ['o.line_account_id = ?'];
  const values: unknown[] = [input.lineAccountId];
  if (input.status) { conditions.push('o.status = ?'); values.push(input.status); }
  if (input.friendId) { conditions.push('o.friend_id = ?'); values.push(input.friendId); }
  const result = await db.prepare(
    `SELECT o.*, f.display_name AS friend_name, f.picture_url AS friend_picture_url
       FROM orders o LEFT JOIN friends f ON f.id = o.friend_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY CASE o.status
        WHEN 'unconfirmed' THEN 0 WHEN 'preparing' THEN 1
        WHEN 'ready_to_ship' THEN 2 ELSE 3 END,
        o.updated_at DESC`,
  ).bind(...values).all<Order>();
  const orders = result.results;
  if (orders.length === 0) return [];
  const placeholders = orders.map(() => '?').join(',');
  const itemResult = await db.prepare(
    `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY sort_order ASC, created_at ASC`,
  ).bind(...orders.map((order) => order.id)).all<OrderItem>();
  const byOrder = new Map<string, OrderItem[]>();
  for (const item of itemResult.results) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push(item);
    byOrder.set(item.order_id, list);
  }
  return orders.map((order) => ({ ...order, items: byOrder.get(order.id) ?? [] }));
}

export interface UpdateOrderLifecycleInput {
  id: string;
  expectedUpdatedAt: string;
  lifecycleStatus: Exclude<OrderLifecycleStatus, 'active'>;
  reason: string;
  refundType: OrderRefundType;
  refundStatus: OrderRefundStatus;
  refundAmount?: number | null;
  staffId: string;
}

export async function updateOrderLifecycle(
  db: D1Database,
  input: UpdateOrderLifecycleInput,
): Promise<Order | null> {
  const current = await getOrder(db, input.id);
  if (!current || current.updated_at !== input.expectedUpdatedAt) return null;
  const generatedNow = jstNow();
  const currentMs = new Date(current.updated_at).getTime();
  const now = new Date(generatedNow).getTime() <= currentMs
    ? toJstString(new Date(currentMs + 1))
    : generatedNow;
  const refundProcessedAt = input.refundStatus === 'completed' ? now : null;
  const update = db.prepare(
    `UPDATE orders SET lifecycle_status = ?, lifecycle_reason = ?,
       lifecycle_at = CASE WHEN lifecycle_status = 'active' THEN ? ELSE lifecycle_at END,
       lifecycle_by_staff_id = ?, refund_type = ?, refund_status = ?, refund_amount = ?,
       refund_processed_at = ?, updated_by_staff_id = ?, updated_at = ?
     WHERE id = ? AND updated_at = ?`,
  ).bind(
    input.lifecycleStatus, input.reason, now, input.staffId,
    input.refundType, input.refundStatus, input.refundAmount ?? null,
    refundProcessedAt, input.staffId, now, input.id, input.expectedUpdatedAt,
  );
  const history = db.prepare(
    `INSERT INTO order_lifecycle_history
      (id, order_id, from_lifecycle_status, to_lifecycle_status, refund_type,
       refund_status, refund_amount, reason, staff_id, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM orders WHERE id = ? AND updated_at = ? AND updated_by_staff_id = ?
      )`,
  ).bind(
    crypto.randomUUID(), input.id, current.lifecycle_status, input.lifecycleStatus,
    input.refundType, input.refundStatus, input.refundAmount ?? null,
    input.reason, input.staffId, now, input.id, now, input.staffId,
  );
  const results = await db.batch([update, history]);
  if ((results[0].meta.changes ?? 0) !== 1) return null;
  return getOrder(db, input.id);
}

export async function getOrder(db: D1Database, id: string): Promise<Order | null> {
  const order = await db.prepare(
    `SELECT o.*, f.display_name AS friend_name, f.picture_url AS friend_picture_url
       FROM orders o LEFT JOIN friends f ON f.id = o.friend_id WHERE o.id = ?`,
  ).bind(id).first<Order>();
  if (!order) return null;
  const items = await db.prepare(
    'SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order ASC, created_at ASC',
  ).bind(id).all<OrderItem>();
  return { ...order, items: items.results };
}

export async function createOrder(db: D1Database, input: CreateOrderInput): Promise<Order> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const statements = [
    db.prepare(
      `INSERT INTO orders
        (id, line_account_id, friend_id, status, source, customer_name_snapshot,
         shipping_method, note, created_by_staff_id, updated_by_staff_id, created_at, updated_at)
       VALUES (?, ?, ?, 'unconfirmed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, input.lineAccountId, input.friendId ?? null, input.source ?? 'line',
      input.customerName, input.shippingMethod ?? null, input.note ?? null,
      input.staffId, input.staffId, now, now,
    ),
    ...input.items.map((item, index) => db.prepare(
      `INSERT INTO order_items
        (id, order_id, item_name, quantity, quantity_unit, unit_price, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), id, item.itemName, item.quantity,
      item.quantityUnit?.trim() || '個', item.unitPrice ?? null, index, now, now,
    )),
    db.prepare(
      `INSERT INTO order_status_history
        (id, order_id, from_status, to_status, staff_id, note, created_at)
       VALUES (?, ?, NULL, 'unconfirmed', ?, '注文を受け付けました', ?)`,
    ).bind(crypto.randomUUID(), id, input.staffId, now),
  ];
  await db.batch(statements);
  return (await getOrder(db, id))!;
}

function editableSnapshot(order: Order) {
  return {
    customerName: order.customer_name_snapshot,
    source: order.source,
    shippingMethod: order.shipping_method,
    carrier: order.carrier,
    trackingNumber: order.tracking_number,
    expectedDeliveryDate: order.expected_delivery_date,
    deliveryTimeSlot: order.delivery_time_slot,
    deliveryInstruction: order.delivery_instruction,
    note: order.note,
    items: (order.items ?? []).map((item) => ({
      itemName: item.item_name,
      quantity: item.quantity,
      quantityUnit: item.quantity_unit,
      unitPrice: item.unit_price,
    })),
  };
}

export async function updateOrder(db: D1Database, input: UpdateOrderInput): Promise<Order | null> {
  const current = await getOrder(db, input.id);
  if (!current || current.updated_at !== input.expectedUpdatedAt) return null;
  const generatedNow = jstNow();
  const currentMs = new Date(current.updated_at).getTime();
  const now = new Date(generatedNow).getTime() <= currentMs
    ? toJstString(new Date(currentMs + 1))
    : generatedNow;
  const nextSnapshot = {
    customerName: input.customerName,
    source: input.source,
    shippingMethod: input.shippingMethod ?? null,
    carrier: input.carrier ?? null,
    trackingNumber: input.trackingNumber ?? null,
    expectedDeliveryDate: input.expectedDeliveryDate ?? null,
    deliveryTimeSlot: input.deliveryTimeSlot ?? null,
    deliveryInstruction: input.deliveryInstruction ?? null,
    note: input.note ?? null,
    items: input.items.map((item) => ({
      itemName: item.itemName,
      quantity: item.quantity,
      quantityUnit: item.quantityUnit?.trim() || '個',
      unitPrice: item.unitPrice ?? null,
    })),
  };
  const guardSql = `EXISTS (
    SELECT 1 FROM orders WHERE id = ? AND updated_at = ? AND updated_by_staff_id = ?
  )`;
  const statements = [
    db.prepare(
      `UPDATE orders SET customer_name_snapshot = ?, source = ?, shipping_method = ?,
         carrier = ?, tracking_number = ?, expected_delivery_date = ?, delivery_time_slot = ?,
         delivery_instruction = ?, note = ?, updated_by_staff_id = ?, updated_at = ?
       WHERE id = ? AND updated_at = ?`,
    ).bind(
      input.customerName, input.source, input.shippingMethod ?? null,
      input.carrier ?? null, input.trackingNumber ?? null, input.expectedDeliveryDate ?? null,
      input.deliveryTimeSlot ?? null, input.deliveryInstruction ?? null, input.note ?? null,
      input.staffId, now, input.id, input.expectedUpdatedAt,
    ),
    db.prepare(`DELETE FROM order_items WHERE order_id = ? AND ${guardSql}`)
      .bind(input.id, input.id, now, input.staffId),
    ...nextSnapshot.items.map((item, index) => db.prepare(
      `INSERT INTO order_items
        (id, order_id, item_name, quantity, quantity_unit, unit_price, sort_order, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guardSql}`,
    ).bind(
      crypto.randomUUID(), input.id, item.itemName, item.quantity, item.quantityUnit,
      item.unitPrice, index, now, now, input.id, now, input.staffId,
    )),
    db.prepare(
      `INSERT INTO order_edit_history
        (id, order_id, staff_id, before_json, after_json, created_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE ${guardSql}`,
    ).bind(
      crypto.randomUUID(), input.id, input.staffId,
      JSON.stringify(editableSnapshot(current)), JSON.stringify(nextSnapshot), now,
      input.id, now, input.staffId,
    ),
  ];
  const results = await db.batch(statements);
  if ((results[0].meta.changes ?? 0) !== 1) return null;
  return getOrder(db, input.id);
}

export async function transitionOrder(
  db: D1Database,
  input: {
    id: string; fromStatus: OrderStatus; toStatus: OrderStatus; staffId: string;
    carrier?: string | null; trackingNumber?: string | null; note?: string | null;
    expectedDeliveryDate?: string | null; deliveryTimeSlot?: string | null;
    deliveryInstruction?: string | null;
  },
): Promise<Order | null> {
  const now = jstNow();
  const timestampColumn = input.toStatus === 'preparing' ? 'preparing_at'
    : input.toStatus === 'ready_to_ship' ? 'ready_to_ship_at'
      : input.toStatus === 'shipped' ? 'shipped_at' : null;
  const timestampSql = timestampColumn ? `, ${timestampColumn} = ?` : '';
  const binds: unknown[] = [input.toStatus, input.staffId, now];
  if (timestampColumn) binds.push(now);
  binds.push(
    input.carrier ?? null, input.trackingNumber ?? null,
    input.expectedDeliveryDate ?? null, input.deliveryTimeSlot ?? null,
    input.deliveryInstruction ?? null, input.id, input.fromStatus,
  );
  const update = db.prepare(
    `UPDATE orders SET status = ?, updated_by_staff_id = ?, updated_at = ?${timestampSql},
       carrier = COALESCE(?, carrier), tracking_number = COALESCE(?, tracking_number),
       expected_delivery_date = COALESCE(?, expected_delivery_date),
       delivery_time_slot = COALESCE(?, delivery_time_slot),
       delivery_instruction = COALESCE(?, delivery_instruction)
     WHERE id = ? AND status = ?`,
  ).bind(...binds);
  const history = db.prepare(
    `INSERT INTO order_status_history
      (id, order_id, from_status, to_status, staff_id, note, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM orders
         WHERE id = ? AND status = ? AND updated_by_staff_id = ? AND updated_at = ?
      )`,
  ).bind(
    crypto.randomUUID(), input.id, input.fromStatus, input.toStatus,
    input.staffId, input.note ?? null, now,
    input.id, input.toStatus, input.staffId, now,
  );
  const results = await db.batch([update, history]);
  if ((results[0].meta.changes ?? 0) !== 1) return null;
  return getOrder(db, input.id);
}

export async function recordOrderShippingNotification(
  db: D1Database,
  input: {
    id: string;
    status: OrderShippingNotificationStatus;
    text?: string | null;
    error?: string | null;
  },
): Promise<Order | null> {
  const now = jstNow();
  await db.prepare(
    `UPDATE orders SET shipping_notification_status = ?,
       shipping_notification_sent_at = CASE WHEN ? = 'sent' THEN ? ELSE shipping_notification_sent_at END,
       shipping_notification_error = ?, shipping_notification_text = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(input.status, input.status, now, input.error ?? null, input.text ?? null, now, input.id).run();
  return getOrder(db, input.id);
}

export async function getOrderStatusHistory(db: D1Database, orderId: string) {
  const result = await db.prepare(
    `SELECT id, order_id, from_status, to_status, staff_id, note, created_at
       FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC`,
  ).bind(orderId).all<{
    id: string; order_id: string; from_status: OrderStatus | null; to_status: OrderStatus;
    staff_id: string; note: string | null; created_at: string;
  }>();
  return result.results;
}

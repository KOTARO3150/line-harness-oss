import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { LineClient, LineSendPausedError, setLineSendGuard } from '@line-crm/line-sdk';

/**
 * LINE送信の緊急停止スイッチ。
 *
 * 1. LineClient: 停止中はお客様に届く API だけを止め、それ以外（プロフィール取得など）は通す。
 * 2. API: 止めるのは誰でも、再開は owner / admin だけ。
 */

type Role = 'owner' | 'admin' | 'staff';

const state = vi.hoisted(() => ({
  paused: false,
  reason: null as string | null,
  staffId: null as string | null,
}));

vi.mock('@line-crm/db', () => ({
  jstNow: () => '2026-10-31T00:00:00+09:00',
  getLineSendPause: async () => ({
    paused: state.paused, reason: state.reason, updatedByStaffId: state.staffId, updatedAt: null,
  }),
  setLineSendPause: async (_db: unknown, input: { paused: boolean; reason: string | null; staffId: string }) => {
    state.paused = input.paused;
    state.reason = input.reason;
    state.staffId = input.staffId;
    return { paused: state.paused, reason: state.reason, updatedByStaffId: state.staffId, updatedAt: 't' };
  },
}));

const { sendPause } = await import('./send-pause.js');

function appAs(role: Role) {
  const app = new Hono<{ Variables: { staff: { id: string; role: Role } }; Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: `${role}-1`, role });
    c.env = { DB: {} } as never;
    await next();
  });
  app.route('/', sendPause);
  return app;
}

function post(role: Role, body: unknown) {
  return appAs(role).request('/api/line-send-pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.paused = false;
  state.reason = null;
  state.staffId = null;
});

describe('LineClient の送信ガード', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    setLineSendGuard(null);
    vi.unstubAllGlobals();
  });

  const client = () => new LineClient('token');
  const sends: [string, (c: LineClient) => Promise<unknown>][] = [
    ['push', (c) => c.pushTextMessage('U1', 'hi')],
    ['multicast', (c) => c.multicast(['U1'], [{ type: 'text', text: 'hi' }])],
    ['broadcast', (c) => c.broadcast([{ type: 'text', text: 'hi' }])],
    ['reply', (c) => c.replyMessage('rt', [{ type: 'text', text: 'hi' }])],
  ];

  for (const [label, send] of sends) {
    test(`停止中の ${label} は LINE に届かない`, async () => {
      setLineSendGuard(async () => true);
      await expect(send(client())).rejects.toBeInstanceOf(LineSendPausedError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  test('停止していなければ送る', async () => {
    setLineSendGuard(async () => false);
    await client().pushTextMessage('U1', 'hi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('停止中でもプロフィール取得や既読は止めない', async () => {
    setLineSendGuard(async () => true);
    await client().getProfile('U1');
    await client().markMessagesAsRead('tok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('停止状態を確認できないときは送る（故障で全配信を止めない）', async () => {
    setLineSendGuard(async () => { throw new Error('D1 down'); });
    await client().pushTextMessage('U1', 'hi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('緊急停止 API', () => {
  test('誰でも状態を見られる', async () => {
    const res = await appAs('staff').request('/api/line-send-pause');
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { paused: boolean } }).data.paused).toBe(false);
  });

  test('staff でも止められる', async () => {
    const res = await post('staff', { paused: true, reason: ' 誤配信 ' });
    expect(res.status).toBe(200);
    expect(state.paused).toBe(true);
    expect(state.reason).toBe('誤配信');
    expect(state.staffId).toBe('staff-1');
  });

  test('staff は再開できない', async () => {
    state.paused = true;
    const res = await post('staff', { paused: false });
    expect(res.status).toBe(403);
    expect(state.paused).toBe(true);
  });

  for (const role of ['owner', 'admin'] as const) {
    test(`${role} は再開できる`, async () => {
      state.paused = true;
      const res = await post(role, { paused: false });
      expect(res.status).toBe(200);
      expect(state.paused).toBe(false);
    });
  }

  test('paused が真偽値でなければ 400', async () => {
    const res = await post('owner', { paused: 'yes' });
    expect(res.status).toBe(400);
    expect(state.paused).toBe(false);
  });

  test('理由が長すぎれば 400', async () => {
    const res = await post('owner', { paused: true, reason: 'あ'.repeat(501) });
    expect(res.status).toBe(400);
    expect(state.paused).toBe(false);
  });
});

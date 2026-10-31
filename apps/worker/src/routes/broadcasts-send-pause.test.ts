import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * 緊急停止中は、一斉配信の送信系エンドポイントが入口で 409 を返し、
 * 配信の状態（DB）に一切触れないこと。
 */

const touched = vi.hoisted(() => ({ count: 0 }));

vi.mock('../services/send-pause.js', () => ({
  isLineSendPausedSafe: async () => true,
  installLineSendGuard: () => {},
}));

vi.mock('@line-crm/db', () =>
  new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (typeof prop === 'symbol' || prop === 'then' || prop === '__esModule') return undefined;
        return () => {
          touched.count++;
          throw new Error(`@line-crm/db.${String(prop)} should not be reached`);
        };
      },
    },
  ),
);

const { broadcasts } = await import('./broadcasts.js');

function appAsOwner() {
  const app = new Hono<{ Variables: { staff: { id: string; role: 'owner' } }; Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 's1', role: 'owner' });
    c.env = {
      DB: {
        prepare() {
          touched.count++;
          throw new Error('DB should not be reached');
        },
      },
    } as never;
    await next();
  });
  app.route('/', broadcasts);
  return app;
}

describe('緊急停止中の一斉配信', () => {
  for (const path of ['/api/broadcasts/b1/send', '/api/broadcasts/b1/send-segment', '/api/broadcasts/b1/test-send']) {
    test(`${path} は 409 で、何も変更しない`, async () => {
      touched.count = 0;
      const res = await appAsOwner().request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(409);
      expect(touched.count).toBe(0);
    });
  }
});

import { describe, expect, test, vi } from 'vitest';
import {
  hasPersonalization,
  loadPersonalizableFriends,
  sendPersonalized,
  type PersonalizableFriend,
} from './broadcast-personalization.js';
import type { LineClient, Message } from '@line-crm/line-sdk';

describe('差し込みの判定', () => {
  test('{{name}} は差し込み', () => {
    expect(hasPersonalization('{{name}}様、こんにちは')).toBe(true);
  });

  test('友だち情報欄の差し込みも拾う', () => {
    expect(hasPersonalization('体質: {{metadata.体質}}')).toBe(true);
    expect(hasPersonalization('{{#if_metadata.体質}}あり{{/if_metadata.体質}}')).toBe(true);
  });

  test('{{ref}} と条件ブロックも拾う', () => {
    expect(hasPersonalization('{{ref}}')).toBe(true);
    expect(hasPersonalization('{{#if_ref}}x{{/if_ref}}')).toBe(true);
  });

  test('{{liff_id}} は差し込みではない（宛先によらず同じ値なので multicast のままで良い）', () => {
    expect(hasPersonalization('https://liff.line.me/{{liff_id}}?page=form')).toBe(false);
  });

  test('普通の本文は差し込みなし', () => {
    expect(hasPersonalization('明日は臨時休業です')).toBe(false);
  });

  test('波かっこがあっても知らない変数なら差し込み扱いしない', () => {
    expect(hasPersonalization('{{unknown_thing}}')).toBe(false);
  });
});

function friend(over: Partial<PersonalizableFriend> = {}): PersonalizableFriend {
  return {
    id: over.id ?? 'f1',
    line_user_id: over.line_user_id ?? 'U1',
    // null を明示的に渡せるように、?? ではなく in で判定する
    display_name: 'display_name' in over ? (over.display_name ?? null) : '山田',
    user_id: over.user_id ?? null,
    ref_code: over.ref_code ?? null,
    metadata: over.metadata ?? null,
  };
}

function fakeLine(behavior?: (userId: string) => void) {
  const sent: { to: string; text: string }[] = [];
  const client = {
    pushMessage: vi.fn(async (to: string, messages: Message[]) => {
      behavior?.(to);
      const m = messages[0] as { type: string; text?: string };
      sent.push({ to, text: m.text ?? '' });
      return {};
    }),
  } as unknown as LineClient;
  return { client, sent };
}

const asText = (expanded: string): Message => ({ type: 'text', text: expanded });

describe('1人ずつの差し込み送信', () => {
  test('宛先ごとに本文が変わる', async () => {
    const { client, sent } = fakeLine();
    const result = await sendPersonalized(
      client,
      [
        friend({ id: 'f1', line_user_id: 'U1', display_name: '山田' }),
        friend({ id: 'f2', line_user_id: 'U2', display_name: '鈴木' }),
      ],
      asText,
      '{{name}}様、こんにちは',
    );

    expect(sent).toEqual([
      { to: 'U1', text: '山田様、こんにちは' },
      { to: 'U2', text: '鈴木様、こんにちは' },
    ]);
    expect(result.sentFriendIds).toEqual(['f1', 'f2']);
    expect(result.ranOutOfTime).toBe(false);
  });

  test('名前が無い人は空文字になる（送信自体は止めない）', async () => {
    const { client, sent } = fakeLine();
    await sendPersonalized(
      client,
      [friend({ display_name: null })],
      asText,
      '{{name}}様、こんにちは',
    );
    expect(sent[0].text).toBe('様、こんにちは');
  });

  test('友だち情報欄の値が入る', async () => {
    const { client, sent } = fakeLine();
    await sendPersonalized(
      client,
      [friend({ metadata: JSON.stringify({ 体質: '冷え' }) })],
      asText,
      'ご体質は{{metadata.体質}}でしたね',
    );
    expect(sent[0].text).toBe('ご体質は冷えでしたね');
  });

  test('1人が失敗しても残りは送る', async () => {
    const { client, sent } = fakeLine((to) => {
      if (to === 'U2') throw new Error('403 blocked');
    });
    const result = await sendPersonalized(
      client,
      [
        friend({ id: 'f1', line_user_id: 'U1' }),
        friend({ id: 'f2', line_user_id: 'U2' }),
        friend({ id: 'f3', line_user_id: 'U3' }),
      ],
      asText,
      '{{name}}様',
    );

    expect(sent.map((s) => s.to)).toEqual(['U1', 'U3']);
    expect(result.sentFriendIds).toEqual(['f1', 'f3']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].friendId).toBe('f2');
  });

  test('時間切れになったらそこで止めて、送った人だけ返す', async () => {
    const { client, sent } = fakeLine();
    const many = Array.from({ length: 50 }, (_, i) =>
      friend({ id: `f${i}`, line_user_id: `U${i}` }),
    );
    // budget 0 なら 1 人送った時点で打ち切る（i > 0 の判定のため必ず 1 人は送る）
    const result = await sendPersonalized(client, many, asText, '{{name}}様', {
      budgetMs: 0,
    });

    expect(result.ranOutOfTime).toBe(true);
    expect(sent.length).toBe(1);
    expect(result.sentFriendIds).toEqual(['f0']);
  });

  test('宛先が空なら何もしない', async () => {
    const { client, sent } = fakeLine();
    const result = await sendPersonalized(client, [], asText, '{{name}}様');
    expect(sent).toHaveLength(0);
    expect(result).toEqual({ sentFriendIds: [], failed: [], ranOutOfTime: false });
  });
});

describe('差し込みに要る列の取得', () => {
  function dbWith(rows: PersonalizableFriend[]): D1Database {
    return {
      prepare: () => ({
        bind: (...ids: unknown[]) => ({
          all: async () => ({
            // DB は順不同で返しうる。並び順は呼出側で戻すのが仕様。
            results: [...rows].reverse().filter((r) => ids.includes(r.id)),
          }),
        }),
      }),
    } as unknown as D1Database;
  }

  test('渡した順番のまま返る（送信順が入れ替わると再開位置がずれる）', async () => {
    const rows = [
      friend({ id: 'f1', line_user_id: 'U1' }),
      friend({ id: 'f2', line_user_id: 'U2' }),
      friend({ id: 'f3', line_user_id: 'U3' }),
    ];
    const got = await loadPersonalizableFriends(dbWith(rows), ['f1', 'f2', 'f3']);
    expect(got.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
  });

  test('見つからない id は飛ばす', async () => {
    const rows = [friend({ id: 'f1' })];
    const got = await loadPersonalizableFriends(dbWith(rows), ['f1', 'missing']);
    expect(got.map((f) => f.id)).toEqual(['f1']);
  });

  test('空なら DB を触らない', async () => {
    const prepare = vi.fn();
    const db = { prepare } as unknown as D1Database;
    expect(await loadPersonalizableFriends(db, [])).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });
});

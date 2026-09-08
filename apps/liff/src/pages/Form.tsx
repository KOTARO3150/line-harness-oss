import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getLineUserId } from '../lib/liff-auth.js';

// 管理画面で作ったフォームを、お客様に見せて回答してもらう画面。
//
// 想定しているお客様は高齢の方が多い。そのため:
//   - 文字は大きく (本文 18px / 見出し 20px)、行間も広く取る
//   - 選択式は「大きな枠を押す」形にする。丸い印だけを狙わせない
//   - 1画面に全部出す。ページ送りにすると戻れなくなる方が出る
//   - 送信できない理由は、その項目のすぐ上に日本語で出す

const BASE = import.meta.env.VITE_API_BASE ?? '';

type FieldType = 'text' | 'tel' | 'email' | 'number' | 'textarea' | 'date' | 'select' | 'radio';

interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  help?: string;
}

interface FormDef {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[] | string;
  isActive?: boolean;
}

function parseFields(raw: FormField[] | string): FormField[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function Form() {
  const [params] = useSearchParams();
  const formId = params.get('id') ?? '';

  const [def, setDef] = useState<FormDef | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!formId) {
      setLoadError('フォームが指定されていません。');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/forms/${formId}`);
        const json = (await res.json()) as { success: boolean; data?: FormDef; error?: string };
        if (!json.success || !json.data) {
          setLoadError(json.error ?? 'フォームを読み込めませんでした。');
          return;
        }
        setDef(json.data);
        setFields(parseFields(json.data.fields));
      } catch {
        setLoadError('通信できませんでした。電波の良い場所でもう一度お試しください。');
      }
    })();
    // 開いた回数を記録する。失敗しても入力の邪魔はしない。
    fetch(`${BASE}/api/forms/${formId}/opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineUserId: safeUserId() }),
    }).catch(() => {});
  }, [formId]);

  function safeUserId(): string | undefined {
    try {
      return getLineUserId();
    } catch {
      return undefined;
    }
  }

  function setValue(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }));
    setMissing((prev) => prev.filter((n) => n !== name));
  }

  async function submit() {
    const blank = fields
      .filter((f) => f.required && !(values[f.name] ?? '').trim())
      .map((f) => f.name);
    if (blank.length > 0) {
      setMissing(blank);
      setSendError('');
      const el = document.getElementById(`field-${blank[0]}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setSending(true);
    setSendError('');
    try {
      const res = await fetch(`${BASE}/api/forms/${formId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId: safeUserId(), data: values }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setSendError(json.error ?? '送信できませんでした。もう一度お試しください。');
        return;
      }
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch {
      setSendError('通信できませんでした。電波の良い場所でもう一度お試しください。');
    } finally {
      setSending(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md p-6 text-lg leading-relaxed">
        <p className="text-red-700">{loadError}</p>
      </div>
    );
  }

  if (!def) {
    return <div className="mx-auto max-w-md p-6 text-lg text-gray-500">読み込んでいます…</div>;
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md p-6 pt-16 text-center">
        <div className="mb-6 text-5xl" aria-hidden="true">✓</div>
        <h1 className="mb-4 text-2xl font-bold">送信しました</h1>
        <p className="text-lg leading-relaxed text-gray-700">
          ありがとうございます。<br />
          お店から LINE でご連絡します。<br />
          この画面は閉じていただいて大丈夫です。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-5 pb-32">
      <h1 className="text-2xl font-bold leading-snug">{def.name}</h1>
      {def.description && (
        <p className="mt-3 whitespace-pre-wrap text-lg leading-relaxed text-gray-700">
          {def.description}
        </p>
      )}

      <div className="mt-8 space-y-8">
        {fields.map((f) => {
          const isMissing = missing.includes(f.name);
          return (
            <div key={f.name} id={`field-${f.name}`}>
              <label
                className="block text-xl font-bold leading-snug"
                htmlFor={f.type === 'radio' ? undefined : `input-${f.name}`}
              >
                {f.label}
                {f.required && <span className="ml-2 text-base text-red-700">必須</span>}
              </label>
              {f.help && <p className="mt-1 text-base text-gray-600">{f.help}</p>}
              {isMissing && (
                <p className="mt-2 text-base font-bold text-red-700">
                  こちらをご記入ください
                </p>
              )}

              <div className="mt-3">
                {f.type === 'radio' && (
                  <div className="space-y-3">
                    {(f.options ?? []).map((opt) => {
                      const on = values[f.name] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setValue(f.name, opt)}
                          aria-pressed={on}
                          className={
                            'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-4 text-left text-lg ' +
                            (on
                              ? 'border-green-700 bg-green-50 font-bold text-green-900'
                              : 'border-gray-300 bg-white text-gray-800')
                          }
                        >
                          <span
                            aria-hidden="true"
                            className={
                              'inline-block h-6 w-6 flex-none rounded-full border-2 ' +
                              (on ? 'border-green-700 bg-green-700' : 'border-gray-400 bg-white')
                            }
                          />
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {f.type === 'select' && (
                  <select
                    id={`input-${f.name}`}
                    value={values[f.name] ?? ''}
                    onChange={(e) => setValue(f.name, e.target.value)}
                    className={
                      'w-full rounded-xl border-2 bg-white px-4 py-4 text-lg ' +
                      (isMissing ? 'border-red-500' : 'border-gray-300')
                    }
                  >
                    <option value="">選んでください</option>
                    {(f.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}

                {f.type === 'textarea' && (
                  <textarea
                    id={`input-${f.name}`}
                    rows={4}
                    value={values[f.name] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValue(f.name, e.target.value)}
                    className={
                      'w-full rounded-xl border-2 px-4 py-3 text-lg leading-relaxed ' +
                      (isMissing ? 'border-red-500' : 'border-gray-300')
                    }
                  />
                )}

                {['text', 'tel', 'email', 'number', 'date'].includes(f.type) && (
                  <input
                    id={`input-${f.name}`}
                    type={f.type}
                    inputMode={f.type === 'tel' ? 'tel' : f.type === 'number' ? 'numeric' : undefined}
                    value={values[f.name] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValue(f.name, e.target.value)}
                    className={
                      'w-full rounded-xl border-2 px-4 py-4 text-lg ' +
                      (isMissing ? 'border-red-500' : 'border-gray-300')
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sendError && (
        <p className="mt-6 rounded-xl bg-red-50 p-4 text-lg font-bold text-red-700">{sendError}</p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={sending}
        className="mt-10 w-full rounded-xl bg-green-700 px-4 py-5 text-xl font-bold text-white disabled:opacity-60"
      >
        {sending ? '送信しています…' : 'この内容で送る'}
      </button>
      <p className="mt-4 text-center text-base text-gray-600">
        送信後、お店から LINE でご連絡します
      </p>
    </div>
  );
}

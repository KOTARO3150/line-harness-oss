import liff from '@line/liff';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const BASE = import.meta.env.VITE_API_BASE ?? '';

interface AffiliateData {
  id: string;
  name: string;
  code: string;
  commissionRate: number;
  isActive: boolean;
  friendId: string;
}

interface AffiliateLinkData {
  refCode: string;
  label: string | null;
  url: string;
  clickCount: number;
  friendAdds: number;
  conversions: number;
  conversionsPending: number;
  conversionsApproved: number;
  offerId: string | null;
  offerName: string | null;
}

interface OfferData {
  id: string;
  name: string;
  description: string | null;
  rewardAmount: number;
  enrolled: boolean;
  refCode: string | null;
  url: string | null;
}

type State =
  | { phase: 'loading' }
  | { phase: 'not_registered' }
  | { phase: 'registered'; affiliate: AffiliateData; links: AffiliateLinkData[]; offers: OfferData[] }
  | { phase: 'error'; message: string };

async function getAccessToken(): Promise<string> {
  const token = liff.getAccessToken();
  if (!token) throw new Error('LINE アクセストークンを取得できませんでした');
  return token;
}

async function fetchMe(): Promise<
  | { registered: true; affiliate: AffiliateData; links: AffiliateLinkData[] }
  | { registered: false }
> {
  const token = await getAccessToken();
  const url = `${BASE}/api/liff/affiliate/me?lineAccessToken=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (res.status === 404) return { registered: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
  return { registered: true, affiliate: data.affiliate, links: data.links };
}

async function postRegister(): Promise<{ affiliate: AffiliateData; links: AffiliateLinkData[] }> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  return (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
}

async function postAddLink(label: string | null): Promise<AffiliateLinkData> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token, label: label || null }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { link: AffiliateLinkData };
  return data.link;
}

async function fetchOffers(): Promise<OfferData[]> {
  const token = await getAccessToken();
  const url = `${BASE}/api/liff/affiliate/offers?lineAccessToken=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { offers: OfferData[] };
  return data.offers;
}

async function postEnrollOffer(offerId: string): Promise<AffiliateLinkData> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/offers/${encodeURIComponent(offerId)}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { link: AffiliateLinkData };
  return data.link;
}

/**
 * Copy `text` with graceful degradation for LIFF WebViews:
 *   1. navigator.clipboard.writeText  — modern, needs secure context + permission
 *   2. document.execCommand('copy')   — legacy textarea-select fallback
 *   3. neither worked → caller shows the URL selected for manual copy
 * Returns true only when the browser confirms the copy succeeded.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    // fall through to manual-copy fallback
  }

  return false;
}

function CopyButton({ url, urlRef }: { url: string; urlRef: React.RefObject<HTMLInputElement | null> }) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);

  async function handleCopy() {
    const ok = await copyText(url);
    if (ok) {
      setManualCopy(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setManualCopy(true);
    setTimeout(() => {
      const el = urlRef.current;
      if (el) {
        el.focus();
        el.select();
        el.setSelectionRange(0, el.value.length);
      }
    }, 0);
  }

  return (
    <>
      <button
        onClick={handleCopy}
        className="shrink-0 text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded transition-colors"
      >
        {copied ? 'コピーしました' : 'コピー'}
      </button>
      {manualCopy && (
        <div className="w-full space-y-1">
          <p className="text-xs text-gray-500">
            自動コピーできませんでした。下のURLを選択してコピーしてください。
          </p>
          <input
            ref={urlRef}
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full border rounded px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      )}
    </>
  );
}

function LinkRow({ link }: { link: AffiliateLinkData }) {
  const urlRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap mb-1">
            {link.offerName ? (
              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                {link.offerName}
              </span>
            ) : (
              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                汎用
              </span>
            )}
            {link.label && (
              <span className="text-xs font-medium text-gray-700">{link.label}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 break-all">{link.url}</div>
        </div>
        <CopyButton url={link.url} urlRef={urlRef} />
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-gray-600">
        <span>クリック: <strong>{link.clickCount}</strong></span>
        <span>友だち追加: <strong>{link.friendAdds}</strong></span>
        <span>CV: 承認済み <strong>{link.conversionsApproved}</strong>・審査中 <strong>{link.conversionsPending}</strong></span>
      </div>
    </div>
  );
}

function OfferCard({
  offer,
  onEnrolled,
}: {
  offer: OfferData;
  onEnrolled: (link: AffiliateLinkData) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enrolledUrl = offer.url ?? '';
  const urlRef = useRef<HTMLInputElement>(null);
  const enrollCalledRef = useRef(false);

  const rewardLabel = offer.rewardAmount > 0
    ? `1件 ¥${offer.rewardAmount.toLocaleString()}`
    : '報酬未設定';

  async function handleEnroll() {
    if (busy || enrollCalledRef.current) return;
    enrollCalledRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const link = await postEnrollOffer(offer.id);
      onEnrolled(link);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      enrollCalledRef.current = false;
    }
  }

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-800">{offer.name}</div>
          {offer.description && (
            <div className="text-xs text-gray-500 mt-0.5">{offer.description}</div>
          )}
        </div>
        <div className="shrink-0 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded">
          {rewardLabel}
        </div>
      </div>

      {offer.enrolled ? (
        <div className="space-y-1">
          <div className="text-xs text-gray-600 font-medium">
            あなたの{offer.name}用リンク
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-xs text-gray-500 break-all flex-1 min-w-0">{enrolledUrl}</div>
            <CopyButton url={enrolledUrl} urlRef={urlRef} />
          </div>
        </div>
      ) : (
        <>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <button
            onClick={handleEnroll}
            disabled={busy}
            className="w-full bg-green-600 text-white py-2 rounded text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {busy ? '参加中...' : 'この案件に参加する'}
          </button>
        </>
      )}
    </div>
  );
}

export default function Affiliate() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [registerBusy, setRegisterBusy] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // registerCalledRef guards against a double-tap firing two POSTs while the
  // first is in flight. It is released in `finally` so that a *failed* register
  // can be retried — the button intentionally becomes clickable again on error.
  const registerCalledRef = useRef(false);

  const loadMe = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const result = await fetchMe();
      if (result.registered) {
        const offers = await fetchOffers().catch(() => []);
        setState({ phase: 'registered', affiliate: result.affiliate, links: result.links, offers });
      } else {
        setState({ phase: 'not_registered' });
      }
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function handleRegister() {
    if (registerBusy || registerCalledRef.current) return;
    registerCalledRef.current = true;
    setRegisterBusy(true);
    try {
      const data = await postRegister();
      const offers = await fetchOffers().catch(() => []);
      setState({ phase: 'registered', affiliate: data.affiliate, links: data.links, offers });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      // Release on both success and failure: success repaints to the registered
      // view (button gone), failure repaints to the error view whose retry path
      // re-runs loadMe → not_registered, so allowing another attempt is correct.
      setRegisterBusy(false);
      registerCalledRef.current = false;
    }
  }

  async function handleAddLink() {
    if (addBusy) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const link = await postAddLink(addLabel.trim() || null);
      setState((prev) => {
        if (prev.phase !== 'registered') return prev;
        return { ...prev, links: [...prev.links, link] };
      });
      setAddLabel('');
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddBusy(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="text-center text-gray-500 py-16">読み込み中...</div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="max-w-md mx-auto p-4">
        <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{state.message}</div>
        <button
          onClick={loadMe}
          className="mt-3 text-sm text-blue-600 underline"
        >
          再読み込み
        </button>
      </div>
    );
  }

  if (state.phase === 'not_registered') {
    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        <h1 className="text-lg font-bold">アフィリエイト</h1>
        <p className="text-sm text-gray-600">
          あなた専用の紹介リンクを発行して、友だち追加を紹介できます。
        </p>
        <button
          onClick={handleRegister}
          disabled={registerBusy}
          className="w-full bg-green-600 text-white py-3 rounded font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {registerBusy ? '登録中...' : 'アフィリエイターに登録する'}
        </button>
      </div>
    );
  }

  // registered
  const { links, offers } = state;
  const atLimit = links.length >= 20;

  function handleOfferEnrolled(newLink: AffiliateLinkData) {
    setState((prev) => {
      if (prev.phase !== 'registered') return prev;
      const updatedOffers = prev.offers.map((o) =>
        o.id === newLink.offerId
          ? { ...o, enrolled: true, refCode: newLink.refCode, url: newLink.url }
          : o,
      );
      return {
        ...prev,
        links: [...prev.links, newLink],
        offers: updatedOffers,
      };
    });
  }

  return (
    <div className="max-w-md mx-auto p-4 pb-12 space-y-4">
      <h1 className="text-lg font-bold">アフィリエイト</h1>

      {/* Offers section */}
      {offers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">案件</h2>
          {offers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              onEnrolled={handleOfferEnrolled}
            />
          ))}
        </section>
      )}

      {/* Link list */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">紹介リンク一覧</h2>
        {links.length === 0 ? (
          <div className="text-sm text-gray-500 py-4 text-center">リンクがまだありません</div>
        ) : (
          links.map((link) => <LinkRow key={link.refCode} link={link} />)
        )}
      </section>

      {/* Add link form */}
      <section className="border rounded p-3 space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">リンクを追加</h2>
        {atLimit ? (
          <div className="text-sm text-red-600">リンクの上限（20本）に達しています</div>
        ) : (
          <>
            <input
              type="text"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              placeholder="ラベル（任意）"
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              disabled={addBusy}
            />
            {addError && (
              <div className="text-xs text-red-600">{addError}</div>
            )}
            <button
              onClick={handleAddLink}
              disabled={addBusy}
              className="w-full bg-blue-600 text-white py-2 rounded text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {addBusy ? '追加中...' : 'リンクを追加する'}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

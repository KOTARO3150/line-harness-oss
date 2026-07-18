import { Link, useLocation } from 'react-router-dom';
import type { BookingRequestResult } from '../lib/api.js';

export default function Done({ result }: { result: BookingRequestResult | null }) {
  // initLiff() は ?liffId=... をクエリから読むので、内部遷移でも保持する。
  // search を維持しないと「予約履歴を見る」→ WebView 再読み込みで liffId が失われる。
  const { search } = useLocation();
  return (
    <div className="space-y-4 text-center pt-12">
      <h1 className="text-2xl font-bold">
        {result?.payment_status === 'pending' ? '予約受付・お支払い待ち' : 'リクエストを送信しました'}
      </h1>
      {result?.payment_status === 'pending' && result.paypal_payment_url ? (
        <div className="space-y-3">
          <p className="text-gray-600">初回相談はPayPalでのお支払い後に予約が確定します。</p>
          <a
            href={result.paypal_payment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded bg-blue-600 px-4 py-3 font-semibold text-white"
          >
            PayPalで支払う
          </a>
        </div>
      ) : (
        <p className="text-gray-600">
          お店からの返信をお待ちください。<br />確定すると LINE に通知が届きます。
        </p>
      )}
      <Link to={{ pathname: '/booking/history', search }} className="inline-block underline text-blue-600">
        予約履歴を見る
      </Link>
    </div>
  );
}

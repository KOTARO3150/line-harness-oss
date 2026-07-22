import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'

export const metadata: Metadata = {
  title: '鈴木薬舗OS',
  applicationName: '鈴木薬舗OS',
  description: '鈴木薬舗の相談カルテ・LINEお客様対応・予約管理',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/suzuki-yakupo-os.svg', type: 'image/svg+xml' },
      { url: '/icons/suzuki-yakupo-os-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/suzuki-yakupo-os-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/suzuki-yakupo-os-192.png', sizes: '192x192', type: 'image/png' }],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased" style={{ fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  )
}

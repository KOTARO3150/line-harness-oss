const LEGACY_SUZUKI_WORKER = 'https://suzuki-yakupo-os.kentao999.workers.dev'
const CORRECTED_SUZUKI_WORKER = 'https://suzuki-yakuho-os.kentao999.workers.dev'

/**
 * Customer-facing links use the corrected 鈴木薬舗 (yakuho) spelling while
 * the admin API can keep using the legacy origin during the staged migration.
 */
export function publicWorkerUrl(apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''): string {
  const normalized = apiUrl.replace(/\/$/, '')
  return normalized === LEGACY_SUZUKI_WORKER ? CORRECTED_SUZUKI_WORKER : normalized
}

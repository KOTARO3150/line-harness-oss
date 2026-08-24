import { describe, expect, it } from 'vitest'
import { publicWorkerUrl } from './public-worker-url'

describe('publicWorkerUrl', () => {
  it('uses the corrected yakuho host for the legacy Suzuki worker', () => {
    expect(publicWorkerUrl('https://suzuki-yakupo-os.kentao999.workers.dev')).toBe(
      'https://suzuki-yakuho-os.kentao999.workers.dev',
    )
  })

  it('leaves unrelated installations unchanged', () => {
    expect(publicWorkerUrl('https://example.workers.dev/')).toBe('https://example.workers.dev')
  })
})

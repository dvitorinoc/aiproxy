import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

mock.module('../../src/utils/path.mjs', {
  namedExports: {
    isBinaryAvailable: mock.fn(name => name === 'claude'),
    resolveExecCwd: mock.fn(() => undefined),
  },
})

mock.module('../../src/providers/index.mjs', {
  namedExports: {
    PROVIDER_BINARY: { claude: 'claude', gemini: 'gemini', codex: 'codex' },
  },
})

let service
before(async () => {
  const m = await import('../../src/services/providers.service.mjs')
  service = m.default
})

describe('providers.service.getAvailability', () => {
  it('returns availability map for all providers', () => {
    const result = service.getAvailability()
    assert.ok('claude' in result)
    assert.ok('gemini' in result)
    assert.ok('codex'  in result)
  })

  it('marks claude as available (mocked isBinaryAvailable returns true for claude)', () => {
    assert.equal(service.getAvailability().claude.available, true)
  })

  it('marks gemini as unavailable', () => {
    assert.equal(service.getAvailability().gemini.available, false)
  })
})

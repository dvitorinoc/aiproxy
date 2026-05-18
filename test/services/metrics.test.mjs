import { describe, it, mock, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'http'

let _port = 0
mock.module('../../config.mjs', {
  exports: { default: { get queue() { return { port: _port } } } },
})

mock.module('../../src/utils/errors.mjs', {
  exports: {
    QueueUnavailableError: class QueueUnavailableError extends Error {
      constructor() { super('queue unavailable'); this.name = 'QueueUnavailableError' }
    },
  },
})

const mockPayload = {
  period:      { from: 0, to: 9999999999999 },
  totals:      { jobs: 5, input_tokens: 1000, output_tokens: 500, total_tokens: 1500, cached_tokens: 0 },
  by_provider: { claude: { jobs: 5, input_tokens: 1000, output_tokens: 500, total_tokens: 1500, cached_tokens: 0 } },
}

let server, service
before(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(mockPayload))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  _port = server.address().port
  const m = await import('../../src/services/metrics.service.mjs')
  service = m.default
})

after(() => server?.close())

describe('metrics.service.getUsage', () => {
  it('returns aggregated usage from daemon', async () => {
    const result = await service.getUsage()
    assert.equal(result.totals.jobs, 5)
    assert.equal(result.totals.input_tokens, 1000)
    assert.ok('claude' in result.by_provider)
  })

  it('passes provider filter as query param', async () => {
    let receivedUrl
    server.removeAllListeners('request')
    server.on('request', (req, res) => {
      receivedUrl = req.url
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(mockPayload))
    })
    await service.getUsage({ provider: 'claude' })
    assert.ok(receivedUrl.includes('provider=claude'))
  })

  it('passes from/to as query params', async () => {
    let receivedUrl
    server.removeAllListeners('request')
    server.on('request', (req, res) => {
      receivedUrl = req.url
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(mockPayload))
    })
    await service.getUsage({ from: 1000, to: 9000 })
    assert.ok(receivedUrl.includes('from=1000'))
    assert.ok(receivedUrl.includes('to=9000'))
  })

  it('throws QueueUnavailableError when daemon is unreachable', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      const err = new TypeError('fetch failed')
      err.cause = new Error('connect ECONNREFUSED')
      err.cause.code = 'ECONNREFUSED'
      throw err
    }
    try {
      await assert.rejects(
        () => service.getUsage(),
        err => { assert.equal(err.name, 'QueueUnavailableError'); return true }
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

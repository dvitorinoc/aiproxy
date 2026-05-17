import { describe, it, mock, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'http'

// ─── Fake daemon server ───────────────────────────────────────────

let server, _port = 0
let requestHandler = (req, res) => { res.writeHead(404); res.end('{}') }
const setHandler = fn => { requestHandler = fn }

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// Config mock — getter reads _port lazily so value is set before client.mjs loads
mock.module('../../config.mjs', {
  exports: {
    default: {
      get queue() { return { port: _port, jobTimeoutMs: 300, pollMs: 10 } },
    },
  },
})

let submit
before(async () => {
  server = createServer((req, res) => requestHandler(req, res))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  _port = server.address().port
  const m = await import('../../src/queue/client.mjs')
  submit = m.submit
})

after(() => server?.close())

beforeEach(() => {
  setHandler((req, res) => { res.writeHead(404); res.end('{}') })
})

// ─── Tests ────────────────────────────────────────────────────────

describe('submit — success', () => {
  it('returns result when daemon responds completed on first poll', async () => {
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, { job_id: 'x' })
      if (req.method === 'GET')  return json(res, 200, { output: 'hello', usage: {} })
      json(res, 404, {})
    })
    const result = await submit({ provider: 'claude', content: 'x' })
    assert.equal(result.output, 'hello')
  })

  it('polls multiple times before result is ready', async () => {
    let polls = 0
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, { job_id: 'x' })
      polls++
      if (polls < 3) return json(res, 202, { status: 'running' })
      return json(res, 200, { output: 'done', usage: {} })
    })
    const result = await submit({ provider: 'claude', content: 'x' })
    assert.equal(result.output, 'done')
    assert.ok(polls >= 3)
  })
})

describe('submit — daemon unavailable', () => {
  it('throws QueueUnavailableError when fetch fails with ECONNREFUSED', async () => {
    // Mock global.fetch to simulate connection refused without closing real server
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      const err = new TypeError('fetch failed')
      err.cause = new Error('connect ECONNREFUSED')
      err.cause.code = 'ECONNREFUSED'
      throw err
    }
    try {
      await assert.rejects(
        () => submit({ provider: 'claude', content: 'x' }),
        err => { assert.equal(err.name, 'QueueUnavailableError'); return true }
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('submit — job error codes', () => {
  it('throws ProviderUnavailableError on provider_unavailable', async () => {
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, {})
      return json(res, 200, { error: { code: 'provider_unavailable', provider: 'claude' } })
    })
    await assert.rejects(
      () => submit({ provider: 'claude', content: 'x' }),
      err => {
        assert.equal(err.name, 'ProviderUnavailableError')
        assert.equal(err.provider, 'claude')
        return true
      }
    )
  })

  it('throws QueueFullError on queue_full', async () => {
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, {})
      return json(res, 200, { error: { code: 'queue_full' } })
    })
    await assert.rejects(
      () => submit({ provider: 'claude', content: 'x' }),
      err => { assert.equal(err.name, 'QueueFullError'); return true }
    )
  })

  it('throws Error with message on execution_error', async () => {
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, {})
      return json(res, 200, { error: { code: 'execution_error', message: 'boom' } })
    })
    await assert.rejects(
      () => submit({ provider: 'claude', content: 'x' }),
      err => { assert.equal(err.message, 'boom'); return true }
    )
  })

  it('throws QueueTimeoutError when polling never completes within jobTimeoutMs', async () => {
    // jobTimeoutMs=300, pollMs=10 — server always returns 202 so client times out after ~300ms
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, {})
      return json(res, 202, { status: 'running' })
    })
    await assert.rejects(
      () => submit({ provider: 'claude', content: 'x' }),
      err => { assert.equal(err.name, 'QueueTimeoutError'); return true }
    )
  })
})

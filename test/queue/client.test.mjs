import { describe, it, mock, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'http'

// ─── Setup fake daemon server ─────────────────────────────────────

let server
let serverPort = 0
let requestHandler = (req, res) => {
  res.writeHead(404)
  res.end(JSON.stringify({ error: 'not configured' }))
}

function setHandler(fn) { requestHandler = fn }

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// Config mock with getter — port is read lazily when client.mjs loads
let _port = 0
mock.module('../../config.mjs', {
  defaultExport: {
    get queue() { return { port: _port, jobTimeoutMs: 5_000, pollMs: 10 } },
  },
})

mock.module('../../src/utils/errors.mjs', {
  namedExports: {
    QueueUnavailableError: class QueueUnavailableError extends Error {
      constructor() { super('queue unavailable'); this.name = 'QueueUnavailableError' }
    },
    QueueFullError: class QueueFullError extends Error {
      constructor() { super('queue full'); this.name = 'QueueFullError' }
    },
    QueueTimeoutError: class QueueTimeoutError extends Error {
      constructor() { super('queue timeout'); this.name = 'QueueTimeoutError' }
    },
    ProviderUnavailableError: class ProviderUnavailableError extends Error {
      constructor(p) { super(`provider unavailable: ${p}`); this.name = 'ProviderUnavailableError'; this.provider = p }
    },
  },
})

let submit
before(async () => {
  server = createServer((req, res) => requestHandler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  _port = server.address().port
  const m = await import('../../src/queue/client.mjs')
  submit = m.submit
})

after(() => {
  server.close()
})

beforeEach(() => {
  setHandler((req, res) => {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not configured' }))
  })
})

// ─── Tests ────────────────────────────────────────────────────────

describe('submit — success', () => {
  it('returns result when daemon responds completed on first poll', async () => {
    setHandler((req, res) => {
      if (req.method === 'POST' && req.url === '/execute') {
        return json(res, 202, { job_id: 'x', status: 'pending' })
      }
      if (req.method === 'GET' && req.url.startsWith('/result/')) {
        return json(res, 200, { output: 'hello', usage: {} })
      }
      json(res, 404, {})
    })
    const result = await submit({ provider: 'claude', content: 'x' })
    assert.equal(result.output, 'hello')
  })

  it('polls multiple times before result is ready', async () => {
    let polls = 0
    setHandler((req, res) => {
      if (req.method === 'POST' && req.url === '/execute') {
        return json(res, 202, { job_id: 'x', status: 'pending' })
      }
      if (req.method === 'GET' && req.url.startsWith('/result/')) {
        polls++
        if (polls < 3) return json(res, 202, { status: 'running' })
        return json(res, 200, { output: 'done', usage: {} })
      }
      json(res, 404, {})
    })
    const result = await submit({ provider: 'claude', content: 'x' })
    assert.equal(result.output, 'done')
    assert.ok(polls >= 3)
  })
})

describe('submit — daemon errors', () => {
  it('throws QueueUnavailableError when POST fails with ECONNREFUSED', async () => {
    // Use a port with no server
    const fakePort = _port + 100
    // Override BASE by starting a separate client import... instead test via error code simulation
    // We test by stopping the server temporarily
    server.close()
    await assert.rejects(
      () => submit({ provider: 'claude', content: 'x' }),
      (err) => {
        assert.equal(err.name, 'QueueUnavailableError')
        return true
      }
    )
    // Restart server
    await new Promise(resolve => server.listen(_port, '127.0.0.1', resolve))
  })
})

describe('submit — job errors from daemon', () => {
  it('throws ProviderUnavailableError on provider_unavailable result', async () => {
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, { status: 'pending' })
      return json(res, 200, { error: { code: 'provider_unavailable', provider: 'claude' } })
    })
    await assert.rejects(
      () => submit({ provider: 'claude', content: 'x' }),
      (err) => {
        assert.equal(err.name, 'ProviderUnavailableError')
        assert.equal(err.provider, 'claude')
        return true
      }
    )
  })

  it('throws QueueFullError on queue_full result', async () => {
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, { status: 'pending' })
      return json(res, 200, { error: { code: 'queue_full' } })
    })
    await assert.rejects(
      () => submit({ provider: 'claude', content: 'x' }),
      err => { assert.equal(err.name, 'QueueFullError'); return true }
    )
  })

  it('throws generic Error on execution_error result', async () => {
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, { status: 'pending' })
      return json(res, 200, { error: { code: 'execution_error', message: 'boom' } })
    })
    await assert.rejects(
      () => submit({ provider: 'claude', content: 'x' }),
      err => { assert.equal(err.message, 'boom'); return true }
    )
  })

  it('throws QueueTimeoutError when jobTimeoutMs exceeded', async () => {
    // pollMs=10, jobTimeoutMs=5000 → would time out after 500 polls returning 202
    // Instead, mock returns 202 forever and we rely on jobTimeoutMs
    // To speed up: mock config with very short timeout
    mock.module('../../config.mjs', {
      defaultExport: {
        get queue() { return { port: _port, jobTimeoutMs: 50, pollMs: 10 } },
      },
    })
    setHandler((req, res) => {
      if (req.method === 'POST') return json(res, 202, { status: 'pending' })
      return json(res, 202, { status: 'running' }) // never completes
    })
    const { submit: submitFresh } = await import('../../src/queue/client.mjs?timeout')
    await assert.rejects(
      () => submitFresh({ provider: 'claude', content: 'x' }),
      err => { assert.equal(err.name, 'QueueTimeoutError'); return true }
    )
  })
})

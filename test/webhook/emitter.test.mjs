import { describe, it, mock, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'http'
import { createHmac } from 'crypto'

let _url = null
let _secret = null

mock.module('../../config.mjs', {
  exports: {
    default: {
      get webhook() { return { url: _url, secret: _secret } },
    },
  },
})

let emit, server, serverPort
const received = []

before(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(body) })
      res.writeHead(200); res.end()
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  serverPort = server.address().port
  _url = `http://127.0.0.1:${serverPort}`
  const m = await import('../../src/webhook/emitter.mjs')
  emit = m.emit
})

after(() => server?.close())

beforeEach(() => {
  received.length = 0
  _url = `http://127.0.0.1:${serverPort}`
  _secret = null
})

describe('emit', () => {
  it('does nothing when webhook.url is null', async () => {
    _url = null
    await emit('job.started', { job_id: 'x' })
    assert.equal(received.length, 0)
  })

  it('posts event payload to configured URL', async () => {
    await emit('job.completed', { job_id: 'abc', provider: 'claude', output: 'hello' })
    assert.equal(received.length, 1)
    assert.equal(received[0].body.event, 'job.completed')
    assert.equal(received[0].body.job_id, 'abc')
    assert.equal(received[0].body.output, 'hello')
    assert.ok(typeof received[0].body.timestamp === 'number')
  })

  it('sets Content-Type application/json', async () => {
    await emit('job.started', { job_id: 'x' })
    assert.equal(received[0].headers['content-type'], 'application/json')
  })

  it('includes X-Webhook-Signature when secret is configured', async () => {
    _secret = 'mysecret'
    await emit('job.failed', { job_id: 'y', error: { code: 'execution_error' } })
    const sig = received[0].headers['x-webhook-signature']
    assert.ok(sig?.startsWith('sha256='))
    // verify signature
    const body = JSON.stringify(received[0].body)
    const expected = 'sha256=' + createHmac('sha256', 'mysecret').update(body).digest('hex')
    assert.equal(sig, expected)
  })

  it('does not throw when server is unreachable', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('fetch failed') }
    try {
      await assert.doesNotReject(() => emit('job.started', { job_id: 'z' }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

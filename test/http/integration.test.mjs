import { describe, it, mock, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'http'
import { request }      from 'http'

// ─── Mocks ────────────────────────────────────────────────────────

const mockExecute = mock.fn(async () => ({
  output: 'test output',
  usage: { request_count: 1, source: 'provider', input_tokens: 1, output_tokens: 1, total_tokens: 2, cached_tokens: null, reasoning_tokens: null, raw: null },
}))

mock.module('../../src/services/run.service.mjs', {
  exports: { default: { execute: mockExecute } },
})

mock.module('../../src/services/providers.service.mjs', {
  exports: {
    default: {
      getAvailability: () => ({
        claude: { available: true },
        gemini: { available: false },
        codex:  { available: false },
      }),
    },
  },
})

// Providers mock — avoids loading the full provider chain (which needs full config)
mock.module('../../src/providers/index.mjs', {
  exports: {
    PROVIDERS:       { claude: {}, gemini: {}, codex: {} },
    SUGGESTED_MODELS: { claude: ['sonnet'], gemini: [''], codex: [''] },
    PROVIDER_BINARY:  { claude: 'claude', gemini: 'gemini', codex: 'codex' },
  },
})

mock.module('../../config.mjs', {
  exports: { default: { port: 0 } },
})

// ─── Server setup ─────────────────────────────────────────────────

let server, serverPort

before(async () => {
  const { createRouter } = await import('../../src/http/router.mjs')
  const setupRoutes      = (await import('../../src/http/routes.mjs')).default
  const cors             = (await import('../../src/http/middleware/cors.mjs')).default
  const errorHandler     = (await import('../../src/http/middleware/error-handler.mjs')).default

  const router = createRouter()
  router.use(cors)
  setupRoutes(router)
  router.use(errorHandler)

  server = createServer((req, res) => router.dispatch(req, res))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  serverPort = server.address().port
})

after(() => server?.close())

// ─── HTTP helper ──────────────────────────────────────────────────

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: serverPort, method, path,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }
    const r = request(opts, res => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d), headers: res.headers }))
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

// ─── Tests ────────────────────────────────────────────────────────

describe('POST /run', () => {
  it('returns 200 with output on valid request', async () => {
    mockExecute.mock.resetCalls()
    const { status, body } = await req('POST', '/run', { provider: 'claude', content: 'hello' })
    assert.equal(status, 200)
    assert.equal(body.output, 'test output')
    assert.equal(body.provider, 'claude')
  })

  it('returns 400 when content is missing', async () => {
    const { status, body } = await req('POST', '/run', { provider: 'claude' })
    assert.equal(status, 400)
    assert.ok(body.error.includes('content'))
  })

  it('returns 400 for unknown provider', async () => {
    const { status, body } = await req('POST', '/run', { provider: 'gpt4', content: 'hi' })
    assert.equal(status, 400)
    assert.ok(body.error.includes('gpt4'))
  })

  it('returns 400 for malformed JSON', async () => {
    const { status } = await new Promise((resolve, reject) => {
      const r = request(
        { hostname: '127.0.0.1', port: serverPort, method: 'POST', path: '/run',
          headers: { 'Content-Type': 'application/json' } },
        res => { let d = ''; res.on('data', c => { d += c }); res.on('end', () => resolve({ status: res.statusCode })) }
      )
      r.on('error', reject)
      r.write('not json')
      r.end()
    })
    assert.equal(status, 400)
  })

  it('returns 503 queue_unavailable on QueueUnavailableError', async () => {
    const { QueueUnavailableError } = await import('../../src/utils/errors.mjs')
    mockExecute.mock.mockImplementationOnce(async () => { throw new QueueUnavailableError() })
    const { status, body } = await req('POST', '/run', { provider: 'claude', content: 'hi' })
    assert.equal(status, 503)
    assert.equal(body.error, 'queue_unavailable')
  })

  it('returns 503 provider_unavailable on ProviderUnavailableError', async () => {
    const { ProviderUnavailableError } = await import('../../src/utils/errors.mjs')
    mockExecute.mock.mockImplementationOnce(async () => { throw new ProviderUnavailableError('claude') })
    const { status, body } = await req('POST', '/run', { provider: 'claude', content: 'hi' })
    assert.equal(status, 503)
    assert.equal(body.error, 'provider_unavailable')
    assert.equal(body.provider, 'claude')
  })
})

describe('GET /health', () => {
  it('returns 200 with ok, providers and suggested_models', async () => {
    const { status, body } = await req('GET', '/health', null)
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.ok(Array.isArray(body.providers))
    assert.ok('suggested_models' in body)
  })
})

describe('GET /providers', () => {
  it('returns availability map', async () => {
    const { status, body } = await req('GET', '/providers', null)
    assert.equal(status, 200)
    assert.equal(body.providers.claude.available, true)
    assert.equal(body.providers.gemini.available, false)
  })
})

describe('CORS', () => {
  it('OPTIONS returns 204', async () => {
    const { status } = await new Promise((resolve, reject) => {
      const r = request({ hostname: '127.0.0.1', port: serverPort, method: 'OPTIONS', path: '/run' },
        res => resolve({ status: res.statusCode }))
      r.on('error', reject)
      r.end()
    })
    assert.equal(status, 204)
  })

  it('responses include CORS header', async () => {
    const { headers } = await req('GET', '/health', null)
    assert.equal(headers['access-control-allow-origin'], '*')
  })
})

describe('404', () => {
  it('unknown route returns 404', async () => {
    const { status } = await req('GET', '/unknown', null)
    assert.equal(status, 404)
  })
})

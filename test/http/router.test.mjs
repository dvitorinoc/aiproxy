import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../../src/http/router.mjs'

function makeReq(method, url) {
  return { method, url }
}

function makeRes() {
  const res = {
    _status: null, _body: null, _headers: {},
    writeHead(s, h = {}) { this._status = s; Object.assign(this._headers, h) },
    end(b)    { this._body = b },
    write(b)  { this._body = (this._body ?? '') + b },
    setHeader(k, v) { this._headers[k] = v },
  }
  return res
}

describe('router', () => {
  it('dispatches GET to matching handler', async () => {
    const router = createRouter()
    router.get('/foo', (req, res) => { res.end('bar') })
    const res = makeRes()
    await new Promise(r => {
      router.dispatch(makeReq('GET', '/foo'), res)
      setImmediate(r)
    })
    assert.equal(res._body, 'bar')
  })

  it('dispatches POST to matching handler', async () => {
    const router = createRouter()
    router.post('/submit', (req, res) => { res.end('submitted') })
    const res = makeRes()
    router.dispatch(makeReq('POST', '/submit'), res)
    await new Promise(r => setImmediate(r))
    assert.equal(res._body, 'submitted')
  })

  it('returns 404 for unmatched route', async () => {
    const router = createRouter()
    const res = makeRes()
    router.dispatch(makeReq('GET', '/missing'), res)
    await new Promise(r => setImmediate(r))
    assert.equal(res._status, 404)
  })

  it('runs global use middleware before route handler', async () => {
    const router = createRouter()
    const order = []
    router.use((req, res, next) => { order.push('mw'); next() })
    router.get('/x', (req, res) => { order.push('handler'); res.end('ok') })
    router.dispatch(makeReq('GET', '/x'), makeRes())
    await new Promise(r => setImmediate(r))
    assert.deepEqual(order, ['mw', 'handler'])
  })

  it('error handler (4-param) is not called in happy path', async () => {
    const router = createRouter()
    let errHandlerCalled = false
    router.get('/ok', (req, res) => res.end('fine'))
    router.use((err, req, res, next) => { errHandlerCalled = true })
    router.dispatch(makeReq('GET', '/ok'), makeRes())
    await new Promise(r => setImmediate(r))
    assert.equal(errHandlerCalled, false)
  })

  it('error handler is called when handler calls next(err)', async () => {
    const router = createRouter()
    const theError = new Error('boom')
    router.get('/bad', (req, res, next) => { next(theError) })
    let caught = null
    router.use((err, req, res, next) => { caught = err; res.end('handled') })
    router.dispatch(makeReq('GET', '/bad'), makeRes())
    await new Promise(r => setImmediate(r))
    assert.equal(caught, theError)
  })

  it('async handler rejection is forwarded to error handler', async () => {
    const router = createRouter()
    router.get('/async-err', async () => { throw new Error('async boom') })
    let caught = null
    router.use((err, req, res, next) => { caught = err; res.end('handled') })
    router.dispatch(makeReq('GET', '/async-err'), makeRes())
    await new Promise(r => setTimeout(r, 10))
    assert.ok(caught?.message === 'async boom')
  })

  it('runs multiple handlers in a route in order', async () => {
    const router = createRouter()
    const order = []
    router.get('/chain',
      (req, res, next) => { order.push(1); next() },
      (req, res, next) => { order.push(2); next() },
      (req, res)       => { order.push(3); res.end('done') }
    )
    router.dispatch(makeReq('GET', '/chain'), makeRes())
    await new Promise(r => setImmediate(r))
    assert.deepEqual(order, [1, 2, 3])
  })

  it('normal handler is skipped when error propagates through it', async () => {
    const router = createRouter()
    const order = []
    router.get('/err-skip',
      (req, res, next) => { next(new Error('e')) },
      (req, res, next) => { order.push('skipped'); next() }
    )
    router.use((err, req, res, next) => { order.push('errHandler'); res.end('') })
    router.dispatch(makeReq('GET', '/err-skip'), makeRes())
    await new Promise(r => setImmediate(r))
    assert.deepEqual(order, ['errHandler'])
  })
})

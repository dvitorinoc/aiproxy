import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import cors from '../../../src/http/middleware/cors.mjs'

function makeRes() {
  const res = {
    _status: null, _headers: {}, _ended: false,
    writeHead(s, h = {}) { this._status = s; Object.assign(this._headers, h) },
    setHeader(k, v)      { this._headers[k] = v },
    end()                { this._ended = true },
  }
  return res
}

describe('cors middleware', () => {
  it('sets Access-Control-Allow-Origin on regular requests', () => {
    const req = { method: 'GET', url: '/health' }
    const res = makeRes()
    let nextCalled = false
    cors(req, res, () => { nextCalled = true })
    assert.equal(res._headers['Access-Control-Allow-Origin'], '*')
    assert.equal(nextCalled, true)
  })

  it('handles OPTIONS preflight — returns 204 without calling next', () => {
    const req = { method: 'OPTIONS', url: '/run' }
    const res = makeRes()
    let nextCalled = false
    cors(req, res, () => { nextCalled = true })
    assert.equal(res._status, 204)
    assert.equal(res._ended, true)
    assert.equal(nextCalled, false)
  })

  it('OPTIONS response includes Access-Control-Allow-Headers', () => {
    const req = { method: 'OPTIONS' }
    const res = makeRes()
    cors(req, res, () => {})
    assert.ok('Access-Control-Allow-Headers' in res._headers)
  })
})

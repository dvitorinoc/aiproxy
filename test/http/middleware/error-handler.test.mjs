import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import errorHandler from '../../../src/http/middleware/error-handler.mjs'
import {
  ValidationError, ProviderUnavailableError,
  QueueFullError, QueueTimeoutError, QueueUnavailableError,
} from '../../../src/utils/errors.mjs'

function makeRes() {
  const res = { _status: null, _body: null, _headers: {} }
  res.writeHead = (s, h = {}) => { res._status = s; Object.assign(res._headers, h) }
  res.end = (b) => { res._body = b }
  res.setHeader = (k, v) => { res._headers[k] = v }
  return res
}

function parsed(res) { return JSON.parse(res._body) }

describe('errorHandler', () => {
  it('maps ValidationError to 400', () => {
    const res = makeRes()
    errorHandler(new ValidationError('bad field'), {}, res, () => {})
    assert.equal(res._status, 400)
    assert.equal(parsed(res).error, 'bad field')
  })

  it('maps ProviderUnavailableError to 503 with provider', () => {
    const res = makeRes()
    errorHandler(new ProviderUnavailableError('gemini'), {}, res, () => {})
    assert.equal(res._status, 503)
    assert.equal(parsed(res).error, 'provider_unavailable')
    assert.equal(parsed(res).provider, 'gemini')
  })

  it('maps QueueFullError to 503', () => {
    const res = makeRes()
    errorHandler(new QueueFullError(), {}, res, () => {})
    assert.equal(res._status, 503)
    assert.equal(parsed(res).error, 'queue_full')
  })

  it('maps QueueTimeoutError to 503', () => {
    const res = makeRes()
    errorHandler(new QueueTimeoutError(), {}, res, () => {})
    assert.equal(res._status, 503)
    assert.equal(parsed(res).error, 'queue_timeout')
  })

  it('maps QueueUnavailableError to 503', () => {
    const res = makeRes()
    errorHandler(new QueueUnavailableError(), {}, res, () => {})
    assert.equal(res._status, 503)
    assert.equal(parsed(res).error, 'queue_unavailable')
  })

  it('maps errors with _status to that status', () => {
    const res = makeRes()
    const err = Object.assign(new Error('custom'), { _status: 422 })
    errorHandler(err, {}, res, () => {})
    assert.equal(res._status, 422)
  })

  it('maps unknown errors to 500', () => {
    const res = makeRes()
    errorHandler(new Error('unexpected'), {}, res, () => {})
    assert.equal(res._status, 500)
    assert.equal(parsed(res).error, 'unexpected')
  })
})

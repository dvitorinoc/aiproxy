import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'events'
import bodyParser from '../../../src/http/middleware/body-parser.mjs'

function makeReq(chunks = []) {
  const ee = new EventEmitter()
  setImmediate(() => {
    for (const c of chunks) ee.emit('data', c)
    ee.emit('end')
  })
  return ee
}

function makeRes() {
  return { _status: null, writeHead(s) { this._status = s }, end() {} }
}

describe('bodyParser middleware', () => {
  it('parses valid JSON body and calls next()', async () => {
    const req = makeReq(['{"provider":"claude","content":"hello"}'])
    let nextArg
    await new Promise(resolve => {
      bodyParser(req, makeRes(), (err) => { nextArg = err; resolve() })
    })
    assert.equal(nextArg, undefined)
    assert.deepEqual(req.body, { provider: 'claude', content: 'hello' })
  })

  it('handles body split across multiple chunks', async () => {
    const req = makeReq(['{"pro', 'vider":"', 'claude"}'])
    let parsed
    await new Promise(resolve => {
      bodyParser(req, makeRes(), () => { parsed = req.body; resolve() })
    })
    assert.deepEqual(parsed, { provider: 'claude' })
  })

  it('sets req.body to {} for empty body', async () => {
    const req = makeReq([])
    let body
    await new Promise(resolve => {
      bodyParser(req, makeRes(), () => { body = req.body; resolve() })
    })
    assert.deepEqual(body, {})
  })

  it('calls next(err) with _status 400 for invalid JSON', async () => {
    const req = makeReq(['not json'])
    let err
    await new Promise(resolve => {
      bodyParser(req, makeRes(), (e) => { err = e; resolve() })
    })
    assert.ok(err instanceof Error)
    assert.equal(err._status, 400)
    assert.equal(err.message, 'Invalid JSON body')
  })

  it('calls next(err) when req emits error', async () => {
    const req = new EventEmitter()
    const theError = new Error('stream error')
    setImmediate(() => req.emit('error', theError))
    let caught
    await new Promise(resolve => {
      bodyParser(req, makeRes(), (e) => { caught = e; resolve() })
    })
    assert.equal(caught, theError)
  })
})

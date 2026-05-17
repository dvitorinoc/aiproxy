import { describe, it, mock, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

mock.module('../../config.mjs', {
  exports: { default: { queue: { dbPath: ':memory:', cleanupAfterMs: 86_400_000 } } },
})

let store
before(async () => {
  store = await import('../../src/queue/store.mjs')
})

beforeEach(() => {
  store.initialize()
})

describe('enqueue + getJob', () => {
  it('inserts a pending job', () => {
    store.enqueue('id1', { provider: 'claude', content: 'hi' })
    const job = store.getJob('id1')
    assert.equal(job.id, 'id1')
    assert.equal(job.status, 'pending')
    assert.deepEqual(job.payload, { provider: 'claude', content: 'hi' })
    assert.equal(job.result, null)
  })

  it('INSERT OR IGNORE: does not duplicate on repeated enqueue', () => {
    store.enqueue('id1', { content: 'first' })
    store.enqueue('id1', { content: 'second' })
    assert.deepEqual(store.getJob('id1').payload, { content: 'first' })
  })

  it('returns null for unknown id', () => {
    assert.equal(store.getJob('unknown'), null)
  })
})

describe('markRunning', () => {
  it('sets status to running', () => {
    store.enqueue('id1', {})
    store.markRunning('id1')
    assert.equal(store.getJob('id1').status, 'running')
  })
})

describe('markCompleted', () => {
  it('sets status to completed and stores result', () => {
    store.enqueue('id1', {})
    store.markRunning('id1')
    store.markCompleted('id1', { output: 'done', usage: {} })
    const job = store.getJob('id1')
    assert.equal(job.status, 'completed')
    assert.deepEqual(job.result, { output: 'done', usage: {} })
  })
})

describe('markFailed', () => {
  it('sets status to failed and stores error', () => {
    store.enqueue('id1', {})
    store.markFailed('id1', { code: 'provider_unavailable', provider: 'claude' })
    const job = store.getJob('id1')
    assert.equal(job.status, 'failed')
    assert.deepEqual(job.result, { error: { code: 'provider_unavailable', provider: 'claude' } })
  })
})

describe('getPending', () => {
  it('returns only pending jobs in FIFO order', () => {
    store.enqueue('id1', { n: 1 })
    store.enqueue('id2', { n: 2 })
    store.enqueue('id3', { n: 3 })
    store.markRunning('id2')
    const pending = store.getPending()
    assert.equal(pending.length, 2)
    assert.equal(pending[0].id, 'id1')
    assert.equal(pending[1].id, 'id3')
  })

  it('returns empty array when no pending jobs', () => {
    assert.deepEqual(store.getPending(), [])
  })
})

describe('cleanup', () => {
  it('does not delete recent completed jobs (within cleanupAfterMs)', () => {
    store.enqueue('id1', {})
    store.markCompleted('id1', { output: 'ok' })
    store.cleanup()
    assert.ok(store.getJob('id1') !== null)
  })

  it('does not delete pending jobs', () => {
    store.enqueue('id1', {})
    store.cleanup()
    assert.ok(store.getJob('id1') !== null)
  })
})

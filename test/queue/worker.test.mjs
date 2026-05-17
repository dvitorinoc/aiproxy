import { describe, it, mock, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ─── Mocks (top-level, before any import of worker) ───────────────

const mockStore = {
  initialize:    mock.fn(),
  cleanup:       mock.fn(),
  getPending:    mock.fn(() => []),
  markRunning:   mock.fn(),
  markCompleted: mock.fn(),
  markFailed:    mock.fn(),
}
mock.module('../../src/queue/store.mjs', { exports: mockStore })

// Mutable reference — tests reassign this to change provider behaviour
let claudeCallImpl = mock.fn(async () => ({ output: 'ok', usage: {} }))

mock.module('../../src/providers/index.mjs', {
  exports: {
    PROVIDERS: {
      claude: { call: (...args) => claudeCallImpl(...args) },
    },
  },
})

mock.module('../../src/mcp/client.mjs', {
  exports: { loadMcpServers: mock.fn(async () => {}) },
})

mock.module('../../config.mjs', {
  exports: { default: { queue: { maxConcurrent: 2, maxQueueSize: 3 } } },
})

let worker
before(async () => {
  worker = await import('../../src/queue/worker.mjs')
})

beforeEach(() => {
  claudeCallImpl = mock.fn(async () => ({ output: 'ok', usage: {} }))
  mockStore.markRunning.mock.resetCalls()
  mockStore.markCompleted.mock.resetCalls()
  mockStore.markFailed.mock.resetCalls()
})

describe('scheduleJob — happy path', () => {
  it('marks running then completed on success', async () => {
    await worker.scheduleJob('id1', { provider: 'claude', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    assert.equal(mockStore.markRunning.mock.calls.length, 1)
    assert.equal(mockStore.markRunning.mock.calls[0].arguments[0], 'id1')
    assert.equal(mockStore.markCompleted.mock.calls.length, 1)
    assert.equal(mockStore.markFailed.mock.calls.length, 0)
  })
})

describe('scheduleJob — provider errors', () => {
  it('marks failed with provider_unavailable on ENOENT', async () => {
    const err = new Error('spawn claude ENOENT')
    err.code = 'ENOENT'
    claudeCallImpl = mock.fn(async () => { throw err })
    await worker.scheduleJob('id2', { provider: 'claude', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    assert.equal(mockStore.markFailed.mock.calls.length, 1)
    assert.equal(mockStore.markFailed.mock.calls[0].arguments[0], 'id2')
    assert.equal(mockStore.markFailed.mock.calls[0].arguments[1].code, 'provider_unavailable')
  })

  it('marks failed with provider_unavailable on exit 127', async () => {
    claudeCallImpl = mock.fn(async () => { throw new Error('Command failed (exit 127): sh: claude: not found') })
    await worker.scheduleJob('id3', { provider: 'claude', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    assert.equal(mockStore.markFailed.mock.calls[0].arguments[1].code, 'provider_unavailable')
  })

  it('marks failed with execution_error on generic error', async () => {
    claudeCallImpl = mock.fn(async () => { throw new Error('boom') })
    await worker.scheduleJob('id4', { provider: 'claude', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    assert.equal(mockStore.markFailed.mock.calls[0].arguments[1].code, 'execution_error')
    assert.equal(mockStore.markFailed.mock.calls[0].arguments[1].message, 'boom')
  })

  it('marks failed for unknown provider', async () => {
    await worker.scheduleJob('id5', { provider: 'unknown', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    assert.equal(mockStore.markFailed.mock.calls.length, 1)
    assert.equal(mockStore.markFailed.mock.calls[0].arguments[1].code, 'execution_error')
  })
})

describe('init', () => {
  it('calls initialize, cleanup and schedules pending jobs', async () => {
    mockStore.initialize.mock.resetCalls()
    mockStore.cleanup.mock.resetCalls()
    mockStore.getPending.mock.mockImplementation(() => [
      { id: 'p1', payload: { provider: 'claude', content: 'x' } }
    ])
    await worker.init()
    assert.equal(mockStore.initialize.mock.calls.length, 1)
    assert.equal(mockStore.cleanup.mock.calls.length, 1)
  })
})

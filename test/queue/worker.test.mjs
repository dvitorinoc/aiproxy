import { describe, it, mock, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const mockStore = {
  initialize:    mock.fn(),
  cleanup:       mock.fn(),
  getPending:    mock.fn(() => []),
  markRunning:   mock.fn(),
  markCompleted: mock.fn(),
  markFailed:    mock.fn(),
}
mock.module('../../src/queue/store.mjs', { exports: mockStore })

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

const mockEmit = mock.fn(async () => {})
mock.module('../../src/webhook/emitter.mjs', {
  exports: { emit: mockEmit },
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
  mockEmit.mock.resetCalls()
})

describe('scheduleJob — happy path', () => {
  it('marks running then completed and emits job.started + job.completed', async () => {
    await worker.scheduleJob('id1', { provider: 'claude', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    assert.equal(mockStore.markRunning.mock.calls.length, 1)
    assert.equal(mockStore.markCompleted.mock.calls.length, 1)
    assert.equal(mockStore.markFailed.mock.calls.length, 0)

    const events = mockEmit.mock.calls.map(c => c.arguments[0])
    assert.ok(events.includes('job.started'))
    assert.ok(events.includes('job.completed'))
  })

  it('job.completed payload includes output and usage', async () => {
    claudeCallImpl = mock.fn(async () => ({ output: 'result text', usage: { input_tokens: 5 } }))
    await worker.scheduleJob('id2', { provider: 'claude', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    const completedCall = mockEmit.mock.calls.find(c => c.arguments[0] === 'job.completed')
    assert.ok(completedCall)
    assert.equal(completedCall.arguments[1].output, 'result text')
  })
})

describe('scheduleJob — provider errors', () => {
  it('marks failed with provider_unavailable on ENOENT and emits job.failed', async () => {
    const err = new Error('spawn claude ENOENT'); err.code = 'ENOENT'
    claudeCallImpl = mock.fn(async () => { throw err })
    await worker.scheduleJob('id3', { provider: 'claude', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    assert.equal(mockStore.markFailed.mock.calls[0].arguments[1].code, 'provider_unavailable')
    const failedCall = mockEmit.mock.calls.find(c => c.arguments[0] === 'job.failed')
    assert.ok(failedCall)
    assert.equal(failedCall.arguments[1].error.code, 'provider_unavailable')
  })

  it('marks failed with execution_error on generic error', async () => {
    claudeCallImpl = mock.fn(async () => { throw new Error('boom') })
    await worker.scheduleJob('id4', { provider: 'claude', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
    assert.equal(mockStore.markFailed.mock.calls[0].arguments[1].code, 'execution_error')
  })

  it('marks failed for unknown provider', async () => {
    await worker.scheduleJob('id5', { provider: 'unknown', system_prompt: '', messages: [], content: 'x', use_mcp: false, cwd: null })
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

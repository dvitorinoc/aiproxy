import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

const mockRunMcpLoop = mock.fn(async (rawCall) => {
  const result = await rawCall('sys', [], 'content', null, null)
  return { output: `mcp:${result.output}`, usage: result.usage }
})

mock.module('../../src/mcp/loop.mjs', {
  exports: { runMcpLoop: mockRunMcpLoop },
})

const claudeRaw = mock.fn(async () => ({ output: 'claude-output', usage: {} }))
const geminiRaw = mock.fn(async () => ({ output: 'gemini-output', usage: {} }))
const codexRaw  = mock.fn(async () => ({ output: 'codex-output',  usage: {} }))

mock.module('../../src/providers/claude.mjs', { exports: { default: claudeRaw } })
mock.module('../../src/providers/gemini.mjs', { exports: { default: geminiRaw } })
mock.module('../../src/providers/codex.mjs',  { exports: { default: codexRaw  } })

let PROVIDERS, SUGGESTED_MODELS, PROVIDER_BINARY
before(async () => {
  const m       = await import('../../src/providers/index.mjs')
  PROVIDERS      = m.PROVIDERS
  SUGGESTED_MODELS = m.SUGGESTED_MODELS
  PROVIDER_BINARY  = m.PROVIDER_BINARY
})

describe('PROVIDERS', () => {
  it('exposes claude, gemini, codex', () => {
    assert.ok('claude' in PROVIDERS)
    assert.ok('gemini' in PROVIDERS)
    assert.ok('codex'  in PROVIDERS)
  })

  it('each provider has raw and call', () => {
    for (const p of Object.values(PROVIDERS)) {
      assert.equal(typeof p.raw,  'function')
      assert.equal(typeof p.call, 'function')
    }
  })
})

describe('wrapProvider — call without MCP', () => {
  it('delegates directly to raw', async () => {
    claudeRaw.mock.resetCalls()
    await PROVIDERS.claude.call('sys', [], 'content', 'model', false, '/cwd')
    assert.equal(claudeRaw.mock.calls.length, 1)
    assert.deepEqual(claudeRaw.mock.calls[0].arguments, ['sys', [], 'content', 'model', '/cwd'])
  })
})

describe('wrapProvider — call with MCP', () => {
  it('delegates to runMcpLoop when useMcp=true', async () => {
    mockRunMcpLoop.mock.resetCalls()
    const result = await PROVIDERS.claude.call('sys', [], 'content', null, true, null)
    assert.equal(mockRunMcpLoop.mock.calls.length, 1)
    assert.ok(result.output.startsWith('mcp:'))
  })
})

describe('SUGGESTED_MODELS', () => {
  it('has arrays for all providers', () => {
    assert.ok(Array.isArray(SUGGESTED_MODELS.claude))
    assert.ok(Array.isArray(SUGGESTED_MODELS.gemini))
    assert.ok(Array.isArray(SUGGESTED_MODELS.codex))
  })
})

describe('PROVIDER_BINARY', () => {
  it('maps provider names to binary names', () => {
    assert.equal(PROVIDER_BINARY.claude, 'claude')
    assert.equal(PROVIDER_BINARY.gemini, 'gemini')
    assert.equal(PROVIDER_BINARY.codex,  'codex')
  })
})

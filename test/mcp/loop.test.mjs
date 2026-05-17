import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

const mockCallTool       = mock.fn(async () => ({ result: 'tool result' }))
const mockBuildToolPrompt = mock.fn(() => 'TOOL DEFINITIONS')

mock.module('../../src/mcp/client.mjs', {
  exports: { callTool: mockCallTool, buildToolPrompt: mockBuildToolPrompt },
})

mock.module('../../config.mjs', {
  exports: { default: { mcp: { maxIterations: 3 } } },
})

let parseToolCalls, runMcpLoop
before(async () => {
  const m    = await import('../../src/mcp/loop.mjs')
  parseToolCalls = m.parseToolCalls
  runMcpLoop     = m.runMcpLoop
})

// ─── parseToolCalls ───────────────────────────────────────────────
describe('parseToolCalls', () => {
  it('returns empty array when no tags', () => {
    assert.deepEqual(parseToolCalls('plain response'), [])
  })

  it('extracts single tool call', () => {
    const calls = parseToolCalls('<tool_call><name>get_task</name><args>{"task_id":1}</args></tool_call>')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'get_task')
    assert.deepEqual(calls[0].args, { task_id: 1 })
  })

  it('extracts multiple tool calls', () => {
    const text = '<tool_call><name>a</name><args>{"x":1}</args></tool_call>\n<tool_call><name>b</name><args>{"y":2}</args></tool_call>'
    const calls = parseToolCalls(text)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].name, 'a')
    assert.equal(calls[1].name, 'b')
  })

  it('silently ignores tool calls with invalid JSON args', () => {
    assert.deepEqual(parseToolCalls('<tool_call><name>bad</name><args>not json</args></tool_call>'), [])
  })

  it('tolerates whitespace between tags', () => {
    const text = `<tool_call>\n  <name>my_tool</name>\n  <args>{"a": 1}</args>\n</tool_call>`
    const calls = parseToolCalls(text)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'my_tool')
  })
})

// ─── runMcpLoop ───────────────────────────────────────────────────
describe('runMcpLoop', () => {
  it('returns immediately when no tool calls in first response', async () => {
    const rawCall = mock.fn(async () => ({ output: 'final answer', usage: { request_count: 1 } }))
    const result  = await runMcpLoop(rawCall, 'system', [], 'prompt', null, null)
    assert.equal(result.output, 'final answer')
    assert.equal(rawCall.mock.calls.length, 1)
  })

  it('injects tool prompt into system prompt', async () => {
    const rawCall = mock.fn(async () => ({ output: 'done', usage: { request_count: 1 } }))
    await runMcpLoop(rawCall, 'my system', [], 'prompt', null, null)
    const sysArg = rawCall.mock.calls[0].arguments[0]
    assert.ok(sysArg.includes('my system'))
    assert.ok(sysArg.includes('TOOL DEFINITIONS'))
  })

  it('calls callTool and continues loop on tool call', async () => {
    let n = 0
    const rawCall = mock.fn(async () => {
      n++
      if (n === 1) return { output: '<tool_call><name>get_task</name><args>{"task_id":1}</args></tool_call>', usage: { request_count: 1 } }
      return { output: 'all done', usage: { request_count: 1 } }
    })
    mockCallTool.mock.resetCalls()
    const result = await runMcpLoop(rawCall, '', [], 'prompt', null, null)
    assert.equal(mockCallTool.mock.calls.length, 1)
    assert.equal(result.output, 'all done')
  })

  it('history grows between iterations', async () => {
    let iter = 0
    const rawCall = mock.fn(async (sys, msgs) => {
      iter++
      if (iter === 1) return { output: '<tool_call><name>list_agents</name><args>{}</args></tool_call>', usage: { request_count: 1 } }
      assert.ok(msgs.length >= 2)
      return { output: 'finished', usage: { request_count: 1 } }
    })
    mockCallTool.mock.mockImplementation(async () => ({ agents: [] }))
    await runMcpLoop(rawCall, '', [], 'start', null, null)
    assert.equal(iter, 2)
  })

  it('returns limit message after MAX_ITER iterations', async () => {
    const rawCall = mock.fn(async () => ({
      output: '<tool_call><name>t</name><args>{}</args></tool_call>',
      usage: { request_count: 1 },
    }))
    mockCallTool.mock.mockImplementation(async () => ({}))
    const result = await runMcpLoop(rawCall, '', [], 'p', null, null)
    assert.ok(result.output.includes('[MCP]'))
    assert.equal(rawCall.mock.calls.length, 3)
  })

  it('accumulates usage across iterations', async () => {
    let n = 0
    const usage = { request_count: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15, source: 'provider', cached_tokens: null, reasoning_tokens: null, raw: null }
    const rawCall = mock.fn(async () => {
      n++
      if (n < 3) return { output: '<tool_call><name>t</name><args>{}</args></tool_call>', usage }
      return { output: 'done', usage }
    })
    mockCallTool.mock.mockImplementation(async () => ({}))
    const result = await runMcpLoop(rawCall, '', [], 'p', null, null)
    assert.equal(result.usage.request_count, 3)
  })
})

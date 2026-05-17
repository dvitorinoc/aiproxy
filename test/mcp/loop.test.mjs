import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

const mockCallTool      = mock.fn(async () => ({ result: 'tool result' }))
const mockBuildToolPrompt = mock.fn(() => 'TOOL DEFINITIONS')

mock.module('../../src/mcp/client.mjs', {
  namedExports: {
    callTool:       mockCallTool,
    buildToolPrompt: mockBuildToolPrompt,
  },
})

mock.module('../../config.mjs', {
  defaultExport: { mcp: { maxIterations: 3 } },
})

let parseToolCalls, runMcpLoop
before(async () => {
  const m = await import('../../src/mcp/loop.mjs')
  parseToolCalls = m.parseToolCalls
  runMcpLoop     = m.runMcpLoop
})

// ─── parseToolCalls ───────────────────────────────────────────────
describe('parseToolCalls', () => {
  it('returns empty array when no tags', () => {
    assert.deepEqual(parseToolCalls('plain response'), [])
  })

  it('extracts single tool call', () => {
    const text = `<tool_call><name>get_task</name><args>{"task_id":1}</args></tool_call>`
    const calls = parseToolCalls(text)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'get_task')
    assert.deepEqual(calls[0].args, { task_id: 1 })
  })

  it('extracts multiple tool calls', () => {
    const text = [
      `<tool_call><name>tool_a</name><args>{"x":1}</args></tool_call>`,
      `<tool_call><name>tool_b</name><args>{"y":2}</args></tool_call>`,
    ].join('\n')
    const calls = parseToolCalls(text)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].name, 'tool_a')
    assert.equal(calls[1].name, 'tool_b')
  })

  it('silently ignores tool calls with invalid JSON args', () => {
    const text = `<tool_call><name>bad_tool</name><args>not json</args></tool_call>`
    assert.deepEqual(parseToolCalls(text), [])
  })

  it('tolerates whitespace between tags', () => {
    const text = `<tool_call>
  <name>my_tool</name>
  <args>{"a": 1}</args>
</tool_call>`
    const calls = parseToolCalls(text)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'my_tool')
  })
})

// ─── runMcpLoop ───────────────────────────────────────────────────
describe('runMcpLoop', () => {
  it('returns immediately when no tool calls in response', async () => {
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

  it('calls callTool and continues loop when tool calls present', async () => {
    let callCount = 0
    const rawCall = mock.fn(async () => {
      callCount++
      if (callCount === 1) {
        return {
          output: '<tool_call><name>get_task</name><args>{"task_id":1}</args></tool_call>',
          usage: { request_count: 1 }
        }
      }
      return { output: 'all done', usage: { request_count: 1 } }
    })
    mockCallTool.mock.resetCalls()
    const result = await runMcpLoop(rawCall, '', [], 'prompt', null, null)
    assert.equal(mockCallTool.mock.calls.length, 1)
    assert.equal(result.output, 'all done')
  })

  it('includes tool result in next iteration messages', async () => {
    let iteration = 0
    const rawCall = mock.fn(async (sys, msgs) => {
      iteration++
      if (iteration === 1) {
        return {
          output: '<tool_call><name>list_agents</name><args>{}</args></tool_call>',
          usage: { request_count: 1 }
        }
      }
      // Second call should have tool results in loopContent
      assert.ok(msgs.length >= 2) // history grew
      return { output: 'finished', usage: { request_count: 1 } }
    })
    mockCallTool.mock.resetCalls()
    mockCallTool.mock.mockImplementation(async () => ({ agents: [] }))
    await runMcpLoop(rawCall, '', [], 'start', null, null)
    assert.equal(iteration, 2)
  })

  it('returns limit message after MAX_ITER iterations of tool calls', async () => {
    const rawCall = mock.fn(async () => ({
      output: '<tool_call><name>any_tool</name><args>{}</args></tool_call>',
      usage: { request_count: 1 }
    }))
    mockCallTool.mock.mockImplementation(async () => ({}))
    const result = await runMcpLoop(rawCall, '', [], 'prompt', null, null)
    assert.ok(result.output.includes('[MCP]'))
    assert.equal(rawCall.mock.calls.length, 3) // maxIterations = 3
  })

  it('accumulates usage across iterations', async () => {
    let callCount = 0
    const rawCall = mock.fn(async () => {
      callCount++
      if (callCount < 3) {
        return {
          output: '<tool_call><name>t</name><args>{}</args></tool_call>',
          usage: { request_count: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15, source: 'provider', cached_tokens: null, reasoning_tokens: null, raw: null }
        }
      }
      return {
        output: 'done',
        usage: { request_count: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15, source: 'provider', cached_tokens: null, reasoning_tokens: null, raw: null }
      }
    })
    mockCallTool.mock.mockImplementation(async () => ({}))
    const result = await runMcpLoop(rawCall, '', [], 'p', null, null)
    assert.equal(result.usage.request_count, 3)
  })
})

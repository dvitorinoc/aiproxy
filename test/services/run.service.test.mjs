import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

// ─── Config mutável — permite trocar limites entre testes ─────────────────────

const configState = { context: { maxChars: 0, maxMessages: 0 } }

mock.module('../../config.mjs', {
  exports: { default: configState },
})

// ─── Submit mock com flag de erro ─────────────────────────────────────────────

let shouldThrow = false
const submittedParams = []

const mockSubmit = mock.fn(async (params) => {
  submittedParams.push(structuredClone(params))
  if (shouldThrow) throw new Error('provider down')
  return { output: 'ok', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }
})

mock.module('../../src/queue/client.mjs', {
  exports: { submit: mockSubmit },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pairs(n) {
  const msgs = []
  for (let i = 1; i <= n; i++) {
    msgs.push({ role: 'user',      content: `user-${i}` })
    msgs.push({ role: 'assistant', content: `assistant-${i}` })
  }
  return msgs
}

function baseParams(overrides = {}) {
  return { provider: 'claude', model: null, system_prompt: '', messages: [], content: 'q', use_mcp: false, cwd: null, ...overrides }
}

let runService

before(async () => {
  runService = (await import('../../src/services/run.service.mjs')).default
})

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('run.service — integração com truncateMessages', () => {
  it('I01: sem config de truncagem — submit recebe messages intacto', async () => {
    submittedParams.length = 0
    configState.context = { maxChars: 0, maxMessages: 0 }

    await runService.execute(baseParams({ messages: pairs(6) }))

    assert.equal(submittedParams[0].messages.length, 12)
  })

  it('I02: maxMessages=2 ativo — submit recebe 2 pares (4 mensagens)', async () => {
    submittedParams.length = 0
    configState.context = { maxChars: 0, maxMessages: 2 }

    await runService.execute(baseParams({ messages: pairs(5) }))

    assert.equal(submittedParams[0].messages.length, 4)
    assert.equal(submittedParams[0].messages[0].content, 'user-4')
  })

  it('I03: maxChars ativo — submit recebe messages reduzido', async () => {
    submittedParams.length = 0
    configState.context = { maxChars: 30, maxMessages: 0 }

    await runService.execute(baseParams({ messages: pairs(5) }))

    assert.ok(submittedParams[0].messages.length < 10)
    assert.ok(submittedParams[0].messages.length % 2 === 0)
  })

  it('I04: truncagem não altera provider, content, cwd', async () => {
    submittedParams.length = 0
    configState.context = { maxChars: 10, maxMessages: 0 }

    await runService.execute(baseParams({
      provider: 'gemini',
      model: 'gemini-pro',
      content: 'original content',
      cwd: '/tmp',
      messages: pairs(5),
    }))

    const p = submittedParams[0]
    assert.equal(p.provider, 'gemini')
    assert.equal(p.model, 'gemini-pro')
    assert.equal(p.content, 'original content')
    assert.equal(p.cwd, '/tmp')
  })

  it('I05: submit lança erro — erro propaga sem alteração', async () => {
    configState.context = { maxChars: 0, maxMessages: 0 }
    shouldThrow = true
    try {
      await assert.rejects(
        () => runService.execute(baseParams()),
        /provider down/,
      )
    } finally {
      shouldThrow = false
    }
  })

  it('I06: sem histórico — submit chamado com messages vazio', async () => {
    submittedParams.length = 0
    configState.context = { maxChars: 0, maxMessages: 0 }

    await runService.execute(baseParams({ messages: [] }))

    assert.deepEqual(submittedParams[0].messages, [])
  })
})

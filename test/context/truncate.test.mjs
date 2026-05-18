import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { truncateMessages } from '../../src/context/truncate.mjs'

function makeParams(messages, overrides = {}) {
  return {
    provider: 'claude',
    model: null,
    system_prompt: overrides.system_prompt ?? '',
    messages: [...messages],
    content: overrides.content ?? 'hello',
    use_mcp: false,
    cwd: null,
  }
}

function cfg(maxChars = 0, maxMessages = 0) {
  return { context: { maxChars, maxMessages } }
}

function pair(i) {
  return [
    { role: 'user',      content: `user-${i}` },
    { role: 'assistant', content: `assistant-${i}` },
  ]
}

function pairs(n) {
  const msgs = []
  for (let i = 1; i <= n; i++) msgs.push(...pair(i))
  return msgs
}

// ─── Desabilitado ─────────────────────────────────────────────────────────────

describe('truncateMessages — desabilitado', () => {
  it('U01: maxChars=0 maxMessages=0 sem histórico — não toca messages', () => {
    const p = makeParams([])
    truncateMessages(p, cfg(0, 0))
    assert.deepEqual(p.messages, [])
  })

  it('U02: maxChars=0 maxMessages=0 com histórico longo — não toca messages', () => {
    const msgs = pairs(10)
    const p = makeParams(msgs)
    truncateMessages(p, cfg(0, 0))
    assert.equal(p.messages.length, 20)
  })

  it('U03: messages vazio com qualquer config — não lança erro', () => {
    const p = makeParams([])
    truncateMessages(p, cfg(9999, 9999))
    assert.deepEqual(p.messages, [])
  })
})

// ─── Limite por pares (maxMessages) ───────────────────────────────────────────

describe('truncateMessages — maxMessages', () => {
  it('U04: 3 pares maxMessages=3 — no limite, nenhum removido', () => {
    const p = makeParams(pairs(3))
    truncateMessages(p, cfg(0, 3))
    assert.equal(p.messages.length, 6)
  })

  it('U05: 5 pares maxMessages=3 — mantém os 3 pares mais recentes', () => {
    const p = makeParams(pairs(5))
    truncateMessages(p, cfg(0, 3))
    assert.equal(p.messages.length, 6)
    assert.equal(p.messages[0].content, 'user-3')
    assert.equal(p.messages[5].content, 'assistant-5')
  })

  it('U06: 1 par maxMessages=3 — abaixo do limite, inalterado', () => {
    const p = makeParams(pairs(1))
    truncateMessages(p, cfg(0, 3))
    assert.equal(p.messages.length, 2)
  })

  it('U07: 10 pares maxMessages=1 — mantém apenas o último par', () => {
    const p = makeParams(pairs(10))
    truncateMessages(p, cfg(0, 1))
    assert.equal(p.messages.length, 2)
    assert.equal(p.messages[0].content, 'user-10')
    assert.equal(p.messages[1].content, 'assistant-10')
  })

  it('U08: após truncagem por pares, primeiro item é role user', () => {
    const p = makeParams(pairs(8))
    truncateMessages(p, cfg(0, 3))
    assert.equal(p.messages[0].role, 'user')
  })
})

// ─── Limite por caracteres (maxChars) ─────────────────────────────────────────

describe('truncateMessages — maxChars', () => {
  it('U09: total < maxChars — messages inalterado', () => {
    const p = makeParams(pairs(2), { content: 'hi', system_prompt: '' })
    const before = p.messages.length
    truncateMessages(p, cfg(100_000, 0))
    assert.equal(p.messages.length, before)
  })

  it('U10: total === maxChars exato — messages inalterado (limite inclusivo)', () => {
    const msgs = [
      { role: 'user',      content: 'aa' },
      { role: 'assistant', content: 'bb' },
    ]
    // total = system(0) + content(2) + 'aa'(2) + 'bb'(2) = 6
    const p = makeParams(msgs, { content: 'hi', system_prompt: '' })
    truncateMessages(p, cfg(6, 0))
    assert.equal(p.messages.length, 2)
  })

  it('U11: total > maxChars, remover 1 par resolve — remove só o par mais antigo', () => {
    const msgs = [
      { role: 'user',      content: 'AAAA' },
      { role: 'assistant', content: 'BBBB' },
      { role: 'user',      content: 'CC' },
      { role: 'assistant', content: 'DD' },
    ]
    // total sem contar content = 0+4+4+2+2 = 12; content='hi'=2 → 14
    // maxChars=6 → remove primeiro par (8 chars), restam 6 → ok
    const p = makeParams(msgs, { content: 'hi', system_prompt: '' })
    truncateMessages(p, cfg(6, 0))
    assert.equal(p.messages.length, 2)
    assert.equal(p.messages[0].content, 'CC')
  })

  it('U12: total > maxChars, precisa remover múltiplos pares', () => {
    const p = makeParams(pairs(5), { content: 'q', system_prompt: '' })
    // cada par: 'user-N'(6) + 'assistant-N'(11) = 17 chars × 5 = 85 + 'q'(1) = 86
    // maxChars=20 → precisa remover até sobrar só o que couber
    truncateMessages(p, cfg(20, 0))
    assert.ok(p.messages.length < 10)
    assert.ok(p.messages.length % 2 === 0)
  })

  it('U13: messages.length < 2 ao entrar no loop — não executa, sem crash', () => {
    const p = makeParams([], { content: 'x'.repeat(1000), system_prompt: '' })
    assert.doesNotThrow(() => truncateMessages(p, cfg(1, 0)))
    assert.equal(p.messages.length, 0)
  })

  it('U14: todos os pares removidos — messages vazio, sem erro', () => {
    const p = makeParams(pairs(3), { content: 'a', system_prompt: '' })
    truncateMessages(p, cfg(1, 0))
    assert.equal(p.messages.length, 0)
  })
})

// ─── Interação entre os dois limites ──────────────────────────────────────────

describe('truncateMessages — maxMessages + maxChars combinados', () => {
  it('U15: maxMessages remove para 3 pares, maxChars remove mais 1', () => {
    // 5 pares; maxMessages=3 → 3 pares; content grande → maxChars remove mais
    const p = makeParams(pairs(5), { content: 'x'.repeat(200), system_prompt: '' })
    // cada par ~17 chars; 3 pares = 51 + 200 = 251 > maxChars=100
    truncateMessages(p, cfg(100, 3))
    assert.ok(p.messages.length < 6)
    assert.ok(p.messages.length % 2 === 0)
  })

  it('U16: maxMessages já resolve, maxChars não precisa agir', () => {
    const p = makeParams(pairs(10), { content: 'q', system_prompt: '' })
    // maxMessages=2 → 2 pares = 'user-9'+'assistant-9'+'user-10'+'assistant-10' = ~40 chars
    // maxChars=10000 → não age
    truncateMessages(p, cfg(10_000, 2))
    assert.equal(p.messages.length, 4)
    assert.equal(p.messages[0].content, 'user-9')
  })
})

// ─── Invariantes estruturais ──────────────────────────────────────────────────

describe('truncateMessages — invariantes', () => {
  it('U17: system_prompt nunca é alterado', () => {
    const sp = 'original system prompt'
    const p = makeParams(pairs(5), { system_prompt: sp, content: 'x'.repeat(500) })
    truncateMessages(p, cfg(10, 0))
    assert.equal(p.system_prompt, sp)
  })

  it('U18: content nunca é alterado', () => {
    const content = 'original content'
    const p = makeParams(pairs(5), { content })
    truncateMessages(p, cfg(10, 0))
    assert.equal(p.content, content)
  })

  it('U19: outros campos do params não são alterados', () => {
    const p = makeParams(pairs(5))
    p.provider = 'gemini'
    p.model = 'gemini-pro'
    p.cwd = '/tmp'
    truncateMessages(p, cfg(10, 0))
    assert.equal(p.provider, 'gemini')
    assert.equal(p.model, 'gemini-pro')
    assert.equal(p.cwd, '/tmp')
  })

  it('U20: retorna a mesma referência de objeto (mutação in-place)', () => {
    const p = makeParams(pairs(3))
    const result = truncateMessages(p, cfg(0, 0))
    assert.equal(result, p)
  })
})

// ─── Contagem de caracteres ────────────────────────────────────────────────────

describe('truncateMessages — contagem de chars', () => {
  it('U21: system_prompt longo entra na contagem e pode causar truncagem', () => {
    const sp = 'x'.repeat(500)
    const msgs = pairs(3)
    const p = makeParams(msgs, { system_prompt: sp, content: 'q' })
    // total = 500 + 1 + chars dos pares; maxChars=505 → histórico deve ser truncado
    truncateMessages(p, cfg(505, 0))
    assert.ok(p.messages.length < 6)
  })

  it('U22: content longo entra na contagem', () => {
    const p = makeParams(pairs(2), { content: 'x'.repeat(500), system_prompt: '' })
    truncateMessages(p, cfg(501, 0))
    assert.equal(p.messages.length, 0)
  })

  it('U23: content vazio não lança erro', () => {
    const p = makeParams(pairs(2), { content: '', system_prompt: '' })
    assert.doesNotThrow(() => truncateMessages(p, cfg(5, 0)))
  })
})

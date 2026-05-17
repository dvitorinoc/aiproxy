import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt } from '../../src/utils/prompt.mjs'

describe('buildPrompt', () => {
  it('includes only content when no system prompt or history', () => {
    const result = buildPrompt(null, [], 'hello')
    assert.equal(result.trim(), 'hello')
  })

  it('includes system prompt section', () => {
    const result = buildPrompt('Be concise.', [], 'hello')
    assert.ok(result.includes('[INSTRUÇÕES DO SISTEMA]'))
    assert.ok(result.includes('Be concise.'))
    assert.ok(result.includes('hello'))
  })

  it('ignores blank system prompt', () => {
    const result = buildPrompt('   ', [], 'hello')
    assert.ok(!result.includes('[INSTRUÇÕES DO SISTEMA]'))
  })

  it('serializes conversation history in order', () => {
    const messages = [
      { role: 'user',      content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user',      content: 'third' },
    ]
    const result = buildPrompt(null, messages, 'fourth')
    assert.ok(result.indexOf('first') < result.indexOf('second'))
    assert.ok(result.indexOf('second') < result.indexOf('third'))
    assert.ok(result.indexOf('third') < result.indexOf('fourth'))
  })

  it('labels user messages as Usuário', () => {
    const result = buildPrompt(null, [{ role: 'user', content: 'msg' }], 'q')
    assert.ok(result.includes('Usuário:'))
  })

  it('labels assistant messages as Assistente', () => {
    const result = buildPrompt(null, [{ role: 'assistant', content: 'msg' }], 'q')
    assert.ok(result.includes('Assistente:'))
  })

  it('includes NOVA MENSAGEM section when history present', () => {
    const result = buildPrompt(null, [{ role: 'user', content: 'x' }], 'new')
    assert.ok(result.includes('[NOVA MENSAGEM DO USUÁRIO]'))
    assert.ok(result.includes('new'))
  })

  it('trims content', () => {
    const result = buildPrompt(null, [], '  trimmed  ')
    assert.ok(result.includes('trimmed'))
    assert.ok(!result.includes('  trimmed  '))
  })

  it('handles null content gracefully', () => {
    const result = buildPrompt(null, [], null)
    assert.equal(typeof result, 'string')
  })
})

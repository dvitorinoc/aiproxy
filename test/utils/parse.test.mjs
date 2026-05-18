import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUsage, mergeUsage, safeJsonParse, parseJsonLines,
  pickFirstNumber, extractUsage, extractText, parseProviderPayload,
} from '../../src/utils/parse.mjs'

// ─── emptyUsage ───────────────────────────────────────────────────
describe('emptyUsage', () => {
  it('defaults source to unavailable', () => {
    assert.equal(emptyUsage().source, 'unavailable')
  })
  it('accepts custom source', () => {
    assert.equal(emptyUsage('provider').source, 'provider')
  })
  it('all token fields are null', () => {
    const u = emptyUsage()
    assert.equal(u.input_tokens, null)
    assert.equal(u.output_tokens, null)
    assert.equal(u.total_tokens, null)
    assert.equal(u.reasoning_tokens, null)
    assert.equal(u.cached_tokens, null)
    assert.equal(u.cache_creation_tokens, null)
  })
  it('request_count defaults to 1', () => {
    assert.equal(emptyUsage().request_count, 1)
  })
})

// ─── mergeUsage ───────────────────────────────────────────────────
describe('mergeUsage', () => {
  it('source is provider when either side is provider', () => {
    assert.equal(mergeUsage(emptyUsage('provider'), emptyUsage()).source, 'provider')
    assert.equal(mergeUsage(emptyUsage(), emptyUsage('provider')).source, 'provider')
  })
  it('source stays unavailable when both unavailable', () => {
    assert.equal(mergeUsage(emptyUsage(), emptyUsage()).source, 'unavailable')
  })
  it('null + null = null', () => {
    assert.equal(mergeUsage(emptyUsage(), emptyUsage()).input_tokens, null)
  })
  it('null + number = number', () => {
    const a = { ...emptyUsage(), input_tokens: null }
    const b = { ...emptyUsage(), input_tokens: 5 }
    assert.equal(mergeUsage(a, b).input_tokens, 5)
  })
  it('number + number = sum', () => {
    const a = { ...emptyUsage(), input_tokens: 3 }
    const b = { ...emptyUsage(), input_tokens: 4 }
    assert.equal(mergeUsage(a, b).input_tokens, 7)
  })
  it('request_count always sums', () => {
    const a = { ...emptyUsage(), request_count: 2 }
    const b = { ...emptyUsage(), request_count: 3 }
    assert.equal(mergeUsage(a, b).request_count, 5)
  })
  it('raw prefers next over base', () => {
    const a = { ...emptyUsage(), raw: { from: 'base' } }
    const b = { ...emptyUsage(), raw: { from: 'next' } }
    assert.deepEqual(mergeUsage(a, b).raw, { from: 'next' })
  })
  it('raw falls back to base when next is null', () => {
    const a = { ...emptyUsage(), raw: { from: 'base' } }
    const b = { ...emptyUsage(), raw: null }
    assert.deepEqual(mergeUsage(a, b).raw, { from: 'base' })
  })
  it('sums cache_creation_tokens', () => {
    const a = { ...emptyUsage(), cache_creation_tokens: 400 }
    const b = { ...emptyUsage(), cache_creation_tokens: 600 }
    assert.equal(mergeUsage(a, b).cache_creation_tokens, 1000)
  })
  it('cache_creation_tokens: null + number = number', () => {
    const a = { ...emptyUsage(), cache_creation_tokens: null }
    const b = { ...emptyUsage(), cache_creation_tokens: 300 }
    assert.equal(mergeUsage(a, b).cache_creation_tokens, 300)
  })
})

// ─── safeJsonParse ────────────────────────────────────────────────
describe('safeJsonParse', () => {
  it('parses valid JSON object', () => {
    assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 })
  })
  it('parses valid JSON array', () => {
    assert.deepEqual(safeJsonParse('[1,2]'), [1, 2])
  })
  it('returns null for invalid JSON', () => {
    assert.equal(safeJsonParse('not json'), null)
  })
  it('returns null for empty string', () => {
    assert.equal(safeJsonParse(''), null)
  })
  it('never throws', () => {
    assert.doesNotThrow(() => safeJsonParse('{bad'))
  })
})

// ─── parseJsonLines ───────────────────────────────────────────────
describe('parseJsonLines', () => {
  it('parses multiple NDJSON lines', () => {
    const result = parseJsonLines('{"a":1}\n{"b":2}')
    assert.equal(result.length, 2)
    assert.deepEqual(result[0], { a: 1 })
    assert.deepEqual(result[1], { b: 2 })
  })
  it('silently skips invalid lines', () => {
    const result = parseJsonLines('{"a":1}\nbad line\n{"b":2}')
    assert.equal(result.length, 2)
  })
  it('skips blank lines', () => {
    const result = parseJsonLines('{"a":1}\n\n{"b":2}')
    assert.equal(result.length, 2)
  })
  it('returns empty array for fully invalid input', () => {
    assert.deepEqual(parseJsonLines('not json at all'), [])
  })
})

// ─── pickFirstNumber ──────────────────────────────────────────────
describe('pickFirstNumber', () => {
  it('returns first finite number', () => {
    assert.equal(pickFirstNumber(null, 0, 5), 0)
  })
  it('skips NaN and Infinity', () => {
    assert.equal(pickFirstNumber(NaN, Infinity, 3), 3)
  })
  it('accepts numeric strings', () => {
    assert.equal(pickFirstNumber('42'), 42)
  })
  it('ignores non-numeric strings', () => {
    assert.equal(pickFirstNumber('abc', 7), 7)
  })
  it('returns null when no valid number', () => {
    assert.equal(pickFirstNumber(null, undefined, NaN), null)
  })
})

// ─── extractUsage ─────────────────────────────────────────────────
describe('extractUsage', () => {
  it('extracts direct token fields', () => {
    const u = extractUsage({ input_tokens: 10, output_tokens: 5 })
    assert.equal(u.input_tokens, 10)
    assert.equal(u.output_tokens, 5)
    assert.equal(u.total_tokens, 15)
    assert.equal(u.source, 'provider')
  })

  it('uses explicit total_tokens when present', () => {
    const u = extractUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 20 })
    assert.equal(u.total_tokens, 20)
  })

  it('maps Gemini aliases (promptTokenCount, candidatesTokenCount)', () => {
    const u = extractUsage({ promptTokenCount: 8, candidatesTokenCount: 4 })
    assert.equal(u.input_tokens, 8)
    assert.equal(u.output_tokens, 4)
  })

  it('maps OpenAI aliases (prompt_tokens, completion_tokens)', () => {
    const u = extractUsage({ prompt_tokens: 3, completion_tokens: 7 })
    assert.equal(u.input_tokens, 3)
    assert.equal(u.output_tokens, 7)
  })

  it('maps cached_tokens from cache_read_input_tokens', () => {
    const u = extractUsage({ input_tokens: 1, cache_read_input_tokens: 99 })
    assert.equal(u.cached_tokens, 99)
  })

  it('extracts cache_creation_tokens from cache_creation_input_tokens', () => {
    const u = extractUsage({ input_tokens: 3, cache_creation_input_tokens: 1200 })
    assert.equal(u.cache_creation_tokens, 1200)
  })

  it('cached_tokens does not use cache_creation_input_tokens as fallback', () => {
    const u = extractUsage({ input_tokens: 3, cache_creation_input_tokens: 1200 })
    assert.equal(u.cached_tokens, null)
  })

  it('finds usage nested inside usage key', () => {
    const u = extractUsage({ usage: { input_tokens: 10, output_tokens: 2 } })
    assert.equal(u.input_tokens, 10)
  })

  it('handles array input — returns first match', () => {
    const arr = [{ nada: 1 }, { input_tokens: 5, output_tokens: 3 }]
    const u = extractUsage(arr)
    assert.equal(u.input_tokens, 5)
  })

  it('returns emptyUsage for array with no match', () => {
    const u = extractUsage([{ x: 1 }, { y: 2 }])
    assert.equal(u.source, 'unavailable')
  })

  it('does not throw on circular references', () => {
    const obj = { input_tokens: 1 }
    obj.self = obj
    assert.doesNotThrow(() => extractUsage(obj))
  })

  it('returns emptyUsage for empty object', () => {
    const u = extractUsage({})
    assert.equal(u.source, 'unavailable')
  })
})

// ─── extractText ──────────────────────────────────────────────────
describe('extractText', () => {
  it('returns trimmed string directly', () => {
    assert.equal(extractText('  hello  '), 'hello')
  })
  it('extracts from output field', () => {
    assert.equal(extractText({ output: 'hi' }), 'hi')
  })
  it('extracts from result field', () => {
    assert.equal(extractText({ result: 'res' }), 'res')
  })
  it('extracts from content string field', () => {
    assert.equal(extractText({ content: 'cnt' }), 'cnt')
  })
  it('extracts from content array of {text}', () => {
    assert.equal(extractText({ content: [{ text: 'a' }, { text: 'b' }] }), 'a\nb')
  })
  it('extracts from output array of items with content', () => {
    const result = extractText({ output: [{ content: 'x' }, { content: 'y' }] })
    assert.ok(result.includes('x'))
    assert.ok(result.includes('y'))
  })
  it('recurses into message key', () => {
    assert.equal(extractText({ message: { output: 'nested' } }), 'nested')
  })
  it('returns empty string for null', () => {
    assert.equal(extractText(null), '')
  })
  it('returns empty string for unrecognized object', () => {
    assert.equal(extractText({ foo: 'bar' }), '')
  })
})

// ─── parseProviderPayload ────────────────────────────────────────
describe('parseProviderPayload', () => {
  it('parses claude JSON output', () => {
    const stdout = JSON.stringify({ result: 'hello from claude' })
    const { output, usage } = parseProviderPayload('claude', stdout)
    assert.equal(output, 'hello from claude')
  })

  it('uses fallbackOutput when stdout is empty', () => {
    const { output } = parseProviderPayload('claude', '', 'fallback text')
    assert.equal(output, 'fallback text')
  })

  it('returns raw stdout when not parseable and no fallback', () => {
    const { output } = parseProviderPayload('claude', 'plain text')
    assert.equal(output, 'plain text')
  })

  it('codex: finds item.completed event', () => {
    const events = [
      { type: 'item.created', content: 'partial' },
      { type: 'item.completed', result: 'final answer' },
    ]
    const stdout = events.map(e => JSON.stringify(e)).join('\n')
    const { output } = parseProviderPayload('codex', stdout)
    assert.equal(output, 'final answer')
  })

  it('codex: prefers fallbackOutput over extracted text', () => {
    const events = [{ type: 'item.completed', result: 'from event' }]
    const stdout = events.map(e => JSON.stringify(e)).join('\n')
    const { output } = parseProviderPayload('codex', stdout, 'from file')
    assert.equal(output, 'from file')
  })

  it('sets request_count to 1 when missing', () => {
    const stdout = JSON.stringify({ result: 'ok' })
    const { usage } = parseProviderPayload('claude', stdout)
    assert.equal(usage.request_count, 1)
  })
})

export function emptyUsage(source = 'unavailable') {
  return { source, input_tokens: null, output_tokens: null, total_tokens: null, reasoning_tokens: null, cached_tokens: null, request_count: 1, raw: null }
}

export function mergeUsage(base = emptyUsage(), next = emptyUsage()) {
  const add = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0))
  return {
    source:           base.source === 'provider' || next.source === 'provider' ? 'provider' : (next.source || base.source || 'unavailable'),
    input_tokens:     add(base.input_tokens,     next.input_tokens),
    output_tokens:    add(base.output_tokens,    next.output_tokens),
    total_tokens:     add(base.total_tokens,     next.total_tokens),
    reasoning_tokens: add(base.reasoning_tokens, next.reasoning_tokens),
    cached_tokens:    add(base.cached_tokens,    next.cached_tokens),
    request_count:    (base.request_count || 0) + (next.request_count || 0),
    raw:              next.raw ?? base.raw ?? null,
  }
}

export function safeJsonParse(text) {
  try { return JSON.parse(text) } catch { return null }
}

export function parseJsonLines(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => safeJsonParse(l)).filter(Boolean)
}

export function pickFirstNumber(...values) {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

export function extractUsage(value) {
  const visited = new WeakSet()

  const scan = (node) => {
    if (!node || typeof node !== 'object') return null
    if (visited.has(node)) return null
    visited.add(node)

    const direct = {
      input_tokens:     pickFirstNumber(node.input_tokens,     node.prompt_tokens,     node.promptTokenCount,  node.inputTokenCount,  node.prompt_token_count),
      output_tokens:    pickFirstNumber(node.output_tokens,    node.completion_tokens, node.candidatesTokenCount, node.outputTokenCount, node.completion_token_count),
      total_tokens:     pickFirstNumber(node.total_tokens,     node.totalTokenCount,   node.total_token_count),
      reasoning_tokens: pickFirstNumber(node.reasoning_tokens, node.thoughtsTokenCount, node.reasoningTokenCount),
      cached_tokens:    pickFirstNumber(node.cached_tokens,    node.cachedTokenCount,  node.cachedContentTokenCount, node.cache_read_input_tokens, node.cache_creation_input_tokens),
    }

    if (Object.values(direct).some(v => v != null)) {
      if (direct.total_tokens == null && (direct.input_tokens != null || direct.output_tokens != null)) {
        direct.total_tokens = (direct.input_tokens || 0) + (direct.output_tokens || 0)
      }
      return { ...emptyUsage('provider'), ...direct, raw: node }
    }

    for (const key of ['usage', 'usageMetadata', 'metadata', 'message', 'response', 'result']) {
      if (node[key] && typeof node[key] === 'object') {
        const found = scan(node[key])
        if (found) return found
      }
    }

    for (const item of Object.values(node)) {
      if (Array.isArray(item)) {
        for (const entry of item) { const found = scan(entry); if (found) return found }
      } else if (item && typeof item === 'object') {
        const found = scan(item); if (found) return found
      }
    }
    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) { const found = scan(item); if (found) return found }
    return emptyUsage()
  }
  return scan(value) ?? emptyUsage()
}

export function extractText(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''

  for (const key of ['output', 'result', 'content', 'text', 'completion']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim()
  }

  if (Array.isArray(value.content)) {
    const text = value.content.map(i => typeof i === 'string' ? i : (i?.text || i?.content || i?.value || '')).filter(Boolean).join('\n').trim()
    if (text) return text
  }

  if (Array.isArray(value.output)) {
    const text = value.output.flatMap(i => {
      if (typeof i?.content === 'string') return [i.content]
      if (Array.isArray(i?.content)) return i.content.map(p => p?.text || p?.content || '').filter(Boolean)
      return [i?.text || i?.message || ''].filter(Boolean)
    }).join('\n').trim()
    if (text) return text
  }

  if (value.message) { const t = extractText(value.message); if (t) return t }
  if (value.response) { const t = extractText(value.response); if (t) return t }
  return ''
}

export function parseProviderPayload(provider, stdout, fallbackOutput = '') {
  const trimmed      = stdout.trim()
  const parsedObject = safeJsonParse(trimmed)
  const parsedLines  = parsedObject ? null : parseJsonLines(trimmed)
  const parsed       = parsedObject ?? (parsedLines?.length ? parsedLines : null)

  if (provider === 'codex' && Array.isArray(parsed)) {
    const finalEvent = [...parsed].reverse().find(e => e?.type === 'item.completed' || e?.type === 'response.completed' || e?.type === 'turn.completed')
    const output = fallbackOutput || extractText(finalEvent) || extractText(parsed)
    const usage  = extractUsage(finalEvent || parsed)
    if (usage.request_count == null) usage.request_count = 1
    return { output: output || fallbackOutput || trimmed, usage }
  }

  if (parsed) {
    const output = fallbackOutput || extractText(parsed)
    const usage  = extractUsage(parsed)
    if (usage.request_count == null) usage.request_count = 1
    return { output: output || fallbackOutput || trimmed, usage }
  }

  return { output: fallbackOutput || trimmed, usage: emptyUsage() }
}

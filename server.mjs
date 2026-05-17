/**
 * AI Proxy
 * POST /run  { provider, model?, system_prompt, messages?, content, use_mcp?, cwd? }
 * GET  /health
 *
 * Sessions  → cliente envia `messages` (histórico); proxy constrói conversa multi-turn
 * MCP       → quando use_mcp=true, proxy executa loop de tools para qualquer provider
 */

import { createServer } from 'http'
import { spawn }        from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import config from './config.mjs'
import { loadMcpServers, callTool, buildToolPrompt } from './src/mcp/client.mjs'

const PORT        = config.port
const LARAVEL_API = config.laravelApi
const __dirname   = dirname(fileURLToPath(import.meta.url))

const NVM_NODE  = config.path.nvmNode
const LOCAL_BIN = config.path.localBin
const FULL_PATH = `${NVM_NODE}:${LOCAL_BIN}:/usr/local/bin:/usr/bin:/bin`
const ENV       = { ...process.env, PATH: FULL_PATH }

const MCP_SERVER = join(__dirname, 'mcp-server.mjs')
const NODE_BIN   = join(NVM_NODE, 'node')

// ─── Modelos sugeridos ─────────────────────────────────────────────
export const SUGGESTED_MODELS = {
  claude: ['sonnet', 'opus', 'haiku', 'claude-sonnet-4-6', 'claude-opus-4-7'],
  gemini: ['', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro'],
  codex:  ['', 'gpt-5.4', 'o3', 'gpt-4o'],
}

// ─── Helpers ───────────────────────────────────────────────────────
function resolveExecCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return undefined

  try {
    return statSync(cwd).isDirectory() ? cwd : undefined
  } catch {
    return undefined
  }
}

const PROVIDER_BINARY = { claude: 'claude', gemini: 'gemini', codex: 'codex' }

function isBinaryAvailable(name) {
  for (const dir of FULL_PATH.split(':')) {
    try { statSync(join(dir, name)); return true } catch {}
  }
  return false
}

function claudeWorkspaceArgs(cwd) {
  const execCwd = resolveExecCwd(cwd)
  return execCwd ? ['--add-dir', execCwd] : []
}

// Executa um processo sem shell, passando stdin como string — sem limites de ARG_MAX nem escaping
function spawnWithStdin(bin, args, opts, stdinData) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', code => {
      if (code !== 0) {
        const msg = (stderr || stdout).slice(0, 500)
        reject(new Error(`Command failed (exit ${code}): ${msg}`))
      } else {
        resolve({ stdout, stderr })
      }
    })
    child.on('error', reject)
    if (stdinData) child.stdin.write(stdinData, 'utf8')
    child.stdin.end()
  })
}

function geminiWorkspaceArgs(cwd) {
  const execCwd       = resolveExecCwd(cwd)
  const baseDir = join(__dirname, '..')
  const args = ['--include-directories', baseDir, '--skip-trust', '--approval-mode', 'yolo']
  if (execCwd) args.push('--include-directories', execCwd)
  return args
}

function codexWorkspaceArgs(cwd) {
  const execCwd = resolveExecCwd(cwd)
  if (!execCwd) return []
  return ['--cd', execCwd, '--add-dir', execCwd]
}

/**
 * Monta um prompt único a partir do histórico + mensagem atual.
 * Usado para CLIs que recebem texto livre.
 */
function buildPrompt(systemPrompt, messages, currentContent) {
  const parts = []

  // systemPrompt=null significa que foi passado via flag separada (ex: --system-prompt do claude)
  if (systemPrompt?.trim()) {
    parts.push(`[INSTRUÇÕES DO SISTEMA]\n${systemPrompt.trim()}`)
  }

  if (messages?.length) {
    parts.push('[HISTÓRICO DA CONVERSA]')
    for (const m of messages) {
      const label = m.role === 'user' ? 'Usuário' : 'Assistente'
      parts.push(`${label}:\n${m.content}`)
    }
    parts.push('[NOVA MENSAGEM DO USUÁRIO]')
  }

  parts.push(currentContent?.trim() ?? '')
  return parts.join('\n\n')
}

function emptyUsage(source = 'unavailable') {
  return {
    source,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    reasoning_tokens: null,
    cached_tokens: null,
    request_count: 1,
    raw: null,
  }
}

function mergeUsage(base = emptyUsage(), next = emptyUsage()) {
  const add = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0))
  return {
    source: base.source === 'provider' || next.source === 'provider' ? 'provider' : (next.source || base.source || 'unavailable'),
    input_tokens: add(base.input_tokens, next.input_tokens),
    output_tokens: add(base.output_tokens, next.output_tokens),
    total_tokens: add(base.total_tokens, next.total_tokens),
    reasoning_tokens: add(base.reasoning_tokens, next.reasoning_tokens),
    cached_tokens: add(base.cached_tokens, next.cached_tokens),
    request_count: (base.request_count || 0) + (next.request_count || 0),
    raw: next.raw ?? base.raw ?? null,
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseJsonLines(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => safeJsonParse(line))
    .filter(Boolean)
}

function pickFirstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function extractUsage(value) {
  const visited = new WeakSet()

  const scan = (node) => {
    if (!node || typeof node !== 'object') return null
    if (visited.has(node)) return null
    visited.add(node)

    const direct = {
      input_tokens: pickFirstNumber(
        node.input_tokens,
        node.prompt_tokens,
        node.promptTokenCount,
        node.inputTokenCount,
        node.prompt_token_count,
      ),
      output_tokens: pickFirstNumber(
        node.output_tokens,
        node.completion_tokens,
        node.candidatesTokenCount,
        node.outputTokenCount,
        node.completion_token_count,
      ),
      total_tokens: pickFirstNumber(
        node.total_tokens,
        node.totalTokenCount,
        node.total_token_count,
      ),
      reasoning_tokens: pickFirstNumber(
        node.reasoning_tokens,
        node.thoughtsTokenCount,
        node.reasoningTokenCount,
      ),
      cached_tokens: pickFirstNumber(
        node.cached_tokens,
        node.cachedTokenCount,
        node.cachedContentTokenCount,
        node.cache_read_input_tokens,
        node.cache_creation_input_tokens,
      ),
    }

    const hasDirect = Object.values(direct).some(v => v != null)
    if (hasDirect) {
      if (direct.total_tokens == null && (direct.input_tokens != null || direct.output_tokens != null)) {
        direct.total_tokens = (direct.input_tokens || 0) + (direct.output_tokens || 0)
      }
      return {
        ...emptyUsage('provider'),
        ...direct,
        raw: node,
      }
    }

    const nestedKeys = ['usage', 'usageMetadata', 'metadata', 'message', 'response', 'result']
    for (const key of nestedKeys) {
      if (node[key] && typeof node[key] === 'object') {
        const found = scan(node[key])
        if (found) return found
      }
    }

    for (const item of Object.values(node)) {
      if (Array.isArray(item)) {
        for (const entry of item) {
          const found = scan(entry)
          if (found) return found
        }
      } else if (item && typeof item === 'object') {
        const found = scan(item)
        if (found) return found
      }
    }

    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = scan(item)
      if (found) return found
    }
    return emptyUsage()
  }

  return scan(value) ?? emptyUsage()
}

function extractText(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''

  const directKeys = ['output', 'result', 'content', 'text', 'completion']
  for (const key of directKeys) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim()
  }

  if (Array.isArray(value.content)) {
    const text = value.content
      .map(item => typeof item === 'string'
        ? item
        : (item?.text || item?.content || item?.value || ''))
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) return text
  }

  if (Array.isArray(value.output)) {
    const text = value.output
      .flatMap(item => {
        if (typeof item?.content === 'string') return [item.content]
        if (Array.isArray(item?.content)) {
          return item.content.map(part => part?.text || part?.content || '').filter(Boolean)
        }
        return [item?.text || item?.message || ''].filter(Boolean)
      })
      .join('\n')
      .trim()
    if (text) return text
  }

  if (value.message) {
    const text = extractText(value.message)
    if (text) return text
  }

  if (value.response) {
    const text = extractText(value.response)
    if (text) return text
  }

  return ''
}

function parseProviderPayload(provider, stdout, fallbackOutput = '') {
  const trimmed = stdout.trim()
  const parsedObject = safeJsonParse(trimmed)
  const parsedLines = parsedObject ? null : parseJsonLines(trimmed)
  const parsed = parsedObject ?? (parsedLines.length ? parsedLines : null)

  let output = ''
  let usage = emptyUsage()

  if (provider === 'codex' && Array.isArray(parsed)) {
    const finalEvent = [...parsed].reverse().find(event => event?.type === 'item.completed' || event?.type === 'response.completed' || event?.type === 'turn.completed')
    output = fallbackOutput || extractText(finalEvent) || extractText(parsed)
    usage = extractUsage(finalEvent || parsed)
    if (usage.request_count == null) usage.request_count = 1
    return { output: output || fallbackOutput || trimmed, usage }
  }

  if (parsed) {
    output = fallbackOutput || extractText(parsed)
    usage = extractUsage(parsed)
    if (usage.request_count == null) usage.request_count = 1
    return { output: output || fallbackOutput || trimmed, usage }
  }

  return {
    output: fallbackOutput || trimmed,
    usage: emptyUsage(),
  }
}

// ─── MCP Tool Loop ─────────────────────────────────────────────────

function parseToolCalls(text) {
  const calls = []
  const re = /<tool_call>\s*<name>([\w]+)<\/name>\s*<args>([\s\S]*?)<\/args>\s*<\/tool_call>/g
  let m
  while ((m = re.exec(text)) !== null) {
    try { calls.push({ name: m[1].trim(), args: JSON.parse(m[2].trim()) }) } catch {}
  }
  return calls
}

/**
 * Executa o loop de MCP tools de forma agnóstica de provider.
 * Injeta definição das tools no system prompt e itera até não haver mais tool_calls.
 */
async function runMcpLoop(rawCall, systemPrompt, messages, content, model, cwd) {
  const toolPrompt   = buildToolPrompt()
  const sysWithTools = [systemPrompt?.trim(), toolPrompt].filter(Boolean).join('\n\n')
  let loopMessages   = [...(messages ?? [])]
  let loopContent    = content
  const MAX_ITER     = config.mcp.maxIterations
  let cumulativeUsage = { ...emptyUsage(), request_count: 0 }

  for (let i = 0; i < MAX_ITER; i++) {
    const result = await rawCall(sysWithTools, loopMessages, loopContent, model, cwd)
    cumulativeUsage = mergeUsage(cumulativeUsage, result?.usage ?? emptyUsage())
    const output = result?.output ?? ''
    const calls  = parseToolCalls(output)

    if (!calls.length) {
      return { output, usage: cumulativeUsage }
    }

    console.log(`   [MCP] iter ${i + 1} — ${calls.map(c => c.name).join(', ')}`)

    const results    = await Promise.all(calls.map(c => callTool(c.name, c.args)))
    const resultText = calls.map((c, idx) =>
      `<tool_result><name>${c.name}</name><result>${JSON.stringify(results[idx])}</result></tool_result>`
    ).join('\n')

    loopMessages = [
      ...loopMessages,
      { role: 'user',      content: loopContent },
      { role: 'assistant', content: output },
    ]
    loopContent = `Resultados das ferramentas:\n${resultText}\n\nContinue com sua análise. Se terminou, responda sem usar <tool_call>.`
  }

  return { output: '[MCP] Limite de iterações atingido.', usage: cumulativeUsage }
}

// ─── Providers ────────────────────────────────────────────────────

const PROVIDERS = {
  claude: {
    raw: async (systemPrompt, messages, content, model, cwd) => {
      // Usa spawn sem shell: sem escaping, sem limite ARG_MAX, conteúdo via stdin
      const userContent = buildPrompt(null, messages, content)
      const execCwd     = resolveExecCwd(cwd)

      const args = []
      if (model)                args.push('--model', model)
      if (systemPrompt?.trim()) args.push('--system-prompt', systemPrompt.trim())
      args.push(...claudeWorkspaceArgs(cwd))
      args.push('--print', '--output-format', 'json')

      const { stdout } = await spawnWithStdin(
        'claude', args,
        { cwd: execCwd, env: ENV, timeout: config.timeouts.claude },
        userContent
      )
      return parseProviderPayload('claude', stdout)
    },
    call: async (systemPrompt, messages, content, model, useMcp, cwd) => {
      const raw = (sp, msgs, c, m, workingCwd) => PROVIDERS.claude.raw(sp, msgs, c, m, workingCwd)
      if (useMcp) return runMcpLoop(raw, systemPrompt, messages, content, model, cwd)
      return raw(systemPrompt, messages, content, model, cwd)
    },
  },

  gemini: {
    raw: async (systemPrompt, messages, content, model, cwd) => {
      const prompt  = buildPrompt(systemPrompt, messages, content)
      const execCwd = resolveExecCwd(cwd)
      const args    = []
      if (model) args.push('-m', model)
      args.push(...geminiWorkspaceArgs(cwd))
      args.push('-o', 'json')
      const { stdout } = await spawnWithStdin(
        'gemini', args,
        { cwd: execCwd, env: ENV, timeout: config.timeouts.gemini },
        prompt
      )
      return parseProviderPayload('gemini', stdout.replace(/Ripgrep is not available.*\n/g, '').trim())
    },
    call: async (systemPrompt, messages, content, model, useMcp, cwd) => {
      const raw = (sp, msgs, c, m, workingCwd) => PROVIDERS.gemini.raw(sp, msgs, c, m, workingCwd)
      if (useMcp) return runMcpLoop(raw, systemPrompt, messages, content, model, cwd)
      return raw(systemPrompt, messages, content, model, cwd)
    },
  },

  codex: {
    raw: async (systemPrompt, messages, content, model, cwd) => {
      const prompt     = buildPrompt(systemPrompt, messages, content)
      const execCwd    = resolveExecCwd(cwd)
      const tempDir    = mkdtempSync(join(tmpdir(), 'ai-proxy-codex-'))
      const outputFile = join(tempDir, 'last-message.txt')
      try {
        const args = ['exec']
        if (model) args.push('-m', model)
        args.push(...codexWorkspaceArgs(cwd))
        args.push('--json', '-o', outputFile)
        const { stdout } = await spawnWithStdin(
          'codex', args,
          { cwd: execCwd, env: ENV, timeout: config.timeouts.codex },
          prompt
        )
        let finalOutput = ''
        try { finalOutput = readFileSync(outputFile, 'utf8').trim() } catch {}
        return parseProviderPayload('codex', stdout, finalOutput)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
    call: async (systemPrompt, messages, content, model, useMcp, cwd) => {
      const raw = (sp, msgs, c, m, workingCwd) => PROVIDERS.codex.raw(sp, msgs, c, m, workingCwd)
      if (useMcp) return runMcpLoop(raw, systemPrompt, messages, content, model, cwd)
      return raw(systemPrompt, messages, content, model, cwd)
    },
  },
}

// ─── SSE: streaming em tempo real ─────────────────────────────────

const sseClients = new Set()
let   lastSseHash = null

let _pollRunning = false
async function pollAndBroadcast() {
  if (sseClients.size === 0) return
  if (_pollRunning) return   // evita acúmulo de polls pendentes
  _pollRunning = true
  try {
    const sig = AbortSignal.timeout(4000)
    const [tRes, aRes, sRes] = await Promise.all([
      fetch(`${LARAVEL_API}/tasks`,    { signal: sig }),
      fetch(`${LARAVEL_API}/agents`,   { signal: sig }),
      fetch(`${LARAVEL_API}/settings`, { signal: sig }),
    ])
    if (!tRes.ok || !aRes.ok) return

    const [tasks, agents, settings] = await Promise.all([tRes.json(), aRes.json(), sRes.json()])
    const hash = JSON.stringify({ tasks, agents })

    if (hash === lastSseHash) return
    lastSseHash = hash

    const payload = JSON.stringify({
      tasks,
      agents,
      busy_agents:            settings?.busy_agents            ?? agents.filter(a => a.status === 'busy').length,
      max_concurrent_agents:  settings?.max_concurrent_agents  ?? 3,
    })

    const msg = `event: update\ndata: ${payload}\n\n`
    for (const res of sseClients) {
      try { res.write(msg) } catch {}
    }
  } catch {} finally {
    _pollRunning = false
  }
}

setInterval(pollAndBroadcast, config.ssePollMs)

// ─── HTTP Server ───────────────────────────────────────────────────
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

const ts = () => new Date().toISOString().slice(11, 19)

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' })
    return res.end()
  }

  // SSE — eventos em tempo real para o frontend
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write(': connected\n\n')
    sseClients.add(res)
    console.log(`[${ts()}] SSE client connected (${sseClients.size} total)`)

    // Envia estado atual imediatamente
    lastSseHash = null
    pollAndBroadcast()

    req.on('close', () => {
      sseClients.delete(res)
      console.log(`[${ts()}] SSE client disconnected (${sseClients.size} total)`)
    })
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, {
      ok: true,
      providers: Object.keys(PROVIDERS),
      suggested_models: SUGGESTED_MODELS,
      port: PORT,
    })
  }

  if (req.method === 'GET' && req.url === '/providers') {
    const providers = {}
    for (const [name, binary] of Object.entries(PROVIDER_BINARY)) {
      providers[name] = { available: isBinaryAvailable(binary) }
    }
    return json(res, 200, { providers })
  }

  if (req.method === 'POST' && req.url === '/run') {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', async () => {
      try {
        const {
          provider = 'claude',
          model,
          system_prompt = '',
          messages = [],   // histórico de conversa (session)
          content  = '',
          use_mcp  = false,
          cwd,
        } = JSON.parse(body)

        if (!PROVIDERS[provider]) {
          return json(res, 400, { error: `Provider inválido: ${provider}` })
        }
        if (!content.trim()) {
          return json(res, 400, { error: 'Campo "content" é obrigatório.' })
        }

        const modelLabel = model || 'default'
        const tags = [
          messages?.length ? `hist:${messages.length}` : null,
          use_mcp ? 'MCP' : null,
          resolveExecCwd(cwd) ? `cwd:${cwd}` : null,
        ].filter(Boolean)
        const tagStr = tags.length ? ` [${tags.join(' ')}]` : ''
        console.log(`[${ts()}] ▶ ${provider}/${modelLabel}${tagStr} ← ${content.slice(0, 60).replace(/\n/g, ' ')}…`)

        const result = await PROVIDERS[provider].call(system_prompt, messages, content, model || null, use_mcp, cwd)
        const output = result?.output ?? ''

        console.log(`[${ts()}] ✓ ${provider}/${modelLabel} → ${output.slice(0, 60).replace(/\n/g, ' ')}…`)

        return json(res, 200, {
          provider,
          model: model || null,
          output,
          usage: result?.usage ?? emptyUsage(),
        })
      } catch (err) {
        const unavailable = err.code === 'ENOENT' || /exit 127|not found|No such file/i.test(err.message)
        if (unavailable) {
          const { provider = 'claude' } = safeJsonParse(body) ?? {}
          console.error(`[${ts()}] ✗ provider unavailable: ${provider}`)
          return json(res, 503, { error: 'provider_unavailable', provider })
        }
        console.error(`[${ts()}] ✗`, err.message)
        return json(res, 500, { error: err.message })
      }
    })
    return
  }

  json(res, 404, { error: 'Not found' })
})

loadMcpServers().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🤖 AI Proxy  http://0.0.0.0:${PORT}`)
    console.log(`   Providers : ${Object.keys(PROVIDERS).join(' · ')}`)
    console.log(`   MCP       : loop de tools via XML (todos os providers)`)
    console.log(`   Sessions  : histórico multi-turn via messages[]`)
    console.log(`   Container : http://172.19.0.1:${PORT}\n`)
  })
})

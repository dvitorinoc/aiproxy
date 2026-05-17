/**
 * MCP Client — conecta a servidores MCP externos via stdio (Content-Length framing).
 * Descobre ferramentas via tools/list e roteia tool_calls para o servidor correto.
 */

import { spawn } from 'child_process'
import config from '../../config.mjs'

const NVM_NODE  = config.path.nvmNode
const LOCAL_BIN = config.path.localBin
const FULL_PATH = `${NVM_NODE}:${LOCAL_BIN}:/usr/local/bin:/usr/bin:/bin`
const BASE_ENV  = { ...process.env, PATH: FULL_PATH }

// ─── Conexão com um servidor MCP ──────────────────────────────────

class McpConnection {
  constructor(cfg) {
    this.name     = cfg.name
    this.command  = cfg.command
    this.args     = cfg.args  ?? []
    this.env      = { ...BASE_ENV, ...(cfg.env ?? {}) }
    this.tools    = []
    this._proc    = null
    this._buf     = Buffer.alloc(0)
    this._seq     = 0
    this._pending = new Map()
  }

  async connect() {
    this._proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: this.env,
    })
    this._proc.stdout.on('data', chunk => this._recv(chunk))
    this._proc.on('error', err => console.error(`   [MCP:${this.name}] erro: ${err.message}`))
    this._proc.on('close', code => console.log(`   [MCP:${this.name}] encerrado (${code})`))

    await this._rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ai-proxy', version: '1.0.0' },
    })

    const { tools } = await this._rpc('tools/list', {})
    this.tools = tools ?? []
    console.log(`   [MCP:${this.name}] ${this.tools.length} tool(s): ${this.tools.map(t => t.name).join(', ')}`)
  }

  async call(name, args) {
    // Sem timeout: tools podem bloquear por tempo indeterminado (ex: ask_user)
    const result = await this._rpc('tools/call', { name, arguments: args }, 0)
    const text   = (result.content ?? []).map(c => c.text ?? '').join('\n')
    try { return JSON.parse(text) } catch { return text }
  }

  stop() {
    this._proc?.kill()
  }

  // ─── JSON-RPC ───────────────────────────────────────────────────

  _rpc(method, params, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const id    = ++this._seq
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this._pending.delete(id)
            reject(new Error(`[MCP:${this.name}] timeout em '${method}'`))
          }, timeoutMs)
        : null

      this._pending.set(id, {
        resolve: r => { clearTimeout(timer); resolve(r) },
        reject:  e => { clearTimeout(timer); reject(e)  },
      })

      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      this._proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    })
  }

  // ─── Content-Length framing ─────────────────────────────────────

  _recv(chunk) {
    this._buf = Buffer.concat([this._buf, chunk])

    while (true) {
      const sep = this._buf.indexOf('\r\n\r\n')
      if (sep === -1) break

      const match = this._buf.slice(0, sep).toString().match(/Content-Length:\s*(\d+)/i)
      if (!match) { this._buf = this._buf.slice(sep + 4); continue }

      const len   = parseInt(match[1])
      const start = sep + 4
      if (this._buf.length < start + len) break

      const body = this._buf.slice(start, start + len).toString()
      this._buf  = this._buf.slice(start + len)

      try {
        const msg = JSON.parse(body)
        const cb  = this._pending.get(msg.id)
        if (cb) {
          this._pending.delete(msg.id)
          msg.error ? cb.reject(new Error(msg.error.message)) : cb.resolve(msg.result)
        }
      } catch {}
    }
  }
}

// ─── Registry ─────────────────────────────────────────────────────

const connections = []
const toolMap     = {}   // tool name → McpConnection

export async function loadMcpServers() {
  const servers = config.mcp?.servers ?? []
  if (!servers.length) return

  for (const cfg of servers) {
    try {
      const conn = new McpConnection(cfg)
      await conn.connect()
      connections.push(conn)
      for (const tool of conn.tools) toolMap[tool.name] = conn
    } catch (err) {
      console.error(`   [MCP:${cfg.name}] falha ao iniciar: ${err.message}`)
    }
  }
}

export function getTools() {
  return connections.flatMap(c => c.tools)
}

export async function callTool(name, args) {
  const conn = toolMap[name]
  if (!conn) return { error: `Tool desconhecida: ${name}` }
  try { return await conn.call(name, args) } catch (e) { return { error: e.message } }
}

/** Gera o bloco de instruções MCP injetado no system prompt do agente. */
export function buildToolPrompt() {
  const tools = getTools()
  if (!tools.length) return ''

  const defs = tools.map(t => {
    const props  = t.inputSchema?.properties ?? {}
    const req    = new Set(t.inputSchema?.required ?? [])
    const params = Object.entries(props)
      .map(([k, v]) => `"${k}${req.has(k) ? '' : '?'}": ${v.type ?? 'any'}`)
      .join(', ')
    return `### ${t.name} — ${t.description}\nParâmetros: { ${params} }`
  }).join('\n\n')

  return `## Ferramentas Disponíveis (MCP)

Para usar uma ferramenta, inclua na sua resposta:
<tool_call>
<name>nome_da_ferramenta</name>
<args>{"param": "valor"}</args>
</tool_call>

Você pode chamar múltiplas ferramentas em sequência. Quando não precisar mais de ferramentas, responda normalmente sem tags <tool_call>.

${defs}`
}

export function stopAll() {
  connections.forEach(c => c.stop())
}

/**
 * Template de MCP Server para uso com o AI Proxy (stdio transport).
 *
 * Copie este arquivo para o seu projeto, defina suas ferramentas em TOOLS e
 * implemente os handlers em callTool(). Depois registre o servidor em config.mjs:
 *
 *   mcp: {
 *     servers: [
 *       { name: 'meu-projeto', command: 'node', args: ['../meu-projeto/mcp-server.mjs'] }
 *     ]
 *   }
 *
 * Protocolo: JSON-RPC 2.0 com Content-Length framing sobre stdio.
 */

const API = process.env.AI_PROXY_API || process.env.AUTOFORGE_API || 'http://localhost:8000/api'

// ─── HTTP helper ──────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${API}${path}`, opts)
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}`)
  return res.json()
}

// ─── Tools ───────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_task',
    description: 'Retorna o estado completo de uma task com todas as subtasks (id, título, status, agente, output).',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'integer', description: 'ID da task' } },
      required: ['task_id'],
    },
  },
  {
    name: 'list_agents',
    description: 'Lista todos os agentes com nome, role e status (idle/busy).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reassign_subtask',
    description: 'Reatribui uma subtask pendente ou bloqueada a um agente diferente pelo role.',
    inputSchema: {
      type: 'object',
      properties: {
        subtask_id: { type: 'integer' },
        agent_role: {
          type: 'string',
          description: 'Role do agente: orchestrator | architect | implementer_php | implementer_js | test_creator | tester | security',
        },
      },
      required: ['subtask_id', 'agent_role'],
    },
  },
  {
    name: 'update_subtask_instructions',
    description: 'Atualiza ou complementa as instruções de uma subtask ainda não executada com contexto adicional.',
    inputSchema: {
      type: 'object',
      properties: {
        subtask_id: { type: 'integer' },
        description: { type: 'string', description: 'Instruções completas e atualizadas para o agente' },
      },
      required: ['subtask_id', 'description'],
    },
  },
  {
    name: 'add_subtask',
    description: 'Cria uma nova subtask quando o output de uma execução revelou necessidade não prevista no plano original.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string', description: 'Instruções completas para o agente' },
        agent_role: { type: 'string' },
        depends_on_subtask_id: { type: 'integer', description: 'ID da subtask predecessora (omitir se pode executar imediatamente)' },
      },
      required: ['task_id', 'title', 'description', 'agent_role'],
    },
  },
  {
    name: 'skip_subtask',
    description: 'Marca uma subtask como concluída sem execução quando ela se tornou desnecessária.',
    inputSchema: {
      type: 'object',
      properties: {
        subtask_id: { type: 'integer' },
        reason: { type: 'string', description: 'Motivo pelo qual a subtask foi pulada' },
      },
      required: ['subtask_id', 'reason'],
    },
  },
]

// ─── Tool handlers ─────────────────────────────────────────────────
async function callTool(name, args) {
  switch (name) {
    case 'get_task': {
      const [task, subtasks] = await Promise.all([
        api('GET', `/tasks/${args.task_id}`),
        api('GET', `/tasks/${args.task_id}/subtasks`),
      ])
      return {
        task: { id: task.id, title: task.title, status: task.status },
        subtasks: subtasks.map(s => ({
          id: s.id,
          title: s.title,
          status: s.status,
          agent: s.agent?.name ?? null,
          agent_role: s.agent?.role ?? null,
          output_preview: s.output ? s.output.slice(0, 300) : null,
        })),
      }
    }

    case 'list_agents': {
      const agents = await api('GET', '/agents')
      return agents.map(a => ({ id: a.id, name: a.name, role: a.role, status: a.status }))
    }

    case 'reassign_subtask': {
      const agents = await api('GET', '/agents')
      const agent = agents.find(a => a.role === args.agent_role)
      if (!agent) return { error: `Nenhum agente com role '${args.agent_role}'.` }
      await api('PUT', `/subtasks/${args.subtask_id}`, { agent_id: agent.id })
      return { success: true, assigned_to: agent.name }
    }

    case 'update_subtask_instructions': {
      await api('PUT', `/subtasks/${args.subtask_id}`, { description: args.description })
      return { success: true }
    }

    case 'add_subtask': {
      const agents = await api('GET', '/agents')
      const agent = agents.find(a => a.role === args.agent_role)
      const body = {
        agent_id:   agent?.id ?? null,
        title:      args.title,
        description: args.description,
        status:     args.depends_on_subtask_id ? 'blocked' : 'pending',
        depends_on: args.depends_on_subtask_id ?? null,
      }
      const subtask = await api('POST', `/tasks/${args.task_id}/subtasks`, body)
      return { success: true, subtask_id: subtask.id, agent: agent?.name ?? null }
    }

    case 'skip_subtask': {
      await api('PUT', `/subtasks/${args.subtask_id}`, {
        status: 'completed',
        output: `[Pulada pelo Oracle] ${args.reason}`,
      })
      return { success: true }
    }

    default:
      return { error: `Tool desconhecida: ${name}` }
  }
}

// ─── MCP Protocol (Content-Length framing, stdio) ─────────────────

let buf = Buffer.alloc(0)

function send(msg) {
  const body = JSON.stringify(msg)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
}

async function dispatch(msg) {
  const { id, method, params } = msg

  // Notifications: no response needed
  if (!method || method.startsWith('notifications/')) return

  let result, error

  try {
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'ai-proxy-mcp', version: '1.0.0' },
        }
        break

      case 'tools/list':
        result = { tools: TOOLS }
        break

      case 'tools/call':
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify(await callTool(params.name, params.arguments ?? {}), null, 2),
          }],
        }
        break

      default:
        error = { code: -32601, message: `Método desconhecido: ${method}` }
    }
  } catch (err) {
    error = { code: -32000, message: err.message }
  }

  if (id != null) {
    send(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })
  }
}

process.stdin.on('data', async chunk => {
  buf = Buffer.concat([buf, chunk])

  while (true) {
    const sep = buf.indexOf('\r\n\r\n')
    if (sep === -1) break

    const header = buf.slice(0, sep).toString('utf8')
    const match  = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) { buf = buf.slice(sep + 4); continue }

    const len   = parseInt(match[1], 10)
    const start = sep + 4

    if (buf.length < start + len) break

    const body = buf.slice(start, start + len).toString('utf8')
    buf = buf.slice(start + len)

    try { await dispatch(JSON.parse(body)) } catch {}
  }
})

process.stdin.resume()
process.on('SIGINT', () => process.exit(0))

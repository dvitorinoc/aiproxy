import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadMcpServers() {
  try {
    return JSON.parse(readFileSync(join(__dirname, 'mcp-servers.json'), 'utf8'))
  } catch {
    return []
  }
}

export default {
  port: +process.env.AI_PROXY_PORT || 9090,

  path: {
    nvmNode:  process.env.AI_PROXY_NVM_NODE  || '',
    localBin: process.env.AI_PROXY_LOCAL_BIN || '',
  },

  timeouts: {
    claude: +process.env.AI_PROXY_TIMEOUT_CLAUDE || 180_000,
    gemini: +process.env.AI_PROXY_TIMEOUT_GEMINI || 180_000,
    codex:  +process.env.AI_PROXY_TIMEOUT_CODEX  || 240_000,
  },

  mcp: {
    maxIterations: +process.env.AI_PROXY_MCP_MAX_ITERATIONS || 6,
    servers: loadMcpServers(),
  },

  webhook: {
    url:    process.env.AI_PROXY_WEBHOOK_URL    || null,
    secret: process.env.AI_PROXY_WEBHOOK_SECRET || null,
  },

  queue: {
    port:           +process.env.AI_PROXY_QUEUE_PORT           || 9091,
    maxConcurrent:  +process.env.AI_PROXY_QUEUE_MAX_CONCURRENT || 3,
    maxQueueSize:   +process.env.AI_PROXY_QUEUE_MAX_SIZE       || 50,
    jobTimeoutMs:   +process.env.AI_PROXY_QUEUE_JOB_TIMEOUT    || 300_000,
    pollMs:         +process.env.AI_PROXY_QUEUE_POLL_MS        || 1_000,
    dbPath:          process.env.AI_PROXY_QUEUE_DB_PATH        || './queue.db',
    cleanupAfterMs: +process.env.AI_PROXY_QUEUE_CLEANUP_AFTER  || 24 * 60 * 60 * 1_000,
  },
}

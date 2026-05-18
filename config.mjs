// AI Proxy — configurações centralizadas

export default {
  // Porta HTTP do proxy
  port: 9090,

  // Diretórios adicionados ao PATH ao invocar CLIs de IA
  path: {
    nvmNode:  '/home/douglas/.nvm/versions/node/v24.15.0/bin',
    localBin: '/home/douglas/.local/bin',
  },

  // Timeouts de execução por provider (ms)
  timeouts: {
    claude: 180_000,
    gemini: 180_000,
    codex:  240_000,
  },

  // Loop de ferramentas MCP
  mcp: {
    maxIterations: 6,

    // Servidores MCP externos (stdio). Cada entrada spawna um processo separado.
    // O proxy descobre as ferramentas via tools/list e roteia tool_calls automaticamente.
    // Exemplo:
    //   { name: 'meu-projeto', command: 'node', args: ['../meu-projeto/mcp-server.mjs'] }
    servers: [],
  },

  // Webhook: notifica a aplicação consumidora sobre eventos da fila
  // Eventos emitidos: job.started | job.completed | job.failed
  webhook: {
    url:    null,   // POST para esta URL em cada evento (null = desabilitado)
    secret: null,   // HMAC-SHA256 secret — inclui X-Webhook-Signature no header
  },

  // Fila de execução (daemon separado)
  queue: {
    port:           9091,
    maxConcurrent:  3,
    maxQueueSize:   50,           // 0 = ilimitado
    jobTimeoutMs:   300_000,
    pollMs:         1_000,
    dbPath:         './queue.db',
    cleanupAfterMs: 24 * 60 * 60 * 1_000,
  },
}

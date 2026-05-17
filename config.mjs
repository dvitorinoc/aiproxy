// AI Proxy — configurações centralizadas

export default {
  // Porta HTTP do proxy
  port: 9090,

  // URL base da API Laravel (usada pelas ferramentas MCP e pelo poll SSE)
  laravelApi: 'http://localhost:8000/api',

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

  // SSE: intervalo de poll da API Laravel para broadcast ao frontend (ms)
  ssePollMs: 1_000,
}

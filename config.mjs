// AutoForge AI Proxy — configurações centralizadas

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
    // ask_user: intervalo de poll e timeout máximo de espera por resposta humana
    askUser: {
      pollMs:    3_000,
      timeoutMs: 4 * 60 * 60 * 1_000,
    },
  },

  // SSE: intervalo de poll da API Laravel para broadcast ao frontend (ms)
  ssePollMs: 1_000,
}

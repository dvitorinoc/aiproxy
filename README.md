# AI Proxy

Serviço intermediário que unifica o acesso a múltiplos provedores de IA (Claude, Gemini, Codex) através de uma API REST. Suporta conversas multi-turn, execução de ferramentas via MCP, fila de execução persistente e eventos em tempo real via SSE.

---

## Requisitos

- **Node.js 22+** (utiliza `node:sqlite` nativo para persistência da fila)
- CLIs dos providers desejados instaladas e disponíveis no PATH:
  - [Claude CLI](https://docs.anthropic.com/claude/docs/claude-cli)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [Codex CLI](https://github.com/openai/codex)

---

## Inicialização

O AI Proxy é composto por dois processos independentes:

| Processo | Porta | Descrição |
| :--- | :--- | :--- |
| **HTTP Server** | `9090` | Recebe requisições, roteamento, SSE |
| **Queue Daemon** | `9091` | Executa prompts, controla concorrência, persiste jobs |

**Iniciar ambos em background (recomendado):**

```bash
npm run start:all   # inicia server + queue desanexados do terminal
npm run stop:all    # encerra ambos
```

Os processos ficam desanexados do terminal — sobrevivem ao fechar o shell. Logs gravados em:
- `logs/server.log`
- `logs/queue.log`

**Iniciar individualmente (foreground):**

```bash
npm start           # só o HTTP server
npm run queue       # só o daemon da fila
npm run dev         # ambos com --watch (reload automático)
```

---

## Arquitetura

```
HTTP Server (:9090)                Queue Daemon (:9091)
┌─────────────────────────┐        ┌──────────────────────────────┐
│  middleware              │        │  worker (semáforo + FIFO)    │
│    cors / logger         │        │    max_concurrent: 3         │
│    body-parser           │        │                              │
│    error-handler         │  HTTP  │  store (SQLite)              │
│                          │◄──────►│    jobs: pending/running/    │
│  controllers             │        │          completed/failed    │
│    run     → run.service │        │                              │
│    events  → broadcaster │        │  providers                   │
│    providers             │        │    claude / gemini / codex   │
│    health                │        │                              │
└─────────────────────────┘        │  MCP client (stdio)          │
                                    │    carrega servidores MCP    │
                                    └──────────────────────────────┘
```

**Fluxo de uma requisição:**
```
POST /run → run.controller → run.service
  → queue/client: POST :9091/execute   (submete job, recebe job_id)
  → queue/client: GET  :9091/result/:id (poll até completar)
  ← { output, usage }
← json 200
```

### Estrutura de arquivos

```
src/
  utils/          env, spawn, path, prompt, parse, errors
  providers/      claude, gemini, codex + index (wrapProvider)
  mcp/            client (stdio), loop (XML tool-call)
  sse/            broadcaster
  http/
    middleware/   cors, body-parser, logger, error-handler
    controllers/  run, providers, events, health
    router.mjs    roteamento
    routes.mjs    registro de rotas
  services/       run.service, providers.service
  queue/
    daemon.mjs    processo standalone (HTTP :9091)
    worker.mjs    semáforo + execução de jobs
    store.mjs     persistência SQLite
    client.mjs    submit + poll (usado pelo run.service)
```

---

## Sumário de Endpoints — HTTP Server (:9090)

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/run` | Executa um prompt em um provider de IA |
| `GET` | `/providers` | Lista quais CLIs estão disponíveis no sistema |
| `GET` | `/events` | Stream SSE de eventos em tempo real |
| `GET` | `/health` | Status do proxy e modelos sugeridos |

---

## Endpoints

### `POST /run`

Envia um prompt a um provider. A execução é enfileirada no daemon — a requisição HTTP fica aberta até o job completar.

**Corpo da requisição**

| Campo | Tipo | Obrigatório | Descrição |
| :--- | :--- | :---: | :--- |
| `provider` | string | | `claude` (padrão), `gemini` ou `codex` |
| `model` | string | | Modelo específico (ex: `claude-sonnet-4-6`) |
| `system_prompt` | string | | Instruções de sistema para o modelo |
| `content` | string | ✓ | Mensagem atual do usuário |
| `messages` | array | | Histórico da conversa — veja [Sessions](#sessions-conversas-multi-turn) |
| `use_mcp` | boolean | | Ativa o loop de ferramentas MCP (padrão: `false`) |
| `cwd` | string | | Diretório de trabalho para acesso ao filesystem |

**Resposta de sucesso — `200 OK`**

```json
{
  "provider": "claude",
  "model": "claude-sonnet-4-6",
  "output": "Resposta gerada pelo modelo...",
  "usage": {
    "input_tokens": 312,
    "output_tokens": 87,
    "total_tokens": 399,
    "cached_tokens": null,
    "reasoning_tokens": null,
    "request_count": 1,
    "source": "provider"
  }
}
```

**Exemplo mínimo**

```bash
curl -X POST http://localhost:9090/run \
     -H "Content-Type: application/json" \
     -d '{
       "provider": "claude",
       "system_prompt": "You are a helpful assistant.",
       "content": "What is a closure in JavaScript?"
     }'
```

---

### `GET /providers`

Verifica quais CLIs estão instaladas no PATH. Não spawna processos.

**Resposta — `200 OK`**

```json
{
  "providers": {
    "claude": { "available": true },
    "gemini": { "available": true },
    "codex":  { "available": false }
  }
}
```

---

### `GET /events`

Stream SSE. O proxy consulta a API backend a cada `ssePollMs` ms e emite `event: update` quando o estado muda.

```js
const es = new EventSource('http://localhost:9090/events')
es.addEventListener('update', e => {
  const data = JSON.parse(e.data)
})
```

---

### `GET /health`

```json
{
  "ok": true,
  "providers": ["claude", "gemini", "codex"],
  "suggested_models": {
    "claude": ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-7"],
    "gemini": ["", "gemini-2.5-pro", "gemini-2.5-flash"],
    "codex":  ["", "gpt-5.4", "o3", "gpt-4o"]
  },
  "port": 9090
}
```

---

## Respostas de Erro

| Status | Corpo | Quando ocorre |
| :--- | :--- | :--- |
| `400` | `{ "error": "..." }` | Provider inválido, `content` ausente ou JSON malformado |
| `500` | `{ "error": "..." }` | Falha inesperada na execução |
| `503` | `{ "error": "provider_unavailable", "provider": "..." }` | Binário do provider não encontrado no PATH |
| `503` | `{ "error": "queue_full" }` | Fila atingiu `maxQueueSize` |
| `503` | `{ "error": "queue_timeout" }` | Job excedeu `jobTimeoutMs` aguardando na fila |
| `503` | `{ "error": "queue_unavailable" }` | Daemon da fila não está rodando |

---

## Fila de Execução

O daemon controla quantos prompts rodam simultaneamente e persiste os jobs em SQLite. Em caso de crash, jobs pendentes são re-enfileirados automaticamente no próximo startup.

### API do Daemon (:9091)

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/execute` | Submete job (idempotente por `job_id`) → `202` |
| `GET` | `/result/:id` | Consulta resultado — `200` (done) ou `202` (aguardando) |
| `GET` | `/status` | Jobs em execução, na fila e limite de concorrência |
| `GET` | `/health` | Confirma que o daemon está vivo |

### Estados de um job

```
pending → running → completed
                 ↘ failed
```

Jobs interrompidos por crash voltam para `pending` automaticamente.

### Ciclo de vida com crash recovery

```
1. Job submetido → status: pending (gravado em SQLite)
2. Slot disponível → status: running
3. Provider executa
4. Concluído → status: completed + resultado gravado
   Erro      → status: failed   + erro gravado

Em caso de crash durante running:
  próximo startup → todos running → pending → re-executados
```

---

## Sessions (Conversas Multi-turn)

O proxy é **stateless**: não armazena histórico. O cliente mantém e envia o histórico completo a cada turno via `messages`.

### Formato

```json
"messages": [
  { "role": "user",      "content": "What is the capital of France?" },
  { "role": "assistant", "content": "The capital of France is Paris." },
  { "role": "user",      "content": "And Germany?" }
]
```

O campo `content` da requisição é a nova mensagem e **não** deve constar em `messages`.

### Como o prompt é montado

```
[INSTRUÇÕES DO SISTEMA]
<system_prompt>

[HISTÓRICO DA CONVERSA]
Usuário:
<messages[0].content>

Assistente:
<messages[1].content>
...

[NOVA MENSAGEM DO USUÁRIO]
<content>
```

**Claude** recebe `system_prompt` via flag `--system-prompt` separada; histórico + mensagem chegam via stdin.  
**Gemini e Codex** recebem tudo mesclado em um único bloco via stdin.

Todos os providers usam `spawn` sem shell — sem limite de tamanho (ARG_MAX) e sem escaping.

---

## Loop de Ferramentas MCP

Quando `use_mcp: true`, o proxy injeta as definições das ferramentas no system prompt e entra em loop (máx. `mcp.maxIterations`). O modelo sinaliza chamadas com XML:

```xml
<tool_call>
<name>nome_da_ferramenta</name>
<args>{"param": "valor"}</args>
</tool_call>
```

O proxy executa a ferramenta via MCP server externo, devolve o resultado e repete até o modelo responder sem `<tool_call>`.

### Plugar um servidor MCP externo

Servidores MCP são processos independentes que comunicam via stdio (JSON-RPC 2.0 + Content-Length framing). O proxy os descobre automaticamente via `tools/list` no startup.

**`config.mjs`:**

```js
mcp: {
  servers: [
    { name: 'meu-projeto', command: 'node', args: ['../meu-projeto/mcp-server.mjs'] }
  ]
}
```

O arquivo `mcp-server.mjs` na raiz do repositório é um **template** com a implementação do protocolo — copie-o para o seu projeto, defina as ferramentas em `TOOLS` e implemente os handlers em `callTool()`.

---

## Configuração

Todas as opções ficam em `config.mjs`:

| Chave | Padrão | Descrição |
| :--- | :--- | :--- |
| `port` | `9090` | Porta HTTP do proxy |
| `laravelApi` | `http://localhost:8000/api` | URL base da API backend (SSE + MCP) |
| `path.nvmNode` | `~/.nvm/…/bin` | Diretório de binários do Node (nvm) |
| `path.localBin` | `~/.local/bin` | Diretório de binários locais |
| `timeouts.claude` | `180000` | Timeout de execução do Claude (ms) |
| `timeouts.gemini` | `180000` | Timeout de execução do Gemini (ms) |
| `timeouts.codex` | `240000` | Timeout de execução do Codex (ms) |
| `mcp.maxIterations` | `6` | Máximo de iterações do loop MCP |
| `mcp.servers` | `[]` | Servidores MCP externos a conectar no startup |
| `ssePollMs` | `1000` | Intervalo de poll SSE (ms) |
| `queue.port` | `9091` | Porta HTTP do daemon da fila |
| `queue.maxConcurrent` | `3` | Máximo de prompts executando simultaneamente |
| `queue.maxQueueSize` | `50` | Máximo de jobs aguardando (`0` = ilimitado) |
| `queue.jobTimeoutMs` | `300000` | Timeout máximo de espera por job (ms) |
| `queue.dbPath` | `./queue.db` | Caminho do arquivo SQLite da fila |
| `queue.cleanupAfterMs` | `86400000` | Tempo para remover jobs concluídos (ms) |

# AI Proxy

Serviço intermediário que unifica o acesso a múltiplos provedores de IA (Claude, Gemini, Codex) através de uma API REST. Suporta conversas multi-turn, execução de ferramentas via MCP, fila de execução persistente e notificações via webhook.

---

## Requisitos

- **Node.js 22+** (utiliza `node:sqlite` nativo para persistência da fila)
- CLIs dos providers desejados instaladas e disponíveis no PATH:
  - [Claude CLI](https://docs.anthropic.com/claude/docs/claude-cli)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [Codex CLI](https://github.com/openai/codex)

---

## Configuração

### 1. Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste para o seu ambiente:

```bash
cp .env.example .env
```

As variáveis essenciais são os caminhos de binários do Node no seu sistema:

```env
AI_PROXY_NVM_NODE=/home/<user>/.nvm/versions/node/<version>/bin
AI_PROXY_LOCAL_BIN=/home/<user>/.local/bin
```

Todas as demais variáveis têm valores padrão e são opcionais. Consulte `.env.example` para a lista completa.

### 2. Servidores MCP (opcional)

Copie `mcp-servers.json.example` para `mcp-servers.json` e declare os servidores MCP que o proxy deve carregar no startup:

```bash
cp mcp-servers.json.example mcp-servers.json
```

```json
[
  {
    "name": "meu-projeto",
    "command": "node",
    "args": ["../meu-projeto/mcp/server.mjs"],
    "env": {
      "MY_API_URL": "http://localhost:8000/api"
    }
  }
]
```

Se o arquivo não existir, o proxy inicia normalmente sem servidores MCP.

---

## Inicialização

O AI Proxy é composto por dois processos independentes:

| Processo | Porta | Descrição |
| :--- | :--- | :--- |
| **HTTP Server** | `9090` | Recebe requisições e roteamento |
| **Queue Daemon** | `9091` | Executa prompts, controla concorrência, persiste jobs |

**Iniciar ambos em background (recomendado):**

```bash
npm run start:all   # inicia server + queue desanexados do terminal
npm run stop:all    # encerra ambos
```

Logs gravados em `logs/server.log` e `logs/queue.log`.

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
│    body-parser           │  HTTP  │                              │
│    error-handler         │◄──────►│  store (SQLite)              │
│                          │        │    pending/running/          │
│  controllers             │        │    completed/failed          │
│    run  → run.service    │        │                              │
│    providers             │        │  providers                   │
│    health                │        │    claude / gemini / codex   │
└─────────────────────────┘        │                              │
                                    │  MCP client (stdio)          │
           Webhook                  │    carrega mcp-servers.json  │
           job.started  ───────────►│                              │
           job.completed            └──────────────────────────────┘
           job.failed
```

**Fluxo de uma requisição:**
```
POST /run → run.controller → run.service
  → queue/client: POST :9091/execute    (submete job)
  → queue/client: GET  :9091/result/:id (poll até completar)
  ← { output, usage }
← json 200
```

### Estrutura de arquivos

```
.env                    ← variáveis de ambiente (ignorado pelo git)
.env.example            ← template
mcp-servers.json        ← servidores MCP a carregar (ignorado pelo git)
mcp-servers.json.example ← template
config.mjs              ← lê process.env e mcp-servers.json
scripts/
  start.sh              ← inicia ambos os processos em background
  stop.sh               ← encerra pelo .pids
src/
  utils/                env, spawn, path, prompt, parse, errors
  providers/            claude, gemini, codex + index (wrapProvider)
  mcp/                  client (stdio), loop (XML tool-call)
  webhook/              emitter.mjs
  http/
    middleware/         cors, body-parser, logger, error-handler
    controllers/        run, providers, health
    router.mjs
    routes.mjs
  services/             run.service, providers.service
  queue/
    daemon.mjs          processo standalone (HTTP :9091)
    worker.mjs          semáforo + execução + emissão de webhooks
    store.mjs           persistência SQLite
    client.mjs          submit + poll
```

---

## Sumário de Endpoints — HTTP Server (:9090)

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/run` | Executa um prompt em um provider de IA |
| `GET` | `/providers` | Lista quais CLIs estão disponíveis no sistema |
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
| `503` | `{ "error": "queue_full" }` | Fila atingiu `AI_PROXY_QUEUE_MAX_SIZE` |
| `503` | `{ "error": "queue_timeout" }` | Job excedeu `AI_PROXY_QUEUE_JOB_TIMEOUT` |
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

### Ciclo de vida de um job

```
pending → running → completed
                 ↘ failed
```

Jobs com status `running` interrompidos por crash são resetados para `pending` automaticamente.

---

## Webhook

O proxy emite eventos HTTP para a URL configurada em `AI_PROXY_WEBHOOK_URL` a cada transição de estado de job. A aplicação consumidora recebe os eventos e decide o que fazer (atualizar frontend, persistir, disparar ações).

### Eventos

| Evento | Quando |
| :--- | :--- |
| `job.started` | Job entra em execução |
| `job.completed` | Job concluído com sucesso |
| `job.failed` | Job falhou (provider indisponível, erro de execução, fila cheia) |

### Formato do payload

```json
{
  "event": "job.completed",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "provider": "claude",
  "output": "Resposta do modelo...",
  "usage": { "input_tokens": 100, "output_tokens": 50 },
  "timestamp": 1716000000000
}
```

### Assinatura HMAC (opcional)

Quando `AI_PROXY_WEBHOOK_SECRET` está configurado, cada requisição inclui o header:

```
X-Webhook-Signature: sha256=<hmac-sha256 do body>
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

Quando `use_mcp: true`, o proxy injeta as definições das ferramentas no system prompt e entra em loop (máx. `AI_PROXY_MCP_MAX_ITERATIONS`). O modelo sinaliza chamadas com XML:

```xml
<tool_call>
<name>nome_da_ferramenta</name>
<args>{"param": "valor"}</args>
</tool_call>
```

O proxy executa a ferramenta via servidor MCP externo, devolve o resultado e repete até o modelo responder sem `<tool_call>`.

### Plugar um servidor MCP externo

Servidores MCP são processos independentes que comunicam via stdio (JSON-RPC 2.0 + Content-Length framing). O proxy os descobre via `tools/list` no startup e roteia `tool_calls` automaticamente.

Configure em `mcp-servers.json`:

```json
[
  {
    "name": "meu-projeto",
    "command": "node",
    "args": ["../meu-projeto/mcp/server.mjs"],
    "env": { "MY_API_URL": "http://localhost:8000/api" }
  }
]
```

O arquivo `mcp-server.mjs` na raiz é um **template** — copie para o seu projeto, defina as ferramentas em `TOOLS` e implemente os handlers em `callTool()`.

---

## Referência de Configuração

Todas as opções são definidas via variáveis de ambiente (`.env`):

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `AI_PROXY_PORT` | `9090` | Porta HTTP do proxy |
| `AI_PROXY_NVM_NODE` | `''` | Diretório de binários do Node (nvm) |
| `AI_PROXY_LOCAL_BIN` | `''` | Diretório de binários locais |
| `AI_PROXY_TIMEOUT_CLAUDE` | `180000` | Timeout de execução do Claude (ms) |
| `AI_PROXY_TIMEOUT_GEMINI` | `180000` | Timeout de execução do Gemini (ms) |
| `AI_PROXY_TIMEOUT_CODEX` | `240000` | Timeout de execução do Codex (ms) |
| `AI_PROXY_MCP_MAX_ITERATIONS` | `6` | Máximo de iterações do loop MCP |
| `AI_PROXY_WEBHOOK_URL` | `''` | URL para receber eventos da fila (vazio = desabilitado) |
| `AI_PROXY_WEBHOOK_SECRET` | `''` | Secret HMAC-SHA256 para assinar webhooks |
| `AI_PROXY_QUEUE_PORT` | `9091` | Porta HTTP do daemon da fila |
| `AI_PROXY_QUEUE_MAX_CONCURRENT` | `3` | Máximo de prompts executando simultaneamente |
| `AI_PROXY_QUEUE_MAX_SIZE` | `50` | Máximo de jobs aguardando (`0` = ilimitado) |
| `AI_PROXY_QUEUE_JOB_TIMEOUT` | `300000` | Timeout máximo de espera por job (ms) |
| `AI_PROXY_QUEUE_POLL_MS` | `1000` | Intervalo de poll do client para o daemon (ms) |
| `AI_PROXY_QUEUE_DB_PATH` | `./queue.db` | Caminho do arquivo SQLite da fila |
| `AI_PROXY_QUEUE_CLEANUP_AFTER` | `86400000` | Tempo para remover jobs concluídos (ms) |

Servidores MCP são configurados em `mcp-servers.json` (ver `.env.example` e `mcp-servers.json.example`).

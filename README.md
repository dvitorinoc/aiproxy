# AI Proxy

Serviço intermediário que unifica o acesso a múltiplos provedores de IA (Claude, Gemini, Codex) através de uma API REST. Suporta conversas multi-turn, execução de ferramentas via MCP e eventos em tempo real via SSE.

---

## Requisitos

- Node.js 18+
- CLIs dos providers desejados instaladas e disponíveis no PATH:
  - [Claude CLI](https://docs.anthropic.com/claude/docs/claude-cli)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [Codex CLI](https://github.com/openai/codex)

## Instalação e uso

```bash
npm start        # porta padrão 9090
npm run dev      # com reload automático
```

A porta e demais configurações podem ser ajustadas em `config.mjs`.

---

## Sumário de Endpoints

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/run` | Executa um prompt em um provider de IA |
| `GET` | `/providers` | Lista quais CLIs estão disponíveis no sistema |
| `GET` | `/events` | Stream SSE de eventos em tempo real |
| `GET` | `/health` | Status do proxy e modelos sugeridos |

---

## Endpoints

### `POST /run`

Envia um prompt a um provider e retorna a resposta gerada.

**Corpo da requisição**

| Campo | Tipo | Obrigatório | Descrição |
| :--- | :--- | :---: | :--- |
| `provider` | string | | `claude` (padrão), `gemini` ou `codex` |
| `model` | string | | Modelo específico do provider (ex: `claude-sonnet-4-6`) |
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

Verifica quais CLIs de IA estão instaladas e disponíveis no PATH. Não spawna processos — consulta o PATH diretamente.

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

Stream SSE que emite `event: update` sempre que o estado do backend muda. O proxy consulta a URL configurada em `config.mjs` (`laravelApi`) a cada `ssePollMs` milissegundos.

**Conectar:**

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
| `400` | `{ "error": "Provider inválido: xyz" }` | Provider desconhecido ou `content` ausente |
| `500` | `{ "error": "<mensagem de erro>" }` | Falha na execução do CLI |
| `503` | `{ "error": "provider_unavailable", "provider": "gemini" }` | Binário do provider não encontrado no PATH |

---

## Sessions (Conversas Multi-turn)

O proxy é **stateless**: não armazena histórico entre requisições. O cliente é responsável por manter o histórico e enviá-lo completo a cada turno via `messages`.

### Formato do histórico

```json
"messages": [
  { "role": "user",      "content": "What is the capital of France?" },
  { "role": "assistant", "content": "The capital of France is Paris." },
  { "role": "user",      "content": "And Germany?" }
]
```

Cada objeto tem `role` (`user` ou `assistant`) e `content` (string). O campo `content` da requisição é a **nova mensagem** — não deve ser incluída em `messages`.

### Como o prompt é montado

Internamente, `buildPrompt()` serializa o contexto completo nesta ordem:

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

**Exceção — Claude:** o `system_prompt` é entregue via flag `--system-prompt` separada do restante. O histórico + mensagem atual seguem via stdin. Gemini e Codex recebem tudo mesclado em um único bloco via stdin.

### Entrega via stdin

O proxy usa `spawn` sem shell para todos os providers. O prompt é escrito diretamente no stdin do processo filho, sem passar por argumentos de linha de comando — eliminando limitações de tamanho (ARG_MAX) e problemas de escaping com conteúdo arbitrário.

### Exemplo: conversa de dois turnos

**Turno 1 — sem histórico:**

```bash
curl -X POST http://localhost:9090/run \
     -d '{ "provider": "claude", "content": "My name is Alice." }'
# → "Hello, Alice! How can I help you?"
```

**Turno 2 — com histórico:**

```bash
curl -X POST http://localhost:9090/run \
     -d '{
       "provider": "claude",
       "messages": [
         { "role": "user",      "content": "My name is Alice." },
         { "role": "assistant", "content": "Hello, Alice! How can I help you?" }
       ],
       "content": "What is my name?"
     }'
# → "Your name is Alice."
```

---

## Loop de Ferramentas MCP

Quando `use_mcp: true`, o proxy injeta definições de ferramentas no system prompt e entra em um loop iterativo (máx. configurável em `config.mjs`). O modelo sinaliza chamadas de ferramenta com tags XML na resposta:

```xml
<tool_call>
<name>nome_da_ferramenta</name>
<args>{"param": "valor"}</args>
</tool_call>
```

O proxy executa a ferramenta, devolve o resultado como mensagem do usuário e repete até que o modelo responda sem `<tool_call>`. O mecanismo funciona de forma idêntica para todos os providers.

### Ferramentas built-in

As ferramentas disponíveis por padrão integram com a API backend configurada em `laravelApi`:

| Ferramenta | Descrição | Parâmetros |
| :--- | :--- | :--- |
| `get_task` | Retorna estado completo de uma task com subtasks | `task_id` |
| `list_agents` | Lista agentes disponíveis com slug, nome e status | — |
| `reassign_subtask` | Reatribui uma subtask a outro agente | `subtask_id`, `agent_slug` |
| `update_subtask_instructions` | Atualiza a descrição de uma subtask | `subtask_id`, `description` |
| `add_subtask` | Cria nova subtask, opcionalmente com dependência | `task_id`, `title`, `description`, `agent_slug`, `depends_on_subtask_id?` |
| `skip_subtask` | Marca subtask como concluída sem execução | `subtask_id`, `reason` |
| `update_task_status` | Atualiza o status de uma task | `task_id`, `status` |
| `ask_user` | Pausa execução e aguarda resposta humana (timeout configurável) | `subtask_id`, `question` |

---

## Configuração

Todas as opções ficam em `config.mjs`:

| Chave | Padrão | Descrição |
| :--- | :--- | :--- |
| `port` | `9090` | Porta HTTP do proxy |
| `laravelApi` | `http://localhost:8000/api` | URL base da API backend |
| `path.nvmNode` | `~/.nvm/…/bin` | Diretório de binários do Node (nvm) |
| `path.localBin` | `~/.local/bin` | Diretório de binários locais |
| `timeouts.claude` | `180000` | Timeout de execução do Claude (ms) |
| `timeouts.gemini` | `180000` | Timeout de execução do Gemini (ms) |
| `timeouts.codex` | `240000` | Timeout de execução do Codex (ms) |
| `mcp.maxIterations` | `6` | Máximo de iterações do loop MCP |
| `mcp.askUser.pollMs` | `3000` | Intervalo de poll do `ask_user` (ms) |
| `mcp.askUser.timeoutMs` | `14400000` | Timeout máximo do `ask_user` (ms) |
| `ssePollMs` | `1000` | Intervalo de poll SSE (ms) |

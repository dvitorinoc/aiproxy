# AutoForge AI Proxy

Serviço intermediário que unifica o acesso a múltiplos provedores de IA (Claude, Gemini, Codex) através de uma API REST. Suporta conversas multi-turn, execução de ferramentas via MCP e eventos em tempo real via SSE.

Roda na porta **9090**, fora do Docker, pois invoca CLIs instaladas no host.

---

## Sumário de Endpoints

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/run` | Executa um prompt em um provider de IA |
| `GET` | `/providers` | Lista quais CLIs estão disponíveis no sistema |
| `GET` | `/events` | Stream SSE de tasks e agentes em tempo real |
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
| `messages` | array | | Histórico da conversa — veja [Sessions](#sessions) |
| `use_mcp` | boolean | | Ativa o loop de ferramentas AutoForge (padrão: `false`) |
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
       "system_prompt": "Você é um assistente de desenvolvimento.",
       "content": "Explique o que é uma closure em JavaScript."
     }'
```

---

### `GET /providers`

Verifica quais CLIs de IA estão instaladas e disponíveis no PATH do sistema. Não spawna processos — consulta o PATH diretamente.

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

Use este endpoint para desabilitar seletores de provider não instalados na UI antes de tentar executar.

---

### `GET /events`

Stream SSE que o frontend consome para atualizar o kanban em tempo real. O proxy consulta a API Laravel a cada 1 segundo e emite `event: update` sempre que tasks ou agentes mudam.

**Conectar:**

```js
const es = new EventSource('http://localhost:9090/events')
es.addEventListener('update', e => {
  const { tasks, agents, busy_agents, max_concurrent_agents } = JSON.parse(e.data)
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

O `503` é distinto do `500` para permitir que o backend trate indisponibilidade de provider diferente de erros de execução.

---

## Sessions (Conversas Multi-turn)

O proxy é **stateless**: não armazena histórico entre requisições. O cliente (backend Laravel) é responsável por manter o histórico e enviá-lo completo a cada turno via `messages`.

### Formato do histórico

```json
"messages": [
  { "role": "user",      "content": "Qual é a capital da França?" },
  { "role": "assistant", "content": "A capital da França é Paris." },
  { "role": "user",      "content": "E da Alemanha?" }
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

**Exceção — Claude:** o `system_prompt` é entregue via flag `--system-prompt` separada do restante. O histórico + mensagem atual seguem via stdin. Gemini e Codex recebem tudo mesclado em um único bloco de texto via stdin.

### Todos os providers recebem o prompt via stdin

O proxy usa `spawn` sem shell para todos os providers. O prompt é escrito diretamente no stdin do processo filho, sem passar por argumentos de linha de comando. Isso elimina limitações de tamanho (ARG_MAX) e problemas de escaping com conteúdo arbitrário.

### Exemplo: conversa de dois turnos

**Turno 1 — sem histórico:**

```bash
curl -X POST http://localhost:9090/run \
     -d '{ "provider": "claude", "content": "Meu nome é Douglas." }'
# → "Olá, Douglas! Como posso ajudar?"
```

**Turno 2 — com histórico:**

```bash
curl -X POST http://localhost:9090/run \
     -d '{
       "provider": "claude",
       "messages": [
         { "role": "user",      "content": "Meu nome é Douglas." },
         { "role": "assistant", "content": "Olá, Douglas! Como posso ajudar?" }
       ],
       "content": "Qual é o meu nome?"
     }'
# → "Seu nome é Douglas."
```

---

## Loop de Ferramentas MCP

Quando `use_mcp: true`, o proxy injeta definições de ferramentas no system prompt e entra em um loop iterativo (máx. 6 iterações). O modelo sinaliza chamadas de ferramenta com tags XML na resposta:

```xml
<tool_call>
<name>get_task</name>
<args>{"task_id": 42}</args>
</tool_call>
```

O proxy executa a ferramenta, devolve o resultado como mensagem do usuário e repete até que o modelo responda sem `<tool_call>`.

### Ferramentas disponíveis

| Ferramenta | Descrição | Parâmetros principais |
| :--- | :--- | :--- |
| `get_task` | Estado completo de uma task com suas subtasks | `task_id` |
| `list_agents` | Lista agentes com slug, nome, role e status | — |
| `reassign_subtask` | Muda o agente de uma subtask pendente | `subtask_id`, `agent_slug` |
| `update_subtask_instructions` | Atualiza a descrição de uma subtask | `subtask_id`, `description` |
| `add_subtask` | Cria nova subtask, opcionalmente bloqueada por dependência | `task_id`, `title`, `description`, `agent_slug`, `depends_on_subtask_id?` |
| `skip_subtask` | Marca subtask como concluída sem execução | `subtask_id`, `reason` |
| `update_task_status` | Atualiza o status da task pai | `task_id`, `status` |
| `ask_user` | Pausa execução e aguarda resposta do operador (timeout: 4h) | `subtask_id`, `question` |

O loop MCP funciona de forma idêntica para todos os providers.

---

## Configuração

**Porta:** `9090`

**PATH consultado para binários:**

```
~/.nvm/versions/node/v24.15.0/bin
~/.local/bin
/usr/local/bin
/usr/bin
/bin
```

**API Laravel:** `http://localhost:8000/api` (usada pelas ferramentas MCP e pelo poll SSE)

**Iniciar:**

```bash
node ai-proxy/server.mjs
```

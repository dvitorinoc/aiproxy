# AutoForge AI Proxy

O **AutoForge AI Proxy** é um serviço intermediário que unifica o acesso a múltiplos provedores de IA (Claude, Gemini, Codex) através de uma API REST simples. Ele suporta histórico de conversas (multi-turn), execução de ferramentas via MCP (Model Context Protocol) de forma agnóstica ao provedor e eventos em tempo real via SSE.

## Endpoints

### 1. Executar Prompt (`POST /run`)
Envia uma solicitação para um dos provedores de IA.

**Corpo da Requisição (JSON):**
| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `provider` | string | `claude`, `gemini` ou `codex` (Padrão: `claude`) |
| `model` | string | (Opcional) Nome do modelo específico |
| `system_prompt` | string | Instruções de sistema para o modelo |
| `messages` | array | (Opcional) Histórico da conversa `[{ role, content }]` |
| `content` | string | **Obrigatório.** Conteúdo da nova mensagem |
| `use_mcp` | boolean | (Opcional) Ativa o loop de ferramentas AutoForge (Padrão: `false`) |
| `cwd` | string | (Opcional) Diretório de trabalho para execução local |

**Exemplo de uso:**
```bash
curl -X POST http://localhost:9090/run \
     -H "Content-Type: application/json" \
     -d '{
       "provider": "claude",
       "content": "Olá, quem é você?",
       "system_prompt": "Você é um assistente prestativo."
     }'
```

### 2. Eventos em Tempo Real (`GET /events`)
Interface SSE (Server-Sent Events) para monitorar o estado das tasks e agentes do AutoForge em tempo real. Utilizado principalmente pelo frontend.

### 3. Disponibilidade de Provedores (`GET /providers`)
Consulta quais CLIs de IA estão instaladas e disponíveis no sistema.

**Resposta:**
```json
{
  "providers": {
    "claude": { "available": true },
    "gemini": { "available": false },
    "codex":  { "available": true }
  }
}
```

Útil para o frontend desabilitar seletores de providers não instalados.

### 4. Health Check (`GET /health`)
Retorna o status do proxy e os modelos sugeridos.

---

## Respostas de Erro

| Status | Corpo | Descrição |
| :--- | :--- | :--- |
| `400` | `{ "error": "Provider inválido: xyz" }` | Provider desconhecido ou campo obrigatório ausente |
| `500` | `{ "error": "<mensagem>" }` | Falha genérica durante a execução |
| `503` | `{ "error": "provider_unavailable", "provider": "gemini" }` | CLI do provider não está instalada no sistema |

---

## Funcionalidades Avançadas

### Suporte a Provedores (CLI based)
O proxy interage com as CLIs instaladas no sistema:
- **Claude:** Usa a CLI `claude`.
- **Gemini:** Usa a CLI `gemini`.
- **Codex:** Usa a CLI `codex`.

Todos os providers recebem o prompt via **stdin** (`spawn` sem shell), eliminando limitações de tamanho de argumento e problemas de escaping.

### Loop de Ferramentas (MCP)
Quando `use_mcp: true` é enviado, o proxy injeta automaticamente definições de ferramentas no `system_prompt` e entra em um loop de execução. O modelo pode chamar ferramentas como:
- `get_task` / `update_task_status`
- `list_agents` / `reassign_subtask`
- `add_subtask` / `update_subtask_instructions`
- `ask_user` (Pausa a execução para aguardar entrada humana)

### Multi-turn (Sessions)
Ao enviar o array `messages`, o proxy reconstrói o histórico da conversa antes de enviar ao provedor, permitindo interações contínuas e contextuais.

---

## Configuração Local

O proxy roda por padrão na porta **9090**.

**Dependências de Caminho:**
O serviço está configurado para buscar executáveis nos seguintes caminhos:
- `~/.nvm/versions/node/v24.15.0/bin`
- `~/.local/bin`
- `/usr/local/bin`

**Integração com API Backend:**
O proxy espera que a API do AutoForge esteja rodando em `http://localhost:8000/api` para as operações de MCP.

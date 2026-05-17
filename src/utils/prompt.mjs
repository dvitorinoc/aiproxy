export function buildPrompt(systemPrompt, messages, currentContent) {
  const parts = []

  if (systemPrompt?.trim()) {
    parts.push(`[INSTRUÇÕES DO SISTEMA]\n${systemPrompt.trim()}`)
  }

  if (messages?.length) {
    parts.push('[HISTÓRICO DA CONVERSA]')
    for (const m of messages) {
      const label = m.role === 'user' ? 'Usuário' : 'Assistente'
      parts.push(`${label}:\n${m.content}`)
    }
    parts.push('[NOVA MENSAGEM DO USUÁRIO]')
  }

  parts.push(currentContent?.trim() ?? '')
  return parts.join('\n\n')
}

export function truncateMessages(params, config) {
  const { messages } = params
  const { maxChars, maxMessages } = config.context

  if (!messages || messages.length === 0) return params
  if (maxChars === 0 && maxMessages === 0) return params

  if (maxMessages > 0) {
    const limit = maxMessages * 2
    if (messages.length > limit) {
      messages.splice(0, messages.length - limit)
    }
  }

  if (maxChars > 0) {
    let total = (params.system_prompt?.length ?? 0) + (params.content?.length ?? 0)
    for (const m of messages) total += m.content?.length ?? 0

    while (total > maxChars && messages.length >= 2) {
      const [a, b] = messages.splice(0, 2)
      total -= (a.content?.length ?? 0) + (b.content?.length ?? 0)
    }
  }

  return params
}

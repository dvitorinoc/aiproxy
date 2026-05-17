import { buildToolPrompt, callTool } from './client.mjs'
import { emptyUsage, mergeUsage }    from '../utils/parse.mjs'
import config                        from '../../config.mjs'

export function parseToolCalls(text) {
  const calls = []
  const re    = /<tool_call>\s*<name>([\w]+)<\/name>\s*<args>([\s\S]*?)<\/args>\s*<\/tool_call>/g
  let m
  while ((m = re.exec(text)) !== null) {
    try { calls.push({ name: m[1].trim(), args: JSON.parse(m[2].trim()) }) } catch {}
  }
  return calls
}

export async function runMcpLoop(rawCall, systemPrompt, messages, content, model, cwd) {
  const toolPrompt   = buildToolPrompt()
  const sysWithTools = [systemPrompt?.trim(), toolPrompt].filter(Boolean).join('\n\n')
  let loopMessages   = [...(messages ?? [])]
  let loopContent    = content
  const MAX_ITER     = config.mcp.maxIterations
  let cumulativeUsage = { ...emptyUsage(), request_count: 0 }

  for (let i = 0; i < MAX_ITER; i++) {
    const result = await rawCall(sysWithTools, loopMessages, loopContent, model, cwd)
    cumulativeUsage = mergeUsage(cumulativeUsage, result?.usage ?? emptyUsage())
    const output = result?.output ?? ''
    const calls  = parseToolCalls(output)

    if (!calls.length) return { output, usage: cumulativeUsage }

    console.log(`   [MCP] iter ${i + 1} — ${calls.map(c => c.name).join(', ')}`)

    const results    = await Promise.all(calls.map(c => callTool(c.name, c.args)))
    const resultText = calls.map((c, idx) =>
      `<tool_result><name>${c.name}</name><result>${JSON.stringify(results[idx])}</result></tool_result>`
    ).join('\n')

    loopMessages = [
      ...loopMessages,
      { role: 'user',      content: loopContent },
      { role: 'assistant', content: output },
    ]
    loopContent = `Resultados das ferramentas:\n${resultText}\n\nContinue com sua análise. Se terminou, responda sem usar <tool_call>.`
  }

  return { output: '[MCP] Limite de iterações atingido.', usage: cumulativeUsage }
}

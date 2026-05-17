import { runMcpLoop } from '../mcp/loop.mjs'
import claudeRaw     from './claude.mjs'
import geminiRaw     from './gemini.mjs'
import codexRaw      from './codex.mjs'

function wrapProvider(raw) {
  return {
    raw,
    call: (systemPrompt, messages, content, model, useMcp, cwd) => {
      if (useMcp) return runMcpLoop(
        (sp, msgs, c, m, wd) => raw(sp, msgs, c, m, wd),
        systemPrompt, messages, content, model, cwd
      )
      return raw(systemPrompt, messages, content, model, cwd)
    },
  }
}

export const PROVIDERS = {
  claude: wrapProvider(claudeRaw),
  gemini: wrapProvider(geminiRaw),
  codex:  wrapProvider(codexRaw),
}

export const SUGGESTED_MODELS = {
  claude: ['sonnet', 'opus', 'haiku', 'claude-sonnet-4-6', 'claude-opus-4-7'],
  gemini: ['', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro'],
  codex:  ['', 'gpt-5.4', 'o3', 'gpt-4o'],
}

export const PROVIDER_BINARY = { claude: 'claude', gemini: 'gemini', codex: 'codex' }

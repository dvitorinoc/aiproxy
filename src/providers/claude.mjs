import { spawnWithStdin }      from '../utils/spawn.mjs'
import { resolveExecCwd }      from '../utils/path.mjs'
import { buildPrompt }         from '../utils/prompt.mjs'
import { parseProviderPayload } from '../utils/parse.mjs'
import { ENV }                 from '../utils/env.mjs'
import config                  from '../../config.mjs'

function workspaceArgs(cwd) {
  const execCwd = resolveExecCwd(cwd)
  return execCwd ? ['--add-dir', execCwd] : []
}

export default async function raw(systemPrompt, messages, content, model, cwd) {
  const userContent = buildPrompt(null, messages, content)
  const execCwd     = resolveExecCwd(cwd)
  const args        = []
  if (model)                args.push('--model', model)
  if (systemPrompt?.trim()) args.push('--system-prompt', systemPrompt.trim())
  args.push(...workspaceArgs(cwd))
  args.push('--print', '--output-format', 'json')

  const { stdout } = await spawnWithStdin(
    'claude', args,
    { cwd: execCwd, env: ENV, timeout: config.timeouts.claude },
    userContent
  )
  return parseProviderPayload('claude', stdout)
}

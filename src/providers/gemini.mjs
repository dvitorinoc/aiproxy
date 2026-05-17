import { join }               from 'path'
import { spawnWithStdin }      from '../utils/spawn.mjs'
import { resolveExecCwd }      from '../utils/path.mjs'
import { buildPrompt }         from '../utils/prompt.mjs'
import { parseProviderPayload } from '../utils/parse.mjs'
import { ENV, PROXY_ROOT }     from '../utils/env.mjs'
import config                  from '../../config.mjs'

function workspaceArgs(cwd) {
  const execCwd = resolveExecCwd(cwd)
  const baseDir = join(PROXY_ROOT, '..')
  const args    = ['--include-directories', baseDir, '--skip-trust', '--approval-mode', 'yolo']
  if (execCwd) args.push('--include-directories', execCwd)
  return args
}

export default async function raw(systemPrompt, messages, content, model, cwd) {
  const prompt  = buildPrompt(systemPrompt, messages, content)
  const execCwd = resolveExecCwd(cwd)
  const args    = []
  if (model) args.push('-m', model)
  args.push(...workspaceArgs(cwd))
  args.push('-o', 'json')

  const { stdout } = await spawnWithStdin(
    'gemini', args,
    { cwd: execCwd, env: ENV, timeout: config.timeouts.gemini },
    prompt
  )
  return parseProviderPayload('gemini', stdout.replace(/Ripgrep is not available.*\n/g, '').trim())
}

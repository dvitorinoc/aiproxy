import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join }               from 'path'
import { tmpdir }             from 'os'
import { spawnWithStdin }      from '../utils/spawn.mjs'
import { resolveExecCwd }      from '../utils/path.mjs'
import { buildPrompt }         from '../utils/prompt.mjs'
import { parseProviderPayload } from '../utils/parse.mjs'
import { ENV }                 from '../utils/env.mjs'
import config                  from '../../config.mjs'

function workspaceArgs(cwd) {
  const execCwd = resolveExecCwd(cwd)
  if (!execCwd) return []
  return ['--cd', execCwd, '--add-dir', execCwd]
}

export default async function raw(systemPrompt, messages, content, model, cwd) {
  const prompt     = buildPrompt(systemPrompt, messages, content)
  const execCwd    = resolveExecCwd(cwd)
  const tempDir    = mkdtempSync(join(tmpdir(), 'ai-proxy-codex-'))
  const outputFile = join(tempDir, 'last-message.txt')
  try {
    const args = ['exec']
    if (model) args.push('-m', model)
    args.push(...workspaceArgs(cwd))
    args.push('--json', '-o', outputFile)

    const { stdout } = await spawnWithStdin(
      'codex', args,
      { cwd: execCwd, env: ENV, timeout: config.timeouts.codex },
      prompt
    )
    let finalOutput = ''
    try { finalOutput = readFileSync(outputFile, 'utf8').trim() } catch {}
    return parseProviderPayload('codex', stdout, finalOutput)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

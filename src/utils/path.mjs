import { statSync } from 'fs'
import { join } from 'path'
import { FULL_PATH } from './env.mjs'

export function resolveExecCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return undefined
  try {
    return statSync(cwd).isDirectory() ? cwd : undefined
  } catch {
    return undefined
  }
}

export function isBinaryAvailable(name) {
  for (const dir of FULL_PATH.split(':')) {
    try { statSync(join(dir, name)); return true } catch {}
  }
  return false
}

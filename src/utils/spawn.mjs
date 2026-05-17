import { spawn } from 'child_process'

export function spawnWithStdin(bin, args, opts, stdinData) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', code => {
      if (code !== 0) {
        const msg = (stderr || stdout).slice(0, 500)
        reject(new Error(`Command failed (exit ${code}): ${msg}`))
      } else {
        resolve({ stdout, stderr })
      }
    })
    child.on('error', reject)
    if (stdinData) child.stdin.write(stdinData, 'utf8')
    child.stdin.end()
  })
}

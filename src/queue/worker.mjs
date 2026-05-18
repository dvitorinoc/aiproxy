import { PROVIDERS }     from '../providers/index.mjs'
import { loadMcpServers } from '../mcp/client.mjs'
import * as store         from './store.mjs'
import { emit }           from '../webhook/emitter.mjs'
import config             from '../../config.mjs'

let running = 0
const waiters = []

function acquireSlot() {
  return new Promise(resolve => {
    if (running < config.queue.maxConcurrent) {
      running++
      resolve(true)
    } else if (!config.queue.maxQueueSize || waiters.length < config.queue.maxQueueSize) {
      waiters.push(resolve)
    } else {
      resolve(false) // queue full
    }
  })
}

function releaseSlot() {
  running--
  if (waiters.length > 0) {
    running++
    waiters.shift()(true)
  }
}

export function getRunning() { return running }
export function getQueued()  { return waiters.length }

async function runJob(id, payload) {
  const { provider, model, system_prompt, messages, content, use_mcp, cwd } = payload
  store.markRunning(id)
  await emit('job.started', { job_id: id, provider })
  try {
    if (!PROVIDERS[provider]) throw new Error(`Provider inválido: ${provider}`)
    const result = await PROVIDERS[provider].call(
      system_prompt, messages, content, model || null, use_mcp, cwd
    )
    store.markCompleted(id, result)
    await emit('job.completed', { job_id: id, provider, output: result.output, usage: result.usage })
  } catch (err) {
    const isUnavailable = err.code === 'ENOENT' || /exit 127|not found|No such file/i.test(err.message)
    const error = isUnavailable
      ? { code: 'provider_unavailable', provider }
      : { code: 'execution_error', message: err.message }
    store.markFailed(id, error)
    await emit('job.failed', { job_id: id, provider, error })
  }
}

export async function scheduleJob(id, payload) {
  const got = await acquireSlot()
  if (!got) {
    store.markFailed(id, { code: 'queue_full' })
    return
  }
  try {
    await runJob(id, payload)
  } finally {
    releaseSlot()
  }
}

export async function init() {
  store.initialize()
  await loadMcpServers()
  store.cleanup()

  const pending = store.getPending()
  if (pending.length > 0) {
    console.log(`   [queue] Recovering ${pending.length} pending job(s)...`)
    for (const job of pending) scheduleJob(job.id, job.payload)
  }
}

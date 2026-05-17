import { randomUUID } from 'crypto'
import config         from '../../config.mjs'
import {
  QueueUnavailableError,
  QueueFullError,
  QueueTimeoutError,
  ProviderUnavailableError,
} from '../utils/errors.mjs'

const BASE    = `http://localhost:${config.queue.port}`
const POLL_MS = config.queue.pollMs ?? 1_000

export async function submit(params) {
  const job_id = randomUUID()

  try {
    await fetch(`${BASE}/execute`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ job_id, ...params }),
    })
  } catch (err) {
    if (err.code === 'ECONNREFUSED') throw new QueueUnavailableError()
    throw err
  }

  const deadline = Date.now() + (config.queue.jobTimeoutMs ?? 300_000)

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS))

    let res
    try {
      res = await fetch(`${BASE}/result/${job_id}`)
    } catch (err) {
      if (err.code === 'ECONNREFUSED') throw new QueueUnavailableError()
      continue
    }

    if (res.status === 202) continue  // still pending or running

    const data = await res.json()

    if (data?.error?.code === 'provider_unavailable') throw new ProviderUnavailableError(data.error.provider)
    if (data?.error?.code === 'queue_full')            throw new QueueFullError()
    if (data?.error?.code === 'execution_error')       throw new Error(data.error.message)
    if (data?.error)                                   throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))

    return data
  }

  throw new QueueTimeoutError()
}

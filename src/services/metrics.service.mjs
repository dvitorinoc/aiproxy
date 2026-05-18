import config from '../../config.mjs'
import { QueueUnavailableError } from '../utils/errors.mjs'

const BASE = `http://localhost:${config.queue.port}`

export default {
  async getUsage({ provider, from, to } = {}) {
    const qs = new URLSearchParams()
    if (provider != null) qs.set('provider', provider)
    if (from     != null) qs.set('from', from)
    if (to       != null) qs.set('to', to)

    let res
    try {
      res = await fetch(`${BASE}/metrics/usage?${qs}`)
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
        throw new QueueUnavailableError()
      }
      throw err
    }

    if (!res.ok) throw new Error(`Metrics unavailable: ${res.status}`)
    return res.json()
  },
}

import { createHmac } from 'crypto'
import config from '../../config.mjs'

/**
 * Emite um evento via webhook para a URL configurada.
 * Fire-and-forget: nunca lança exceção — falhas são apenas logadas.
 *
 * Eventos: job.started | job.completed | job.failed
 */
export async function emit(event, payload) {
  const url = config.webhook?.url
  if (!url) return

  const body = JSON.stringify({ event, ...payload, timestamp: Date.now() })

  const headers = { 'Content-Type': 'application/json' }
  if (config.webhook?.secret) {
    const sig = createHmac('sha256', config.webhook.secret).update(body).digest('hex')
    headers['X-Webhook-Signature'] = `sha256=${sig}`
  }

  try {
    const res = await fetch(url, { method: 'POST', headers, body })
    if (!res.ok) console.error(`   [webhook] ${event} → HTTP ${res.status}`)
  } catch (err) {
    console.error(`   [webhook] ${event} failed: ${err.message}`)
  }
}

import { createServer } from 'http'
import config           from '../../config.mjs'
import * as store       from './store.mjs'
import * as worker      from './worker.mjs'

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Headers': 'Content-Type' })
    return res.end()
  }

  // ── POST /execute ────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/execute') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const { job_id, ...payload } = JSON.parse(body)
        if (!job_id) return json(res, 400, { error: 'job_id é obrigatório' })

        const existing = store.getJob(job_id)
        if (existing?.status === 'completed' || existing?.status === 'failed') {
          return json(res, 200, existing.result)
        }
        if (!existing) {
          store.enqueue(job_id, payload)
          worker.scheduleJob(job_id, payload)
        }
        json(res, 202, { job_id, status: existing?.status ?? 'pending' })
      } catch (err) {
        json(res, 400, { error: err.message })
      }
    })
    return
  }

  // ── GET /result/:id ──────────────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/result/')) {
    const id  = req.url.slice('/result/'.length)
    const job = store.getJob(id)
    if (!job) return json(res, 404, { error: 'Job not found' })
    if (job.status === 'completed' || job.status === 'failed') {
      return json(res, 200, job.result)
    }
    return json(res, 202, { job_id: id, status: job.status })
  }

  // ── GET /status ──────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/status') {
    return json(res, 200, {
      running:         worker.getRunning(),
      queued:          worker.getQueued(),
      max_concurrent:  config.queue.maxConcurrent,
    })
  }

  // ── GET /health ──────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true })
  }

  json(res, 404, { error: 'Not found' })
})

worker.init().then(() => {
  server.listen(config.queue.port, '0.0.0.0', () => {
    console.log(`\n⚡ Queue Daemon  http://0.0.0.0:${config.queue.port}`)
    console.log(`   Max concurrent : ${config.queue.maxConcurrent}`)
    console.log(`   Max queue size : ${config.queue.maxQueueSize}`)
    console.log(`   DB             : ${config.queue.dbPath}\n`)
  })
})

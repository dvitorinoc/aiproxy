import { DatabaseSync } from 'node:sqlite'
import config           from '../../config.mjs'

let db

export function initialize() {
  db = new DatabaseSync(config.queue.dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT    PRIMARY KEY,
      status       TEXT    NOT NULL DEFAULT 'pending',
      payload      TEXT    NOT NULL,
      result       TEXT,
      created_at   INTEGER NOT NULL,
      started_at   INTEGER,
      finished_at  INTEGER
    )
  `)
  // Jobs interrupted by a previous crash are re-enqueued
  db.prepare(`UPDATE jobs SET status = 'pending', started_at = NULL WHERE status = 'running'`).run()
}

export function enqueue(id, payload) {
  db.prepare(`INSERT OR IGNORE INTO jobs (id, status, payload, created_at) VALUES (?, 'pending', ?, ?)`)
    .run(id, JSON.stringify(payload), Date.now())
}

export function markRunning(id) {
  db.prepare(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`).run(Date.now(), id)
}

export function markCompleted(id, result) {
  db.prepare(`UPDATE jobs SET status = 'completed', result = ?, finished_at = ? WHERE id = ?`)
    .run(JSON.stringify(result), Date.now(), id)
}

export function markFailed(id, error) {
  db.prepare(`UPDATE jobs SET status = 'failed', result = ?, finished_at = ? WHERE id = ?`)
    .run(JSON.stringify({ error }), Date.now(), id)
}

export function getJob(id) {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id)
  if (!row) return null
  return {
    id:         row.id,
    status:     row.status,
    payload:    JSON.parse(row.payload),
    result:     row.result ? JSON.parse(row.result) : null,
    created_at: row.created_at,
  }
}

export function getPending() {
  return db.prepare(`SELECT id, payload FROM jobs WHERE status = 'pending' ORDER BY created_at ASC`).all()
    .map(r => ({ id: r.id, payload: JSON.parse(r.payload) }))
}

export function cleanup() {
  const cutoff = Date.now() - (config.queue.cleanupAfterMs ?? 86_400_000)
  db.prepare(`DELETE FROM jobs WHERE status IN ('completed', 'failed') AND finished_at < ?`).run(cutoff)
}

export function getUsageMetrics({ provider = null, from = 0, to = Date.now() } = {}) {
  const providerFilter = provider ? `AND JSON_EXTRACT(payload, '$.provider') = ?` : ''
  const params = provider ? [from, to, provider] : [from, to]

  const rows = db.prepare(`
    SELECT
      JSON_EXTRACT(payload, '$.provider')                                AS provider,
      COUNT(*)                                                           AS jobs,
      SUM(CAST(JSON_EXTRACT(result, '$.usage.input_tokens')  AS INTEGER)) AS input_tokens,
      SUM(CAST(JSON_EXTRACT(result, '$.usage.output_tokens') AS INTEGER)) AS output_tokens,
      SUM(CAST(JSON_EXTRACT(result, '$.usage.total_tokens')  AS INTEGER)) AS total_tokens,
      SUM(CAST(JSON_EXTRACT(result, '$.usage.cached_tokens') AS INTEGER)) AS cached_tokens
    FROM jobs
    WHERE status = 'completed'
      AND finished_at >= ?
      AND finished_at <= ?
      ${providerFilter}
    GROUP BY JSON_EXTRACT(payload, '$.provider')
  `).all(...params)

  const by_provider = {}
  const totals = { jobs: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cached_tokens: 0 }

  for (const row of rows) {
    by_provider[row.provider] = {
      jobs:          row.jobs,
      input_tokens:  row.input_tokens  ?? 0,
      output_tokens: row.output_tokens ?? 0,
      total_tokens:  row.total_tokens  ?? 0,
      cached_tokens: row.cached_tokens ?? 0,
    }
    totals.jobs          += row.jobs
    totals.input_tokens  += row.input_tokens  ?? 0
    totals.output_tokens += row.output_tokens ?? 0
    totals.total_tokens  += row.total_tokens  ?? 0
    totals.cached_tokens += row.cached_tokens ?? 0
  }

  return { period: { from, to }, totals, by_provider }
}

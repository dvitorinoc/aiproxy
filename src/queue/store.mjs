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

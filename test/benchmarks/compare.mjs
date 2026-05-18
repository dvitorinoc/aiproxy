#!/usr/bin/env node
import { readFileSync } from 'fs'
import { basename } from 'path'

// ─── CLI args ─────────────────────────────────────────────────────────────────

const [baselinePath, experimentPath] = process.argv.slice(2)
if (!baselinePath || !experimentPath) {
  console.error('Usage: node compare.mjs <baseline.json> <experiment.json>')
  process.exit(1)
}

const baseline   = JSON.parse(readFileSync(baselinePath,   'utf8'))
const experiment = JSON.parse(readFileSync(experimentPath, 'utf8'))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(a, b) {
  if (a === 0) return b === 0 ? '+0.0%' : '+∞%'
  const d = ((b - a) / a) * 100
  return (d >= 0 ? '+' : '') + d.toFixed(1) + '%'
}

function delta(a, b) {
  const d = b - a
  return (d >= 0 ? '+' : '') + d
}

function row(label, a, b, unit = '') {
  const p = pct(a, b)
  const warn = a > b ? '  ↓' : a < b ? '  ↑' : ''
  return `  ${label.padEnd(22)}${String(a + unit).padStart(8)}  →  ${String(b + unit).padStart(8)}  (${p})${warn}`
}

function qualityRow(label, a, b) {
  const d = delta(a, b)
  const warn = b < a ? '  ⚠' : ''
  return `  ${label.padEnd(22)}${String(a).padStart(8)}  →  ${String(b).padStart(8)}  (${d})${warn}`
}

function sep(char = '═', n = 57) { return char.repeat(n) }

// ─── Index cases by id ────────────────────────────────────────────────────────

const baseMap = Object.fromEntries(baseline.cases.map(c => [c.id, c]))
const expMap  = Object.fromEntries(experiment.cases.map(c => [c.id, c]))
const allIds  = [...new Set([...Object.keys(baseMap), ...Object.keys(expMap)])]

// ─── Regressions ─────────────────────────────────────────────────────────────

const regressions = []
const criticalRegressions = []

for (const id of allIds) {
  const b = baseMap[id]
  const e = expMap[id]
  if (!b || !e) continue
  if (b.status === 'passed' && e.status !== 'passed') {
    regressions.push({ id, from: b.status, to: e.status, critical: b.critical || e.critical })
    if (b.critical || e.critical) criticalRegressions.push(id)
  }
}

// ─── Category breakdown ───────────────────────────────────────────────────────

const categoryStats = {}
for (const id of allIds) {
  const b = baseMap[id]
  const e = expMap[id]
  if (!b || !e) continue
  const cat = b.category
  if (!categoryStats[cat]) categoryStats[cat] = { b_in: 0, e_in: 0, b_pass: 0, e_pass: 0, total: 0, ids: [] }
  categoryStats[cat].b_in   += b.usage.input_tokens
  categoryStats[cat].e_in   += e.usage.input_tokens
  categoryStats[cat].b_pass += b.status === 'passed' ? 1 : 0
  categoryStats[cat].e_pass += e.status === 'passed' ? 1 : 0
  categoryStats[cat].total  += 1
  categoryStats[cat].ids.push(id)
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

const bs = baseline.summary
const es = experiment.summary

const tokenReductionPct = bs.total_input_tokens > 0
  ? ((bs.total_input_tokens - es.total_input_tokens) / bs.total_input_tokens) * 100
  : 0

const latencyDiff = es.avg_latency_ms - bs.avg_latency_ms

const approved = (
  tokenReductionPct >= 10 &&
  regressions.filter(r => expMap[r.id]?.evaluation_result?.type === 'exact_match').length === 0 &&
  criticalRegressions.length === 0 &&
  latencyDiff <= 100
)

// ─── Output ───────────────────────────────────────────────────────────────────

console.log('\n' + sep())
console.log('  BENCHMARK COMPARISON')
console.log(`  ${basename(baselinePath)}  vs  ${basename(experimentPath)}`)
console.log()
console.log(`  baseline:     max_chars=${baseline.config_snapshot?.context_max_chars ?? 0}  max_messages=${baseline.config_snapshot?.context_max_messages ?? 0}`)
console.log(`  experiment:   max_chars=${experiment.config_snapshot?.context_max_chars ?? 0}  max_messages=${experiment.config_snapshot?.context_max_messages ?? 0}`)
console.log(sep())

console.log('\nTOKENS')
console.log(row('input_tokens',  bs.total_input_tokens,  es.total_input_tokens))
console.log(row('output_tokens', bs.total_output_tokens, es.total_output_tokens))

console.log('\nLATENCY')
const latWarn = latencyDiff > 100 ? '  ⚠ exceeds 100ms threshold' : '  ✓ within threshold'
console.log(`  ${'avg_ms'.padEnd(22)}${String(bs.avg_latency_ms + 'ms').padStart(8)}  →  ${String(es.avg_latency_ms + 'ms').padStart(8)}  (${delta(bs.avg_latency_ms, es.avg_latency_ms)}ms)${latWarn}`)

console.log('\nQUALITY')
console.log(qualityRow('passed',        bs.passed,        es.passed))
console.log(qualityRow('failed',        bs.failed,        es.failed))
console.log(qualityRow('pending_judge', bs.pending_judge ?? 0, es.pending_judge ?? 0))

console.log('\nREGRESSIONS')
if (regressions.length === 0) {
  console.log('  (none)')
} else {
  for (const r of regressions) {
    const crit = r.critical ? '  ⚠ CRITICAL' : ''
    console.log(`  ${r.id}  ${r.from} → ${r.to}${crit}`)
  }
}

console.log('\nCRITICAL CASES')
const criticalIds = allIds.filter(id => baseMap[id]?.critical || expMap[id]?.critical)
if (criticalIds.length === 0) {
  console.log('  (none in this dataset)')
} else {
  for (const id of criticalIds) {
    const b = baseMap[id]
    const e = expMap[id]
    const regressed = b?.status === 'passed' && e?.status !== 'passed'
    const icon = regressed ? '✗ REGRESSION' : '✓ preserved'
    console.log(`  ${id}  ${b?.status ?? '?'} → ${e?.status ?? '?'}   ${icon}`)
  }
}

console.log('\nBY CATEGORY')
for (const [cat, s] of Object.entries(categoryStats)) {
  const tokenPct = pct(s.b_in, s.e_in)
  const qual     = `quality: ${s.b_pass}/${s.total} → ${s.e_pass}/${s.total}`
  const warn     = s.e_pass < s.b_pass ? '  ⚠' : ''
  console.log(`  ${cat.padEnd(10)} ${s.ids.join(',')}   input: ${tokenPct.padStart(7)}   ${qual}${warn}`)
}

console.log('\n' + sep())
if (approved) {
  console.log(`VERDICT: ✓ APPROVED — input_tokens -${tokenReductionPct.toFixed(1)}%, no critical regressions`)
} else {
  const reasons = []
  if (tokenReductionPct < 10)             reasons.push(`token reduction ${tokenReductionPct.toFixed(1)}% < 10%`)
  if (criticalRegressions.length > 0)     reasons.push(`critical regressions: ${criticalRegressions.join(', ')}`)
  if (latencyDiff > 100)                  reasons.push(`latency +${latencyDiff}ms > 100ms`)
  if (regressions.filter(r => expMap[r.id]?.evaluation_result?.type === 'exact_match').length > 0)
    reasons.push('exact_match regressions')
  console.log(`VERDICT: ✗ REJECTED — ${reasons.join(' | ')}`)
}
console.log(sep() + '\n')

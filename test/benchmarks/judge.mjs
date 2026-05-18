#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2)
const filePath = args[0]
if (!filePath) { console.error('Usage: node judge.mjs <results-file.json> [--provider <p>] [--model <m>] [--proxy <url>]'); process.exit(1) }

function flag(name, def) {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}

const proxyUrl = flag('--proxy',    'http://localhost:9090')
const provider = flag('--provider', 'claude')
const model    = flag('--model',    null)

// ─── Load result file ─────────────────────────────────────────────────────────

const data = JSON.parse(readFileSync(filePath, 'utf8'))
const pending = data.cases.filter(c => c.status === 'pending_judge')

if (pending.length === 0) {
  console.log('No pending_judge cases found.')
  process.exit(0)
}

console.log(`\nJudge — evaluating ${pending.length} cases | provider: ${provider} | proxy: ${proxyUrl}\n`)

// ─── Judge prompt ─────────────────────────────────────────────────────────────

function buildJudgePrompt(criteria, output) {
  return `Evaluate whether the following response satisfies the criterion.

Criterion: "${criteria}"

Response: "${output}"

Reply with exactly one line: "pass" or "fail", followed by a colon and a brief justification.
Example: "pass: the response correctly identifies X"`
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function judge(c) {
  const body = JSON.stringify({
    provider,
    model,
    system_prompt: 'You are a strict evaluator. Follow the output format exactly.',
    content:       buildJudgePrompt(c.evaluation_result.criteria ?? c.evaluation?.criteria ?? '', c.output),
    messages:      [],
    use_mcp:       false,
  })

  const res  = await fetch(`${proxyUrl}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const json = await res.json()
  return (json.output ?? '').trim()
}

// ─── Run ──────────────────────────────────────────────────────────────────────

let judged = 0, passed = 0, failed = 0, unknown = 0

for (const c of pending) {
  let verdict
  try {
    const raw = await judge(c)
    const lower = raw.toLowerCase()
    if (lower.startsWith('pass')) {
      verdict = { passed: true,  detail: raw }
      passed++
    } else if (lower.startsWith('fail')) {
      verdict = { passed: false, detail: raw }
      failed++
    } else {
      verdict = { passed: null,  detail: `unrecognized: ${raw}` }
      unknown++
      console.warn(`  ⚠ ${c.id} — unrecognized judge output: ${raw}`)
    }
  } catch (err) {
    verdict = { passed: null, detail: `error: ${err.message}` }
    unknown++
  }

  // update in-place
  const target = data.cases.find(r => r.id === c.id)
  target.evaluation_result = { type: 'llm_judge', ...verdict }
  target.status = verdict.passed === true ? 'passed' : verdict.passed === false ? 'failed' : 'pending_judge'

  const icon = verdict.passed === true ? '✓' : verdict.passed === false ? '✗' : '?'
  console.log(`  ${icon} ${c.id.padEnd(4)} [${c.category.padEnd(8)}]${c.critical ? ' ⚠ CRITICAL' : ''}  ${verdict.detail}`)
  judged++
}

// ─── Update summary ───────────────────────────────────────────────────────────

data.summary.passed        = data.cases.filter(r => r.status === 'passed').length
data.summary.failed        = data.cases.filter(r => r.status === 'failed').length
data.summary.pending_judge = data.cases.filter(r => r.status === 'pending_judge').length

writeFileSync(filePath, JSON.stringify(data, null, 2))

console.log(`\nJudged ${judged}: ${passed} pass | ${failed} fail | ${unknown} unknown`)
console.log(`Result updated in-place: ${filePath}`)

#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function flag(name, def) {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
function hasFlag(name) { return args.includes(name) }

const proxyUrl    = flag('--proxy',       'http://localhost:9090')
const outputName  = flag('--output',      `result-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const categoryArg = flag('--category',    '')
const providerArg = flag('--provider',    '')
const concurrency = parseInt(flag('--concurrency', '1'))
const skipMcp     = hasFlag('--skip-mcp')

if (!providerArg) {
  console.error('Error: --provider <name> is required (e.g. --provider claude, --provider gemini, --provider codex)')
  process.exit(1)
}

const categories = categoryArg ? categoryArg.split(',').map(s => s.trim()) : []

// ─── Dataset ──────────────────────────────────────────────────────────────────

const dataset = JSON.parse(readFileSync(join(__dirname, 'dataset.json'), 'utf8'))

let cases = dataset.cases
if (categories.length > 0) cases = cases.filter(c => categories.includes(c.category))
if (skipMcp)               cases = cases.filter(c => !c.request.use_mcp)

// ─── Config snapshot ──────────────────────────────────────────────────────────

const configSnapshot = {
  context_max_chars:    parseInt(process.env.AI_PROXY_CONTEXT_MAX_CHARS    ?? '0') || 0,
  context_max_messages: parseInt(process.env.AI_PROXY_CONTEXT_MAX_MESSAGES ?? '0') || 0,
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function postRun(request) {
  const body = JSON.stringify({
    provider:      providerArg,
    model:         request.model,
    system_prompt: request.system_prompt,
    messages:      request.messages,
    content:       request.content,
    use_mcp:       request.use_mcp,
    cwd:           request.cwd,
  })

  const start = Date.now()
  const res = await fetch(`${proxyUrl}/run`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const latency = Date.now() - start
  const json = await res.json()
  return { latency, status: res.status, json }
}

// ─── Evaluators ───────────────────────────────────────────────────────────────

function evalExactMatch(output, evaluation) {
  const lower = output.toLowerCase()
  const missing = evaluation.expected_contains.filter(s => !lower.includes(s.toLowerCase()))
  if (missing.length === 0) {
    return { type: 'exact_match', passed: true,  detail: `Found: ${evaluation.expected_contains.join(', ')}` }
  }
  return { type: 'exact_match', passed: false, detail: `Missing: ${missing.join(', ')}` }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runCase(c) {
  let result
  try {
    result = await postRun(c.request)
  } catch (err) {
    return {
      id:         c.id,
      category:   c.category,
      critical:   c.critical,
      status:     'error',
      latency_ms: 0,
      model_used: null,
      usage:      { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      output:     '',
      evaluation_result: { type: 'error', passed: false, detail: err.message },
    }
  }

  const { latency, status, json } = result
  const output    = json.output ?? ''
  const usage     = json.usage  ?? {}
  const modelUsed = json.model  ?? null

  let evalResult
  let caseStatus

  if (status !== 200) {
    evalResult = { type: 'http_error', passed: false, detail: `HTTP ${status}: ${JSON.stringify(json)}` }
    caseStatus = 'error'
  } else if (c.evaluation.type === 'exact_match') {
    evalResult = evalExactMatch(output, c.evaluation)
    caseStatus = evalResult.passed ? 'passed' : 'failed'
  } else {
    evalResult = { type: 'llm_judge', passed: null, detail: 'pending evaluation', criteria: c.evaluation.criteria }
    caseStatus = 'pending_judge'
  }

  return {
    id:         c.id,
    category:   c.category,
    critical:   c.critical,
    status:     caseStatus,
    latency_ms: latency,
    model_used: modelUsed,
    usage: {
      input_tokens:  usage.input_tokens  ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      total_tokens:  usage.total_tokens  ?? 0,
    },
    output,
    evaluation_result: evalResult,
  }
}

async function runBatch(batch) {
  return Promise.all(batch.map(runCase))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\nBenchmark — ${cases.length} cases | provider: ${providerArg} | proxy: ${proxyUrl} | concurrency: ${concurrency}`)
console.log(`Config: max_chars=${configSnapshot.context_max_chars} max_messages=${configSnapshot.context_max_messages}\n`)

const caseResults = []
for (let i = 0; i < cases.length; i += concurrency) {
  const batch = cases.slice(i, i + concurrency)
  const results = await runBatch(batch)
  for (const r of results) {
    const icon   = r.status === 'passed' ? '✓' : r.status === 'pending_judge' ? '?' : '✗'
    const tokens = `${r.usage.input_tokens}in/${r.usage.output_tokens}out`
    console.log(`  ${icon} ${r.id.padEnd(4)} [${r.category.padEnd(8)}] ${r.latency_ms}ms ${tokens.padStart(14)}  ${r.status}`)
  }
  caseResults.push(...results)
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const summary = {
  total:               caseResults.length,
  passed:              caseResults.filter(r => r.status === 'passed').length,
  failed:              caseResults.filter(r => r.status === 'failed').length,
  skipped:             0,
  pending_judge:       caseResults.filter(r => r.status === 'pending_judge').length,
  error:               caseResults.filter(r => r.status === 'error').length,
  total_input_tokens:  caseResults.reduce((s, r) => s + r.usage.input_tokens,  0),
  total_output_tokens: caseResults.reduce((s, r) => s + r.usage.output_tokens, 0),
  avg_latency_ms:      Math.round(caseResults.reduce((s, r) => s + r.latency_ms, 0) / (caseResults.length || 1)),
}

console.log(`\nSummary: ${summary.passed} passed | ${summary.failed} failed | ${summary.pending_judge} pending_judge | ${summary.error} error`)
console.log(`Tokens: ${summary.total_input_tokens} input / ${summary.total_output_tokens} output | avg latency: ${summary.avg_latency_ms}ms`)

// ─── Write result ─────────────────────────────────────────────────────────────

const output = {
  version:         '1.0.0',
  dataset_version: dataset.version,
  run_at:          Date.now(),
  proxy_url:       proxyUrl,
  provider:        providerArg,
  config_snapshot: configSnapshot,
  summary,
  cases: caseResults,
}

const outPath = join(__dirname, 'results', `${outputName}.json`)
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`\nResult written to: ${outPath}`)

import config from '../../config.mjs'

const API = config.laravelApi

const sseClients = new Set()
let lastSseHash  = null
let _pollRunning = false
let _interval    = null

export function addClient(res) {
  sseClients.add(res)
  triggerPoll()
}

export function removeClient(res) {
  sseClients.delete(res)
}

export function triggerPoll() {
  lastSseHash = null
  pollAndBroadcast()
}

export function startPolling() {
  _interval = setInterval(pollAndBroadcast, config.ssePollMs)
  return _interval
}

export function stopPolling() {
  if (_interval) { clearInterval(_interval); _interval = null }
}

async function pollAndBroadcast() {
  if (sseClients.size === 0) return
  if (_pollRunning) return
  _pollRunning = true
  try {
    const sig = AbortSignal.timeout(4000)
    const [tRes, aRes, sRes] = await Promise.all([
      fetch(`${API}/tasks`,    { signal: sig }),
      fetch(`${API}/agents`,   { signal: sig }),
      fetch(`${API}/settings`, { signal: sig }),
    ])
    if (!tRes.ok || !aRes.ok) return

    const [tasks, agents, settings] = await Promise.all([tRes.json(), aRes.json(), sRes.json()])
    const hash = JSON.stringify({ tasks, agents })
    if (hash === lastSseHash) return
    lastSseHash = hash

    const payload = JSON.stringify({
      tasks,
      agents,
      busy_agents:           settings?.busy_agents           ?? agents.filter(a => a.status === 'busy').length,
      max_concurrent_agents: settings?.max_concurrent_agents ?? 3,
    })
    const msg = `event: update\ndata: ${payload}\n\n`
    for (const res of sseClients) {
      try { res.write(msg) } catch {}
    }
  } catch {} finally {
    _pollRunning = false
  }
}

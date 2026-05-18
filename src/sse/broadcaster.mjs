/**
 * @deprecated
 * O SSE foi removido do AI Proxy. Use webhooks (src/webhook/emitter.mjs).
 * Este arquivo existe apenas para não quebrar imports em branches antigas.
 */
export function addClient()    {}
export function removeClient() {}
export function triggerPoll()  {}
export function startPolling() {}
export function stopPolling()  {}

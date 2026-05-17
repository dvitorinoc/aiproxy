export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError' }
}

export class ProviderUnavailableError extends Error {
  constructor(provider) {
    super(`Provider unavailable: ${provider}`)
    this.name    = 'ProviderUnavailableError'
    this.provider = provider
  }
}

export class QueueFullError extends Error {
  constructor() { super('Queue is full'); this.name = 'QueueFullError' }
}

export class QueueTimeoutError extends Error {
  constructor() { super('Job timed out in queue'); this.name = 'QueueTimeoutError' }
}

export class QueueUnavailableError extends Error {
  constructor() { super('Queue daemon is unavailable'); this.name = 'QueueUnavailableError' }
}

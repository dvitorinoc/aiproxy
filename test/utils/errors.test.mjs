import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ValidationError, ProviderUnavailableError,
  QueueFullError, QueueTimeoutError, QueueUnavailableError,
} from '../../src/utils/errors.mjs'

describe('errors', () => {
  it('ValidationError preserves message and name', () => {
    const err = new ValidationError('campo obrigatório')
    assert.equal(err.message, 'campo obrigatório')
    assert.equal(err.name, 'ValidationError')
    assert.ok(err instanceof Error)
  })

  it('ProviderUnavailableError preserves provider and name', () => {
    const err = new ProviderUnavailableError('gemini')
    assert.equal(err.provider, 'gemini')
    assert.equal(err.name, 'ProviderUnavailableError')
    assert.ok(err instanceof Error)
  })

  it('QueueFullError has correct name', () => {
    const err = new QueueFullError()
    assert.equal(err.name, 'QueueFullError')
    assert.ok(err instanceof Error)
  })

  it('QueueTimeoutError has correct name', () => {
    const err = new QueueTimeoutError()
    assert.equal(err.name, 'QueueTimeoutError')
    assert.ok(err instanceof Error)
  })

  it('QueueUnavailableError has correct name', () => {
    const err = new QueueUnavailableError()
    assert.equal(err.name, 'QueueUnavailableError')
    assert.ok(err instanceof Error)
  })
})

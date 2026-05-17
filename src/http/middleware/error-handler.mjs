import { json, ts } from '../helpers.mjs'
import {
  ValidationError,
  ProviderUnavailableError,
  QueueFullError,
  QueueTimeoutError,
  QueueUnavailableError,
} from '../../utils/errors.mjs'

export default function errorHandler(err, req, res, next) {
  if (err instanceof ValidationError) {
    return json(res, 400, { error: err.message })
  }
  if (err instanceof ProviderUnavailableError) {
    console.error(`[${ts()}] ✗ provider unavailable: ${err.provider}`)
    return json(res, 503, { error: 'provider_unavailable', provider: err.provider })
  }
  if (err instanceof QueueFullError) {
    return json(res, 503, { error: 'queue_full' })
  }
  if (err instanceof QueueTimeoutError) {
    return json(res, 503, { error: 'queue_timeout' })
  }
  if (err instanceof QueueUnavailableError) {
    return json(res, 503, { error: 'queue_unavailable' })
  }
  if (err._status) {
    return json(res, err._status, { error: err.message })
  }
  console.error(`[${ts()}] ✗`, err.message)
  json(res, 500, { error: err.message })
}

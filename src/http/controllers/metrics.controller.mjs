import { json }         from '../helpers.mjs'
import metricsService   from '../../services/metrics.service.mjs'

export default async function metricsController(req, res, next) {
  try {
    const qs       = new URL(req.url, 'http://localhost').searchParams
    const provider = qs.get('provider') || undefined
    const from     = qs.has('from') ? parseInt(qs.get('from')) : undefined
    const to       = qs.has('to')   ? parseInt(qs.get('to'))   : undefined
    json(res, 200, await metricsService.getUsage({ provider, from, to }))
  } catch (err) {
    next(err)
  }
}

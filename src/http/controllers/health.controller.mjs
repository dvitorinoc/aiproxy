import { json }                       from '../helpers.mjs'
import { PROVIDERS, SUGGESTED_MODELS } from '../../providers/index.mjs'
import config                          from '../../../config.mjs'

export default function healthController(req, res) {
  json(res, 200, {
    ok:               true,
    providers:        Object.keys(PROVIDERS),
    suggested_models: SUGGESTED_MODELS,
    port:             config.port,
  })
}

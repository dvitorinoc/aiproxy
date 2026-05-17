import { json }        from '../helpers.mjs'
import providersService from '../../services/providers.service.mjs'

export default function providersController(req, res, next) {
  try {
    json(res, 200, { providers: providersService.getAvailability() })
  } catch (err) {
    next(err)
  }
}

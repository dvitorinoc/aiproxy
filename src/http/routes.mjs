import bodyParser          from './middleware/body-parser.mjs'
import runController       from './controllers/run.controller.mjs'
import providersController from './controllers/providers.controller.mjs'
import eventsController    from './controllers/events.controller.mjs'
import healthController    from './controllers/health.controller.mjs'

export default function setupRoutes(router) {
  router.post('/run',       bodyParser, runController)
  router.get('/providers',  providersController)
  router.get('/events',     eventsController)
  router.get('/health',     healthController)
}

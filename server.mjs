import { createServer } from 'http'
import config            from './config.mjs'
import { createRouter }  from './src/http/router.mjs'
import setupRoutes       from './src/http/routes.mjs'
import cors              from './src/http/middleware/cors.mjs'
import logger            from './src/http/middleware/logger.mjs'
import errorHandler      from './src/http/middleware/error-handler.mjs'
import { startPolling }  from './src/sse/broadcaster.mjs'

const router = createRouter()
router.use(cors)
router.use(logger)
setupRoutes(router)
router.use(errorHandler)

const server = createServer((req, res) => router.dispatch(req, res))

startPolling()
server.listen(config.port, '0.0.0.0', () => {
  console.log(`\n🤖 AI Proxy  http://0.0.0.0:${config.port}`)
  console.log(`   Providers : claude · gemini · codex`)
  console.log(`   Queue     : http://localhost:${config.queue.port}`)
  console.log(`   Container : http://172.19.0.1:${config.port}\n`)
})

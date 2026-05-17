import { ts }                        from '../helpers.mjs'
import { addClient, removeClient }   from '../../sse/broadcaster.mjs'

export default function eventsController(req, res) {
  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':               'no-cache',
    'Connection':                  'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write(': connected\n\n')
  addClient(res)
  console.log(`[${ts()}] SSE client connected`)
  req.on('close', () => {
    removeClient(res)
    console.log(`[${ts()}] SSE client disconnected`)
  })
}

export default function bodyParser(req, res, next) {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    try {
      req.body = body ? JSON.parse(body) : {}
      next()
    } catch {
      next(Object.assign(new Error('Invalid JSON body'), { _status: 400 }))
    }
  })
  req.on('error', next)
}

import { ts } from '../helpers.mjs'

export default function logger(req, res, next) {
  console.log(`[${ts()}] ${req.method} ${req.url}`)
  next()
}

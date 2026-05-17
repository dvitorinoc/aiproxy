import { json } from './helpers.mjs'

export function createRouter() {
  const routes     = []
  const globalPre  = []  // 3-param middlewares applied before route handlers
  const globalPost = []  // 4-param error handlers applied after route handlers

  return {
    use(fn) {
      fn.length === 4 ? globalPost.push(fn) : globalPre.push(fn)
    },

    get(path, ...handlers)  { routes.push({ method: 'GET',  path, handlers }) },
    post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }) },

    dispatch(req, res) {
      const route = routes.find(r => r.method === req.method && r.path === req.url)
      const chain = [
        ...globalPre,
        ...(route?.handlers ?? [(_, res) => json(res, 404, { error: 'Not found' })]),
        ...globalPost,
      ]

      let i = 0
      const next = (err) => {
        if (i >= chain.length) return
        const fn = chain[i++]
        const isErrHandler = fn.length === 4

        if (err && isErrHandler) {
          try { Promise.resolve(fn(err, req, res, next)).catch(next) } catch (e) { next(e) }
        } else if (!err && !isErrHandler) {
          try { Promise.resolve(fn(req, res, next)).catch(next) } catch (e) { next(e) }
        } else {
          next(err)
        }
      }
      next()
    },
  }
}

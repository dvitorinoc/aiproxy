export default function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Headers': 'Content-Type' })
    return res.end()
  }
  next()
}

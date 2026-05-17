import { json, ts }     from '../helpers.mjs'
import { ValidationError } from '../../utils/errors.mjs'
import { PROVIDERS }     from '../../providers/index.mjs'
import { emptyUsage }    from '../../utils/parse.mjs'
import runService        from '../../services/run.service.mjs'

export default async function runController(req, res, next) {
  const {
    provider     = 'claude',
    model,
    system_prompt = '',
    messages      = [],
    content       = '',
    use_mcp       = false,
    cwd,
  } = req.body

  try {
    if (!PROVIDERS[provider]) throw new ValidationError(`Provider inválido: ${provider}`)
    if (!content?.trim())     throw new ValidationError('Campo "content" é obrigatório.')

    const modelLabel = model || 'default'
    const tags = [
      messages?.length ? `hist:${messages.length}` : null,
      use_mcp ? 'MCP' : null,
      cwd ? `cwd:${cwd}` : null,
    ].filter(Boolean)
    console.log(`[${ts()}] ▶ ${provider}/${modelLabel}${tags.length ? ` [${tags.join(' ')}]` : ''} ← ${content.slice(0, 60).replace(/\n/g, ' ')}…`)

    const result = await runService.execute({ provider, model, system_prompt, messages, content, use_mcp, cwd })

    console.log(`[${ts()}] ✓ ${provider}/${modelLabel} → ${(result.output ?? '').slice(0, 60).replace(/\n/g, ' ')}…`)
    json(res, 200, { provider, model: model || null, output: result.output ?? '', usage: result.usage ?? emptyUsage() })
  } catch (err) {
    next(err)
  }
}

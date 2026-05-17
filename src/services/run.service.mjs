import * as queueClient from '../queue/client.mjs'
import { ProviderUnavailableError } from '../utils/errors.mjs'

export default {
  async execute({ provider, model, system_prompt, messages, content, use_mcp, cwd }) {
    try {
      return await queueClient.submit({ provider, model, system_prompt, messages, content, use_mcp, cwd })
    } catch (err) {
      if (err.name === 'ProviderUnavailableError') throw err
      throw err
    }
  },
}

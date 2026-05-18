import * as queueClient from '../queue/client.mjs'
import { truncateMessages } from '../context/truncate.mjs'
import config from '../../config.mjs'
import { ProviderUnavailableError } from '../utils/errors.mjs'

export default {
  async execute({ provider, model, system_prompt, messages, content, use_mcp, cwd }) {
    const params = { provider, model, system_prompt, messages, content, use_mcp, cwd }
    truncateMessages(params, config)
    try {
      return await queueClient.submit(params)
    } catch (err) {
      throw err
    }
  },
}

import { PROVIDER_BINARY } from '../providers/index.mjs'
import { isBinaryAvailable } from '../utils/path.mjs'

export default {
  getAvailability() {
    const result = {}
    for (const [name, binary] of Object.entries(PROVIDER_BINARY)) {
      result[name] = { available: isBinaryAvailable(binary) }
    }
    return result
  },
}

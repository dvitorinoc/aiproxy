import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import config from '../../config.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

export const PROXY_ROOT = join(__dirname, '../..')
export const NVM_NODE   = config.path.nvmNode
export const LOCAL_BIN  = config.path.localBin
export const FULL_PATH  = `${NVM_NODE}:${LOCAL_BIN}:/usr/local/bin:/usr/bin:/bin`
export const ENV        = { ...process.env, PATH: FULL_PATH }

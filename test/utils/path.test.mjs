import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let resolveExecCwd, isBinaryAvailable

before(async () => {
  const m = await import('../../src/utils/path.mjs')
  resolveExecCwd    = m.resolveExecCwd
  isBinaryAvailable = m.isBinaryAvailable
})

describe('resolveExecCwd', () => {
  it('returns undefined for non-string input', () => {
    assert.equal(resolveExecCwd(null), undefined)
    assert.equal(resolveExecCwd(42), undefined)
  })

  it('returns undefined for blank string', () => {
    assert.equal(resolveExecCwd('   '), undefined)
  })

  it('returns undefined for non-existent path', () => {
    assert.equal(resolveExecCwd('/this/does/not/exist'), undefined)
  })

  it('returns the path for a real directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxy-test-'))
    try {
      assert.equal(resolveExecCwd(dir), dir)
    } finally {
      rmdirSync(dir)
    }
  })

  it('returns undefined for a file path (not a directory)', () => {
    const dir  = mkdtempSync(join(tmpdir(), 'proxy-test-'))
    const file = join(dir, 'file.txt')
    try {
      writeFileSync(file, 'x')
      assert.equal(resolveExecCwd(file), undefined)
    } finally {
      rmdirSync(dir, { recursive: true })
    }
  })
})

describe('isBinaryAvailable', () => {
  it('returns true for sh (always in /bin)', () => {
    assert.equal(isBinaryAvailable('sh'), true)
  })

  it('returns false for non-existent binary', () => {
    assert.equal(isBinaryAvailable('__nonexistent_proxy_binary__'), false)
  })
})

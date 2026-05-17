import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnWithStdin } from '../../src/utils/spawn.mjs'

describe('spawnWithStdin', () => {
  it('captures stdout from echo', async () => {
    const { stdout } = await spawnWithStdin('/bin/echo', ['hello'], {}, null)
    assert.equal(stdout.trim(), 'hello')
  })

  it('passes stdin to cat', async () => {
    const { stdout } = await spawnWithStdin('/bin/cat', [], {}, 'test data')
    assert.equal(stdout, 'test data')
  })

  it('handles large stdin without deadlock', async () => {
    const large = Buffer.alloc(1_048_576, 'x').toString()
    const { stdout } = await spawnWithStdin('/bin/cat', [], {}, large)
    assert.equal(stdout.length, large.length)
  })

  it('rejects on non-zero exit code', async () => {
    await assert.rejects(
      () => spawnWithStdin('/bin/false', [], {}, null),
      (err) => {
        assert.ok(err.message.includes('exit 1'))
        return true
      }
    )
  })

  it('rejects with ENOENT for missing binary', async () => {
    await assert.rejects(
      () => spawnWithStdin('/nonexistent/binary', [], {}, null),
      (err) => {
        assert.equal(err.code, 'ENOENT')
        return true
      }
    )
  })

  it('includes stderr content in rejection message', async () => {
    const script = 'echo "stderr msg" >&2; exit 1'
    await assert.rejects(
      () => spawnWithStdin('/bin/sh', ['-c', script], {}, null),
      (err) => {
        assert.ok(err.message.includes('stderr msg'))
        return true
      }
    )
  })

  it('resolves with empty stderr on success', async () => {
    const { stderr } = await spawnWithStdin('/bin/echo', ['ok'], {}, null)
    assert.equal(stderr, '')
  })
})

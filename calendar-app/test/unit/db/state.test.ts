import { afterEach, describe, expect, it } from 'vitest'
import { setDb } from '../../../server/db/state'
import { useDb } from '../../../server/utils/db'
import { migratedMemoryDb } from './helpers'

afterEach(() => setDb(undefined))

describe('useDb', () => {
  it('throws a clear error before the database is opened', () => {
    expect(() => useDb()).toThrow(/before the database was opened/)
  })

  it('returns the open database', () => {
    const handle = migratedMemoryDb()
    setDb(handle)

    expect(useDb()).toBe(handle.db)
  })
})

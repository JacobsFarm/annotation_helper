import { describe, expect, it } from 'vitest'
import { toPlain } from './clone'

/** Stands in for a `$state` proxy: same shape, same trap-based access, same refusal. */
function reactive<T extends object>(value: T): T {
  return new Proxy(value, {}) as T
}

describe('toPlain', () => {
  it('leaves primitives and null alone', () => {
    expect(toPlain(4)).toBe(4)
    expect(toPlain('a')).toBe('a')
    expect(toPlain(null)).toBeNull()
    expect(toPlain(undefined)).toBeUndefined()
  })

  it('copies nested objects and arrays by value', () => {
    const source = { a: [1, { b: 2 }], c: { d: [3] } }
    const copy = toPlain(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.a[1]).not.toBe(source.a[1])
  })

  // The whole reason this module exists. A proxy anywhere in the tree - and Svelte puts
  // one at every level - makes structuredClone throw, which is what killed every save.
  it('produces something structuredClone accepts', () => {
    const annotation = reactive({
      imageFile: 'a.png',
      shapes: reactive([reactive({ id: '1', points: reactive([[1, 2]]) })])
    })

    expect(() => structuredClone(annotation)).toThrow()
    expect(() => structuredClone(toPlain(annotation))).not.toThrow()
    expect(toPlain(annotation)).toEqual({
      imageFile: 'a.png',
      shapes: [{ id: '1', points: [[1, 2]] }]
    })
  })
})

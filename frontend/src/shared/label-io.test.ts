/**
 * The same round-trip cases as `backend/tests/test_labels.py`.
 *
 * Two implementations of the label format exist on purpose (see `label-io.ts`); these
 * tests are what stops them drifting. If one side changes, this file or its Python twin
 * must change with it.
 */

import { describe, expect, it } from 'vitest'
import { formatLabelText, labelNameFor, parseLabelText } from './label-io'
import type { BoxShape, PolygonShape, Shape } from './shapes'

const W = 1920
const H = 1080

function box(partial: Partial<BoxShape> = {}): BoxShape {
  return {
    id: 'a',
    kind: 'box',
    classId: 0,
    source: 'manual',
    x1: 100,
    y1: 200,
    x2: 400,
    y2: 650,
    ...partial
  }
}

function polygon(points: [number, number][], classId = 0): PolygonShape {
  return { id: 'p', kind: 'polygon', classId, source: 'manual', points }
}

function roundtrip(shapes: Shape[]): Shape[] {
  return parseLabelText(formatLabelText(shapes, W, H), W, H).shapes
}

describe('boxes', () => {
  it('survives a round trip', () => {
    const original = box({ classId: 2 })
    const [restored] = roundtrip([original]) as [BoxShape]

    expect(restored.kind).toBe('box')
    expect(restored.classId).toBe(2)
    expect(restored.x1).toBeCloseTo(original.x1, 1)
    expect(restored.y1).toBeCloseTo(original.y1, 1)
    expect(restored.x2).toBeCloseTo(original.x2, 1)
    expect(restored.y2).toBeCloseTo(original.y2, 1)
  })

  it('keeps coordinates that sit on the image edge', () => {
    const [restored] = roundtrip([box({ x1: 0, y1: 0, x2: W, y2: H })]) as [BoxShape]
    expect(restored.x1).toBeCloseTo(0, 2)
    expect(restored.x2).toBeCloseTo(W, 1)
    expect(restored.y2).toBeCloseTo(H, 1)
  })

  it('normalises a box dragged bottom-right to top-left', () => {
    const [restored] = roundtrip([box({ x1: 400, y1: 650, x2: 100, y2: 200 })]) as [BoxShape]
    expect(restored.x1).toBeLessThan(restored.x2)
    expect(restored.y1).toBeLessThan(restored.y2)
    expect(restored.x1).toBeCloseTo(100, 1)
  })
})

describe('polygons', () => {
  const points: [number, number][] = [
    [10, 20],
    [500, 30],
    [480, 700],
    [60, 640]
  ]

  it('survives a round trip', () => {
    const [restored] = roundtrip([polygon(points, 1)]) as [PolygonShape]
    expect(restored.kind).toBe('polygon')
    expect(restored.classId).toBe(1)
    expect(restored.points).toHaveLength(points.length)
    restored.points.forEach(([x, y], index) => {
      expect(x).toBeCloseTo(points[index]![0], 1)
      expect(y).toBeCloseTo(points[index]![1], 1)
    })
  })

  it('keeps its class id', () => {
    // The predecessor wrote every polygon as class 0. Guard against the regression.
    const text = formatLabelText([polygon(points, 7)], W, H)
    expect(text.split(' ')[0]).toBe('7')
  })

  it('coexists with boxes in one file', () => {
    const restored = roundtrip([box(), polygon(points)])
    expect(restored.map((s) => s.kind)).toEqual(['box', 'polygon'])
  })
})

describe('stability', () => {
  it('writes the same file twice', () => {
    const first = formatLabelText([box({ x1: 12.5, y1: 33.25 })], W, H)
    const second = formatLabelText(parseLabelText(first, W, H).shapes, W, H)
    expect(second).toBe(first)
  })

  it('writes nothing for no shapes, which is a verified background sample', () => {
    expect(formatLabelText([], W, H)).toBe('')
  })

  it('agrees with the Python formatter, to six decimals', () => {
    // A centred half-size box: the values are simple enough to assert literally.
    const text = formatLabelText([box({ x1: 480, y1: 270, x2: 1440, y2: 810 })], W, H)
    expect(text).toBe('0 0.500000 0.500000 0.500000 0.500000\n')
  })
})

describe('malformed input', () => {
  it('reports a bad row instead of throwing', () => {
    const result = parseLabelText('0 0.5 0.5 0.2 0.2\nnot a label\n', W, H)
    expect(result.shapes).toHaveLength(1)
    expect(result.issues.map((i) => i.code)).toEqual(['malformed_row'])
    expect(result.issues[0]!.line).toBe(2)
  })

  it('flags out-of-range coordinates but keeps the shape', () => {
    const result = parseLabelText('0 0.5 0.5 1.4 0.2\n', W, H)
    expect(result.shapes).toHaveLength(1)
    expect(result.issues.some((i) => i.code === 'coordinate_out_of_range')).toBe(true)
  })

  it('rejects an odd token count', () => {
    const result = parseLabelText('0 0.1 0.2 0.3\n', W, H)
    expect(result.shapes).toHaveLength(0)
    expect(result.issues[0]!.code).toBe('unexpected_token_count')
  })

  it('ignores blank lines and comments', () => {
    const result = parseLabelText('\n# note\n0 0.5 0.5 0.2 0.2\n\n', W, H)
    expect(result.shapes).toHaveLength(1)
    expect(result.issues).toHaveLength(0)
  })
})

describe('label paths', () => {
  it('keeps sub-folders', () => {
    expect(labelNameFor('batch1/img_001.jpg')).toBe('batch1/img_001.txt')
    expect(labelNameFor('img.tar.gz.png')).toBe('img.tar.gz.txt')
  })
})

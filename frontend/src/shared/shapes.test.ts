/**
 * The same cases as the annotation-kind tests in `backend/tests/test_labels.py`.
 *
 * Which task an image can train is decided in two places - here and in `shapes.py` -
 * because annotating has to work without Python. These tests are what stops the two
 * from disagreeing about it.
 */

import { describe, expect, it } from 'vitest'
import {
  annotationKind,
  countShapeKinds,
  kindFromCounts,
  trainsSegmentation,
  type BoxShape,
  type PolygonShape
} from './shapes'

const box: BoxShape = { id: 'a', kind: 'box', classId: 0, source: 'manual', x1: 10, y1: 10, x2: 50, y2: 50 }

const polygon: PolygonShape = {
  id: 'b',
  kind: 'polygon',
  classId: 0,
  source: 'manual',
  points: [
    [0, 0],
    [10, 0],
    [10, 10]
  ]
}

describe('annotation kinds', () => {
  it('names what an image can train', () => {
    expect(annotationKind([box])).toBe('box')
    expect(annotationKind([polygon])).toBe('polygon')
    expect(annotationKind([box, polygon])).toBe('mixed')
    expect(annotationKind([])).toBe('background')
    expect(annotationKind([], false)).toBe('none')
  })

  it('counts the two kinds apart', () => {
    expect(countShapeKinds([box, polygon, polygon])).toEqual({ boxes: 1, polygons: 2 })
    expect(countShapeKinds([])).toEqual({ boxes: 0, polygons: 0 })
  })

  it('keeps "not looked at" apart from "nothing to annotate"', () => {
    expect(kindFromCounts(0, 0, true)).toBe('background')
    expect(kindFromCounts(0, 0, false)).toBe('none')
  })

  it('lets only polygons and backgrounds train segmentation', () => {
    expect(trainsSegmentation('polygon')).toBe(true)
    expect(trainsSegmentation('background')).toBe(true)
    expect(trainsSegmentation('box')).toBe(false)
    expect(trainsSegmentation('mixed')).toBe(false)
  })
})

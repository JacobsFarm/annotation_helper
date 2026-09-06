/**
 * Coordinate-space tests.
 *
 * The bug these exist for: the predecessor computed a box's `y2` with the *horizontal*
 * offset, so every predicted box rendered skewed while the saved numbers stayed correct.
 * A transform that is asymmetric in x and y catches exactly that.
 */

import { describe, expect, it } from 'vitest'
import {
  distanceToSegment,
  fitViewport,
  imagePoint,
  pointInPolygon,
  screenPoint,
  toImage,
  toScreen,
  zoomAt
} from './geometry'

describe('image <-> screen', () => {
  // Different offsets on each axis: swapping them would not cancel out.
  const view = { scale: 2, offsetX: 30, offsetY: 90 }

  it('converts a point and back without loss', () => {
    const original = imagePoint(123.5, 456.25)
    const restored = toImage(toScreen(original, view), view)
    expect(restored.x).toBeCloseTo(original.x, 8)
    expect(restored.y).toBeCloseTo(original.y, 8)
  })

  it('uses the vertical offset for y and the horizontal one for x', () => {
    const screen = toScreen(imagePoint(10, 10), view)
    expect(screen.x).toBe(10 * 2 + 30)
    expect(screen.y).toBe(10 * 2 + 90)
    expect(screen.x).not.toBe(screen.y)
  })
})

describe('fit', () => {
  it('centres the image and applies the padding once', () => {
    const view = fitViewport({ width: 1000, height: 500 }, { width: 600, height: 600 }, 20)
    expect(view.scale).toBeCloseTo(560 / 1000, 6)
    expect(view.offsetX).toBeCloseTo((600 - 1000 * view.scale) / 2, 6)
    expect(view.offsetY).toBeCloseTo((600 - 500 * view.scale) / 2, 6)
  })

  it('never divides by zero on an empty container', () => {
    expect(fitViewport({ width: 100, height: 100 }, { width: 0, height: 0 }).scale).toBe(1)
  })

  it('fits a 4K image into a small window', () => {
    const view = fitViewport({ width: 3840, height: 2160 }, { width: 900, height: 600 })
    expect(3840 * view.scale).toBeLessThanOrEqual(900)
    expect(2160 * view.scale).toBeLessThanOrEqual(600)
  })
})

describe('zoom', () => {
  it('keeps the pixel under the cursor in place', () => {
    const view = { scale: 1, offsetX: 0, offsetY: 0 }
    const anchor = screenPoint(200, 140)
    const before = toImage(anchor, view)
    const after = toImage(anchor, zoomAt(view, anchor, 2.5))
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('respects the scale limits', () => {
    const view = { scale: 1, offsetX: 0, offsetY: 0 }
    expect(zoomAt(view, screenPoint(0, 0), 1e6).scale).toBeLessThanOrEqual(40)
    expect(zoomAt(view, screenPoint(0, 0), 1e-6).scale).toBeGreaterThanOrEqual(0.02)
  })
})

describe('hit testing', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10]
  ]

  it('detects a point inside a polygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
  })

  it('measures distance to a segment, including past its ends', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 6)
    expect(distanceToSegment({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(4, 6)
  })
})

/**
 * The one shape model. Mirrors `backend/src/annotation_helper/shapes.py` exactly -
 * the JSON these produce is the wire format between the two.
 */

import { polygonArea, pointInPolygon } from './geometry'

export type ShapeSource = 'manual' | 'ai'

export interface BoxShape {
  id: string
  kind: 'box'
  classId: number
  source: ShapeSource
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PolygonShape {
  id: string
  kind: 'polygon'
  classId: number
  source: ShapeSource
  points: [number, number][]
}

export type Shape = BoxShape | PolygonShape
export type ShapeKind = Shape['kind']

/**
 * Which training task an image's shapes can feed.
 *
 * The two kinds are not interchangeable, and only in one direction is that free: a
 * polygon flattens to its own bounding box, a box cannot invent the mask it never had.
 * So `polygon` feeds detection *and* segmentation, `box` feeds detection only, and
 * `mixed` is the trap - ultralytics decides per *file*, so one box row among polygons
 * is read as a two-point polygon and silently becomes a nonsense box.
 */
export type AnnotationKind = 'none' | 'background' | 'box' | 'polygon' | 'mixed'

export function countShapeKinds(shapes: Shape[]): { boxes: number; polygons: number } {
  const boxes = shapes.reduce((n, s) => n + (s.kind === 'box' ? 1 : 0), 0)
  return { boxes, polygons: shapes.length - boxes }
}

/** `labelled: false` is "not looked at"; an empty label file is a verified background. */
export function kindFromCounts(boxes: number, polygons: number, labelled = true): AnnotationKind {
  if (!labelled) return 'none'
  if (boxes && polygons) return 'mixed'
  if (polygons) return 'polygon'
  if (boxes) return 'box'
  return 'background'
}

export function annotationKind(shapes: Shape[], labelled = true): AnnotationKind {
  const { boxes, polygons } = countShapeKinds(shapes)
  return kindFromCounts(boxes, polygons, labelled)
}

/** A background is a valid negative for either task; a box-only image is not a mask. */
export function trainsSegmentation(kind: AnnotationKind): boolean {
  return kind === 'polygon' || kind === 'background'
}

export interface ImageAnnotation {
  imageFile: string
  width: number
  height: number
  shapes: Shape[]
  /**
   * `false` + zero shapes = not looked at yet.
   * `true`  + zero shapes = verified background, which is training data.
   * An empty array on its own cannot express the difference.
   */
  reviewed: boolean
}

export function newShapeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/** Top-left / bottom-right, whichever way the box was dragged. */
export function normaliseBox(box: BoxShape): BoxShape {
  return {
    ...box,
    x1: Math.min(box.x1, box.x2),
    y1: Math.min(box.y1, box.y2),
    x2: Math.max(box.x1, box.x2),
    y2: Math.max(box.y1, box.y2)
  }
}

export function boxSize(box: BoxShape): { width: number; height: number } {
  return { width: Math.abs(box.x2 - box.x1), height: Math.abs(box.y2 - box.y1) }
}

export function shapeArea(shape: Shape): number {
  if (shape.kind === 'box') {
    const { width, height } = boxSize(shape)
    return width * height
  }
  return polygonArea(shape.points)
}

export function shapeBounds(shape: Shape): { x1: number; y1: number; x2: number; y2: number } {
  if (shape.kind === 'box') {
    const box = normaliseBox(shape)
    return { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 }
  }
  const xs = shape.points.map((p) => p[0])
  const ys = shape.points.map((p) => p[1])
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

export function shapeContains(shape: Shape, point: { x: number; y: number }): boolean {
  if (shape.kind === 'box') {
    const b = normaliseBox(shape)
    return point.x >= b.x1 && point.x <= b.x2 && point.y >= b.y1 && point.y <= b.y2
  }
  return pointInPolygon(point, shape.points)
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  if (shape.kind === 'box') {
    return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy }
  }
  return { ...shape, points: shape.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
}

/** Keep a shape inside the image. Called after every move and resize, in one place. */
export function clampShape(shape: Shape, width: number, height: number): Shape {
  const cx = (v: number) => Math.min(Math.max(v, 0), width)
  const cy = (v: number) => Math.min(Math.max(v, 0), height)
  if (shape.kind === 'box') {
    return { ...shape, x1: cx(shape.x1), y1: cy(shape.y1), x2: cx(shape.x2), y2: cy(shape.y2) }
  }
  return { ...shape, points: shape.points.map(([x, y]) => [cx(x), cy(y)] as [number, number]) }
}

export function polygonToBox(shape: PolygonShape): BoxShape {
  const b = shapeBounds(shape)
  return {
    id: newShapeId(),
    kind: 'box',
    classId: shape.classId,
    source: shape.source,
    ...b
  }
}

/** A box smaller than this in either direction is a mis-click, not a shape. */
export const MIN_SHAPE_SIZE = 3

export function isDegenerate(shape: Shape): boolean {
  if (shape.kind === 'box') {
    const { width, height } = boxSize(shape)
    return width < MIN_SHAPE_SIZE || height < MIN_SHAPE_SIZE
  }
  return shape.points.length < 3
}

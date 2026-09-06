/**
 * YOLO label parsing and serialisation, in TypeScript.
 *
 * This is a deliberate second implementation of `backend/.../labels.py`, and the
 * duplication is the point: annotating has to work when Python is not installed or not
 * configured. If label I/O lived only in the sidecar, the app would be unusable without
 * it, and "Python not configured" would stop being a warning and start being a wall.
 *
 * The cost is that the two must not drift. Two things hold them together:
 *   - `docs/label-format.md` is the specification both implement,
 *   - both sides run the same round-trip test cases.
 *
 * Formats, either or both in one file:
 *   box      `class cx cy w h`             (5 tokens)
 *   polygon  `class x1 y1 x2 y2 ...`       (odd, >= 7 tokens)
 */

import { newShapeId, type Shape, type ShapeSource } from './shapes'

/** Decimals per coordinate. Six is ~0.004 px of error on an 8K image. */
export const PRECISION = 6

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff']

export type LabelIssueCode =
  | 'malformed_row'
  | 'negative_class_id'
  | 'degenerate_box'
  | 'unexpected_token_count'
  | 'coordinate_out_of_range'
  | 'bad_image_size'

export interface LabelIssue {
  code: LabelIssueCode
  line: number
  detail: string
}

export interface LabelReadResult {
  shapes: Shape[]
  issues: LabelIssue[]
  /** The file was present. Absent is a normal state, not an error. */
  existed: boolean
}

export function parseLabelText(
  text: string,
  width: number,
  height: number,
  source: ShapeSource = 'manual'
): LabelReadResult {
  const shapes: Shape[] = []
  const issues: LabelIssue[] = []

  if (width <= 0 || height <= 0) {
    return { shapes, issues: [{ code: 'bad_image_size', line: 0, detail: `${width}x${height}` }], existed: true }
  }

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    const lineNumber = i + 1
    if (!line || line.startsWith('#')) continue

    const parts = line.split(/\s+/)
    const classId = Number(parts[0])
    const values = parts.slice(1).map(Number)

    if (!Number.isFinite(classId) || values.some((v) => !Number.isFinite(v))) {
      issues.push({ code: 'malformed_row', line: lineNumber, detail: line.slice(0, 80) })
      continue
    }
    if (classId < 0) {
      issues.push({ code: 'negative_class_id', line: lineNumber, detail: String(classId) })
      continue
    }

    const outOfRange = values.filter((v) => v < -0.001 || v > 1.001).length

    if (values.length === 4) {
      const [cx, cy, w, h] = values as [number, number, number, number]
      if (w <= 0 || h <= 0) {
        issues.push({ code: 'degenerate_box', line: lineNumber, detail: `${w}x${h}` })
        continue
      }
      shapes.push({
        id: newShapeId(),
        kind: 'box',
        classId: Math.trunc(classId),
        source,
        x1: (cx - w / 2) * width,
        y1: (cy - h / 2) * height,
        x2: (cx + w / 2) * width,
        y2: (cy + h / 2) * height
      })
    } else if (values.length >= 6 && values.length % 2 === 0) {
      const points: [number, number][] = []
      for (let v = 0; v < values.length; v += 2) {
        points.push([values[v]! * width, values[v + 1]! * height])
      }
      shapes.push({
        id: newShapeId(),
        kind: 'polygon',
        classId: Math.trunc(classId),
        source,
        points
      })
    } else {
      issues.push({ code: 'unexpected_token_count', line: lineNumber, detail: String(parts.length) })
      continue
    }

    if (outOfRange > 0) {
      issues.push({
        code: 'coordinate_out_of_range',
        line: lineNumber,
        detail: `${outOfRange} value(s)`
      })
    }
  }

  return { shapes, issues, existed: true }
}

export function formatLabelText(shapes: Shape[], width: number, height: number): string {
  if (width <= 0 || height <= 0) throw new Error('image size must be positive')
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
  const lines: string[] = []

  for (const shape of shapes) {
    let values: number[]
    if (shape.kind === 'box') {
      const x1 = Math.min(shape.x1, shape.x2)
      const x2 = Math.max(shape.x1, shape.x2)
      const y1 = Math.min(shape.y1, shape.y2)
      const y2 = Math.max(shape.y1, shape.y2)
      const w = clamp01((x2 - x1) / width)
      const h = clamp01((y2 - y1) / height)
      if (w <= 0 || h <= 0) continue
      values = [clamp01((x1 + x2) / 2 / width), clamp01((y1 + y2) / 2 / height), w, h]
    } else {
      if (shape.points.length < 3) continue
      values = shape.points.flatMap(([x, y]) => [clamp01(x / width), clamp01(y / height)])
    }
    lines.push(`${shape.classId} ${values.map((v) => v.toFixed(PRECISION)).join(' ')}`)
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}

/** `images/a/b.jpg` -> `labels/a/b.txt`, keeping any sub-folder structure. */
export function labelNameFor(imageFile: string): string {
  const dot = imageFile.lastIndexOf('.')
  return (dot > 0 ? imageFile.slice(0, dot) : imageFile) + '.txt'
}

export function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && IMAGE_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}

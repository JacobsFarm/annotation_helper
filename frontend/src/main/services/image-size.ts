/**
 * Image dimensions from the file header, without decoding pixels.
 *
 * Mirrors `backend/src/annotation_helper/imageinfo.py`. Scanning a 50k-image dataset
 * must not mean decoding 50k JPEGs; these readers touch a few hundred bytes per file.
 */

import { open } from 'node:fs/promises'

export interface ImageSize {
  width: number
  height: number
}

export async function readImageSize(path: string): Promise<ImageSize | null> {
  let handle
  try {
    handle = await open(path, 'r')
    const head = Buffer.alloc(32)
    const { bytesRead } = await handle.read(head, 0, 32, 0)
    if (bytesRead < 24) return null

    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
    }
    if (head[0] === 0xff && head[1] === 0xd8) {
      return await jpegSize(handle)
    }
    if (head[0] === 0x42 && head[1] === 0x4d) {
      return { width: head.readInt32LE(18), height: Math.abs(head.readInt32LE(22)) }
    }
    if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') {
      return await webpSize(head, handle)
    }
    return null
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

/** Walk JPEG segments to the SOFn frame header that carries the dimensions. */
async function jpegSize(handle: Awaited<ReturnType<typeof open>>): Promise<ImageSize | null> {
  let position = 2
  const marker = Buffer.alloc(4)
  for (;;) {
    const { bytesRead } = await handle.read(marker, 0, 4, position)
    if (bytesRead < 4 || marker[0] !== 0xff) return null
    const code = marker[1]!
    const length = marker.readUInt16BE(2)
    // SOF0..SOF15, minus the DHT/JPG/DAC markers that share the range.
    if (code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc) {
      const frame = Buffer.alloc(5)
      await handle.read(frame, 0, 5, position + 4)
      return { width: frame.readUInt16BE(3), height: frame.readUInt16BE(1) }
    }
    position += 2 + length
  }
}

async function webpSize(
  head: Buffer,
  handle: Awaited<ReturnType<typeof open>>
): Promise<ImageSize | null> {
  const chunk = head.subarray(12, 16).toString('ascii')
  const buffer = Buffer.alloc(6)

  if (chunk === 'VP8X') {
    await handle.read(buffer, 0, 6, 24)
    return {
      width: 1 + (buffer[0]! | (buffer[1]! << 8) | (buffer[2]! << 16)),
      height: 1 + (buffer[3]! | (buffer[4]! << 8) | (buffer[5]! << 16))
    }
  }
  if (chunk === 'VP8 ') {
    await handle.read(buffer, 0, 4, 26)
    return { width: buffer.readUInt16LE(0) & 0x3fff, height: buffer.readUInt16LE(2) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    await handle.read(buffer, 0, 4, 21)
    const bits = buffer.readUInt32LE(0)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

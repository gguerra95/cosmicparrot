import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { config } from '../config'

function getStoredPath(ext: string): { relative: string; absolute: string } {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const name = `${crypto.randomUUID()}${ext}`
  const relative = path.join(String(yyyy), mm, name)
  const absolute = path.join(config.UPLOAD_DIR, relative)
  return { relative, absolute }
}

export async function saveFile(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<{ storedPath: string; isImage: boolean; thumbPath: string | null }> {
  const ext = path.extname(originalFilename).toLowerCase() || ''
  const { relative, absolute } = getStoredPath(ext)

  await fs.promises.mkdir(path.dirname(absolute), { recursive: true })
  await fs.promises.writeFile(absolute, buffer)

  const isImage = mimeType.startsWith('image/')
  let thumbPath: string | null = null

  if (isImage) {
    try {
      const thumbExt = '.jpg'
      const thumbRelative = relative.replace(ext || '$', '_thumb' + thumbExt)
      const thumbAbsolute = path.join(config.UPLOAD_DIR, thumbRelative)
      await sharp(buffer).resize(300).jpeg({ quality: 80 }).toFile(thumbAbsolute)
      thumbPath = thumbRelative
    } catch {
      // thumbnail generation failure is non-fatal
    }
  }

  return { storedPath: relative, isImage, thumbPath }
}

export function getAbsolutePath(storedPath: string): string {
  return path.join(config.UPLOAD_DIR, storedPath)
}

export async function deleteFile(storedPath: string): Promise<void> {
  try {
    await fs.promises.unlink(getAbsolutePath(storedPath))
  } catch {
    // ignore missing files
  }
}

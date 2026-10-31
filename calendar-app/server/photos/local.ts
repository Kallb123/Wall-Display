import type { Stats } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { exifTakenAt } from './exif'
import { uprightSize } from './render'
import { loadSharp } from './sharp'
import { PhotoProviderError } from './types'
import type { PhotoListing, PhotoProvider } from './types'

// The local folder provider (architecture §5.4): every picture in a folder and
// the folders under it. A photo's id is its path inside the folder, with `/`
// between the parts. The folder is the person's own, so a symlink in it is
// followed, but no id can ask for a file outside it.

export interface LocalProviderOptions {
  /** The folder to read. */
  path: string
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn'>
}

/** How many folders deep the search goes: far more than a library has, and a stop for a loop of links. */
const MAX_DEPTH = 24

/** How many files are opened at once to read their size. */
const CONCURRENCY = 8

/** The file extensions sharp can read in this build (HEIC is only there if it was built with it), lowercase with the dot. */
export async function supportedExtensions(): Promise<ReadonlySet<string>> {
  const sharp = await loadSharp()
  const extensions = new Set<string>()
  for (const format of Object.values(sharp.format)) {
    for (const suffix of format.input.fileSuffix ?? []) extensions.add(suffix.toLowerCase())
  }
  // The names photos really come with. SVG is a drawing, not a photo, and sharp reads it from the folder happily.
  extensions.delete('.svg')
  return extensions
}

/**
 * The absolute path of `assetId` inside `root`, or null if it would be outside
 * it, is hidden, or isn't a plain relative path. Only the text is checked: it
 * stops `..` and absolute paths, which is all an id from outside could use.
 */
export function resolveInside(root: string, assetId: string): string | null {
  if (assetId === '' || assetId.includes('\0') || assetId.includes('\\') || isAbsolute(assetId)) return null
  const parts = assetId.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..' || part.startsWith('.'))) return null
  const base = resolve(root)
  const path = resolve(base, ...parts)
  return path.startsWith(base.endsWith(sep) ? base : base + sep) ? path : null
}

export function createLocalProvider(options: LocalProviderOptions): PhotoProvider {
  const { log = console } = options
  const root = resolve(options.path)
  // What was read from a file last time, so a listing every few minutes re-reads only the files that changed.
  const known = new Map<string, { mtimeMs: number, size: number, listing: PhotoListing | null }>()
  /** How many files were left out last time, so the same warning isn't repeated at every listing. */
  let lastSkipped = 0

  async function walk(extensions: ReadonlySet<string>): Promise<{ id: string, file: string }[]> {
    const found: { id: string, file: string }[] = []
    const seen = new Set<string>()

    async function visit(dir: string, prefix: string, depth: number): Promise<void> {
      const real = await realpath(dir)
      if (seen.has(real) || depth > MAX_DEPTH) return
      seen.add(real)
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const file = join(dir, entry.name)
        let kind: Pick<Stats, 'isDirectory' | 'isFile'> = entry
        if (entry.isSymbolicLink()) {
          try {
            kind = await stat(file)
          } catch {
            continue
          }
        }
        if (kind.isDirectory()) {
          await visit(file, `${prefix}${entry.name}/`, depth + 1)
        } else if (kind.isFile()) {
          const dot = entry.name.lastIndexOf('.')
          if (dot > 0 && extensions.has(entry.name.slice(dot).toLowerCase())) found.push({ id: `${prefix}${entry.name}`, file })
        }
      }
    }
    await visit(root, '', 0)
    return found.sort((a, b) => a.id.localeCompare(b.id))
  }

  async function describe(id: string, file: string): Promise<PhotoListing | null> {
    const info = await stat(file)
    const before = known.get(id)
    if (before && before.mtimeMs === info.mtimeMs && before.size === info.size) return before.listing

    let listing: PhotoListing | null = null
    try {
      const sharp = await loadSharp()
      const meta = await sharp(file).metadata()
      if (meta.width && meta.height) {
        listing = { providerAssetId: id, ...uprightSize(meta.width, meta.height, meta.orientation), takenAt: exifTakenAt(meta.exif) }
      }
    } catch {
      // Not a picture after all, or damaged: left out of the pool.
    }
    known.set(id, { mtimeMs: info.mtimeMs, size: info.size, listing })
    return listing
  }

  return {
    id: 'local',

    async list() {
      let files: { id: string, file: string }[]
      try {
        files = await walk(await supportedExtensions())
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        throw new PhotoProviderError('local', code === 'ENOENT' || code === 'ENOTDIR'
          ? `The photo folder ${root} was not found`
          : `The photo folder ${root} can't be read`)
      }

      const listings: PhotoListing[] = []
      let skipped = 0
      for (let i = 0; i < files.length; i += CONCURRENCY) {
        const batch = await Promise.all(files.slice(i, i + CONCURRENCY).map(async ({ id, file }) => {
          try {
            return await describe(id, file)
          } catch {
            return null
          }
        }))
        for (const listing of batch) {
          if (listing) listings.push(listing)
          else skipped++
        }
      }
      // Forget files that have gone, so the memory doesn't grow.
      const present = new Set(files.map(item => item.id))
      for (const id of known.keys()) {
        if (!present.has(id)) known.delete(id)
      }
      if (skipped > 0 && skipped !== lastSkipped) log.warn(`[photos] local: ${skipped} ${skipped === 1 ? 'file' : 'files'} in ${root} could not be read as a picture and ${skipped === 1 ? 'is' : 'are'} left out`)
      lastSkipped = skipped
      return listings
    },

    async fetch(providerAssetId) {
      const file = resolveInside(root, providerAssetId)
      if (!file) throw new PhotoProviderError('local', 'That is not a photo in the folder')
      try {
        return await readFile(file)
      } catch {
        throw new PhotoProviderError('local', 'The photo is no longer in the folder')
      }
    },
  }
}

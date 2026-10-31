import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { createLocalProvider, resolveInside, supportedExtensions } from '../../../server/photos/local'
import { PhotoProviderError } from '../../../server/photos/types'
import { tempDir } from './helpers'

const picture = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#4080c0' } })

async function folder() {
  const dir = await tempDir()
  await writeFile(join(dir, 'landscape.jpg'), await picture(160, 90).jpeg().toBuffer())
  await mkdir(join(dir, 'holiday', 'day-2'), { recursive: true })
  await writeFile(join(dir, 'holiday', 'portrait.PNG'), await picture(90, 160).png().toBuffer())
  await writeFile(join(dir, 'holiday', 'day-2', 'square.webp'), await picture(100, 100).webp().toBuffer())
  return dir
}

const quiet = () => ({ info: vi.fn(), warn: vi.fn() })

describe('the local provider', () => {
  it('lists the pictures in the folder and its sub-folders, with their sizes', async () => {
    const provider = createLocalProvider({ path: await folder(), log: quiet() })

    const listing = await provider.list()

    expect(provider.id).toBe('local')
    expect(listing.map(({ providerAssetId, width, height }) => ({ providerAssetId, width, height }))).toEqual([
      { providerAssetId: 'holiday/day-2/square.webp', width: 100, height: 100 },
      { providerAssetId: 'holiday/portrait.PNG', width: 90, height: 160 },
      { providerAssetId: 'landscape.jpg', width: 160, height: 90 },
    ])
  })

  it('leaves out hidden files and folders, other files, and pictures that can\'t be read', async () => {
    const dir = await folder()
    const log = quiet()
    await writeFile(join(dir, '.hidden.jpg'), await picture(16, 9).jpeg().toBuffer())
    await mkdir(join(dir, '.thumbnails'))
    await writeFile(join(dir, '.thumbnails', 'a.jpg'), await picture(16, 9).jpeg().toBuffer())
    await writeFile(join(dir, 'notes.txt'), 'not a photo')
    await writeFile(join(dir, 'drawing.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    await writeFile(join(dir, 'broken.jpg'), 'this is not a jpeg')
    await writeFile(join(dir, 'noext'), await picture(16, 9).jpeg().toBuffer())

    const ids = (await createLocalProvider({ path: dir, log }).list()).map(item => item.providerAssetId)

    expect(ids).toEqual(['holiday/day-2/square.webp', 'holiday/portrait.PNG', 'landscape.jpg'])
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toMatch(/1 file .* could not be read/)
  })

  it('does not repeat the warning about unreadable files at every listing', async () => {
    const dir = await folder()
    await writeFile(join(dir, 'broken.jpg'), 'nope')
    const log = quiet()
    const provider = createLocalProvider({ path: dir, log })

    await provider.list()
    await provider.list()

    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('gives a photo\'s size as it is shown, turned upright by its EXIF orientation', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'phone.jpg'), await picture(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer())

    const [listing] = await createLocalProvider({ path: dir, log: quiet() }).list()

    expect(listing).toMatchObject({ providerAssetId: 'phone.jpg', width: 200, height: 400 })
  })

  it('reads when a photo was taken from its EXIF, and says nothing if it has no date', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'dated.jpg'), await picture(160, 90).jpeg().withExif({ IFD2: { DateTimeOriginal: '2023:05:06 07:08:09' } }).toBuffer())
    await writeFile(join(dir, 'undated.jpg'), await picture(160, 90).jpeg().toBuffer())

    const listing = await createLocalProvider({ path: dir, log: quiet() }).list()

    expect(listing.find(item => item.providerAssetId === 'dated.jpg')?.takenAt).toEqual(new Date('2023-05-06T07:08:09Z'))
    expect(listing.find(item => item.providerAssetId === 'undated.jpg')?.takenAt).toBeNull()
  })

  it('sees a new picture at the next listing, and one that has changed', async () => {
    const dir = await folder()
    const provider = createLocalProvider({ path: dir, log: quiet() })
    await provider.list()

    await writeFile(join(dir, 'new.jpg'), await picture(320, 180).jpeg().toBuffer())
    await writeFile(join(dir, 'landscape.jpg'), await picture(200, 100).jpeg().toBuffer())
    const listing = await provider.list()

    expect(listing.map(item => item.providerAssetId)).toContain('new.jpg')
    expect(listing.find(item => item.providerAssetId === 'landscape.jpg')).toMatchObject({ width: 200, height: 100 })
  })

  it('follows a link to a folder, once, even when it points back up', async () => {
    const dir = await folder()
    const outside = await tempDir()
    await writeFile(join(outside, 'elsewhere.jpg'), await picture(16, 9).jpeg().toBuffer())
    await symlink(outside, join(dir, 'album'))
    await symlink(dir, join(dir, 'holiday', 'loop'))

    const ids = (await createLocalProvider({ path: dir, log: quiet() }).list()).map(item => item.providerAssetId)

    expect(ids).toContain('album/elsewhere.jpg')
    expect(ids.filter(id => id.endsWith('landscape.jpg'))).toEqual(['landscape.jpg'])
  })

  it('fails with a provider error, naming the folder, when it is missing', async () => {
    const dir = await tempDir()
    const provider = createLocalProvider({ path: join(dir, 'not-there'), log: quiet() })

    await expect(provider.list()).rejects.toBeInstanceOf(PhotoProviderError)
    await expect(provider.list()).rejects.toThrow(/not-there was not found/)
  })

  it('fails with a provider error when the path is a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a-file'), 'x')

    await expect(createLocalProvider({ path: join(dir, 'a-file'), log: quiet() }).list()).rejects.toBeInstanceOf(PhotoProviderError)
  })

  it('lists an empty folder as no photos', async () => {
    expect(await createLocalProvider({ path: await tempDir(), log: quiet() }).list()).toEqual([])
  })

  describe('fetch', () => {
    it('reads a photo by its id', async () => {
      const dir = await folder()
      const provider = createLocalProvider({ path: dir, log: quiet() })

      const bytes = await provider.fetch('holiday/day-2/square.webp')

      expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 100 })
    })

    it('refuses an id that would leave the folder, and does not say what is there', async () => {
      const dir = await folder()
      await writeFile(join(dir, '..', 'secret.jpg'), 'secret').catch(() => {})
      const provider = createLocalProvider({ path: join(dir, 'holiday'), log: quiet() })

      for (const id of ['../landscape.jpg', 'day-2/../../landscape.jpg', '/etc/passwd', `${dir}/landscape.jpg`, '..', '', 'a\0b.jpg', '.hidden.jpg', 'day-2/./square.webp']) {
        await expect(provider.fetch(id), id).rejects.toThrow(/not a photo in the folder/)
      }
    })

    it('fails with a provider error when the photo has gone', async () => {
      const provider = createLocalProvider({ path: await folder(), log: quiet() })

      await expect(provider.fetch('gone.jpg')).rejects.toBeInstanceOf(PhotoProviderError)
    })
  })
})

describe('resolveInside', () => {
  const root = '/srv/photos'

  it('joins a relative path to the folder', () => {
    expect(resolveInside(root, 'a/b.jpg')).toBe('/srv/photos/a/b.jpg')
    expect(resolveInside('/srv/photos/', 'a.jpg')).toBe('/srv/photos/a.jpg')
  })

  it('refuses anything that is not a plain path inside the folder', () => {
    for (const id of ['', '..', '../x.jpg', 'a/../../x.jpg', 'a/..', '/x.jpg', '//x', 'a//b.jpg', 'a/', '.hidden', 'a/.b.jpg', 'a\\b.jpg', 'a\0b', '..%2fx']) {
      expect(resolveInside(root, id), JSON.stringify(id)).toBeNull()
    }
  })

  it('does not take a sibling folder with the same start for the folder itself', () => {
    expect(resolveInside(root, '../photos-private/x.jpg')).toBeNull()
  })
})

describe('supportedExtensions', () => {
  it('has the usual photo types and not SVG', async () => {
    const extensions = await supportedExtensions()

    for (const extension of ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.avif']) expect(extensions.has(extension)).toBe(true)
    expect(extensions.has('.svg')).toBe(false)
  })
})

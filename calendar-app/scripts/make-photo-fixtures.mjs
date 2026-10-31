// Draws the small pictures in test/fixtures/photos/, which `pnpm dev` and the
// photo tests use as a folder of photos. They are committed, so this only needs
// running if they are to change: `node scripts/make-photo-fixtures.mjs`.
// Each is a gradient with a few shapes, so they are easy to tell apart on the
// wall, and under 50 KB. No text: the fonts differ between machines.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'photos')
mkdirSync(join(out, 'trip'), { recursive: true })

const svg = (width, height, from, to, shapes) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>${shapes}
</svg>`)

const save = (name, input, { orientation } = {}) =>
  sharp(input).jpeg({ quality: 70, mozjpeg: true }).withMetadata(orientation ? { orientation } : {}).toFile(join(out, name))

// A 16:9 landscape: a sun over two hills.
await save('sunset-landscape.jpg', svg(1280, 720, '#f6b042', '#7a3b8f', `
  <circle cx="900" cy="250" r="110" fill="#fff3c4" opacity="0.9"/>
  <path d="M0 720 L0 520 Q260 360 520 520 T1040 500 T1280 540 L1280 720 Z" fill="#3b2a5c"/>
  <path d="M0 720 L0 600 Q300 500 640 620 T1280 600 L1280 720 Z" fill="#241a3d"/>`))

// A portrait: a tall tower on a green-to-blue sky.
await save('tall-portrait.jpg', svg(720, 1080, '#4fb286', '#2b5fa8', `
  <rect x="300" y="260" width="120" height="720" fill="#f4efe6"/>
  <polygon points="280,260 360,140 440,260" fill="#c9503c"/>
  <circle cx="540" cy="180" r="50" fill="#fff" opacity="0.8"/>
  <rect x="0" y="980" width="720" height="100" fill="#1d3b2f"/>`))

// A square: concentric rings.
await save('trip/square-rings.jpg', svg(800, 800, '#e8607a', '#f2c14e', `
  <circle cx="400" cy="400" r="300" fill="none" stroke="#fff" stroke-width="24" opacity="0.85"/>
  <circle cx="400" cy="400" r="200" fill="none" stroke="#7a1f3d" stroke-width="24" opacity="0.85"/>
  <circle cx="400" cy="400" r="100" fill="#fff" opacity="0.9"/>`))

// A portrait that is stored on its side with an EXIF orientation of 6 ("rotate
// a quarter turn clockwise"), as a phone saves it. Upright it is 640×960 with an
// arrow pointing up; if the orientation is ignored the arrow points left.
const upright = await sharp(svg(640, 960, '#38b6c4', '#1c3f6e', `
  <polygon points="320,160 500,420 380,420 380,800 260,800 260,420 140,420" fill="#fff4d6"/>
  <circle cx="500" cy="760" r="60" fill="#f2c14e"/>`)).png().toBuffer()
const sideways = await sharp(upright).rotate(-90).png().toBuffer()
await save('trip/phone-rotated.jpg', sideways, { orientation: 6 })

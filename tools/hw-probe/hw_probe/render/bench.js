// The benchmark page's script. It runs one fixed sequence and posts the result to the probe that served it:
//
//   config -> fonts -> colour checks -> GPU -> prepare photos -> month scene (warm-up, then measured)
//   -> photo scene (measured, with crossfades) -> POST /results
//
// Frame time is the gap between consecutive requestAnimationFrame timestamps. The page talks to the server
// with relative URLs only (GET /config.json, POST /progress, POST /results) and makes no other requests.

const STAGE_WIDTH = 2560
const STAGE_HEIGHT = 1440

/** The faces the display bundles; the page checks each one really loaded. */
const FONT_FACES = [
  { family: 'Caprasimo', weight: '400' },
  { family: 'Figtree', weight: '400' },
  { family: 'Figtree', weight: '500' },
  { family: 'Figtree', weight: '600' },
  { family: 'Figtree', weight: '700' },
]

/** Fallback if the refresh interval cannot be measured (no warm-up frames): 60 Hz. */
const FALLBACK_REFRESH_MS = 1000 / 60

const stage = document.getElementById('stage')
const monthScene = document.getElementById('month-scene')
const photoScene = document.getElementById('photo-scene')
const statusLine = document.getElementById('status')
const messageBox = document.getElementById('message')

const errors = []
let stageScale = 1

// ---------------------------------------------------------------------------------------------------------
// Small helpers

function recordError(text) {
  if (errors.length < 20) errors.push(String(text))
}

window.addEventListener('error', (event) => {
  recordError(`${event.message} (${event.filename || 'page'}:${event.lineno || 0})`)
})
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  recordError(`Unhandled rejection: ${reason && reason.message ? reason.message : reason}`)
})

/** Builds an element in one line, so the month's markup stays readable. */
function el(tag, className, text, style) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined && text !== null) node.textContent = text
  if (style) Object.assign(node.style, style)
  return node
}

const round = (value, places = 2) => Number(value.toFixed(places))
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
const pad2 = (value) => String(value).padStart(2, '0')

/** Fire and forget: a lost progress line must never stop the benchmark. */
function progress(phase, message) {
  fetch('/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase, message }),
  }).catch(() => {})
}

function setStatus(text) {
  statusLine.textContent = text
}

function showMessage(title, detail) {
  messageBox.replaceChildren(el('h1', '', title), el('p', '', detail))
  messageBox.hidden = false
}

/** Scales the fixed stage to the window and centres it, like the display page, leaving black bars if the shape differs. */
function fitStage() {
  stageScale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT)
  const x = (window.innerWidth - STAGE_WIDTH * stageScale) / 2
  const y = (window.innerHeight - STAGE_HEIGHT * stageScale) / 2
  stage.style.transform = `translate(${x}px, ${y}px) scale(${stageScale})`
}

/** A small seeded generator (mulberry32), so every run draws the same month and the same photos. */
function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------------------------------------
// Fonts, colour and GPU checks

async function checkFonts() {
  await Promise.allSettled(FONT_FACES.map((face) => document.fonts.load(`${face.weight} 24px "${face.family}"`, 'Aa0')))
  await document.fonts.ready
  const found = new Map()
  document.fonts.forEach((face) => {
    const family = face.family.replace(/["']/g, '')
    if (!FONT_FACES.some((wanted) => wanted.family === family)) return
    found.set(`${family}/${face.weight}`, { family, weight: String(face.weight), status: face.status })
  })
  // A face the page declared but the browser never listed counts as missing, not as absent from the report.
  return FONT_FACES.map(
    (face) => found.get(`${face.family}/${face.weight}`) ?? { family: face.family, weight: face.weight, status: 'missing' },
  )
}

/**
 * Paints `css` into a canvas and reads the pixel back. If the canvas refuses the colour (it keeps the sentinel),
 * the colour is resolved through a DOM element first, which also copes with a Chromium whose canvas is older
 * than its CSS.
 */
function readPixel(css) {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 4
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#010203'
  const sentinel = ctx.fillStyle
  ctx.fillStyle = css
  if (ctx.fillStyle === sentinel) {
    const probe = document.createElement('div')
    probe.style.backgroundColor = css
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    ctx.fillStyle = resolved
  }
  ctx.fillRect(0, 0, 4, 4)
  try {
    const data = ctx.getImageData(1, 1, 1, 1).data
    return [data[0], data[1], data[2]]
  } catch {
    return null
  }
}

function pixelCheck(css, expected) {
  const actual = readPixel(css)
  const ok = actual !== null && actual.every((channel, index) => Math.abs(channel - expected[index]) <= 3)
  return { css, expected, actual, ok }
}

function checkColours() {
  const oklch = 'oklch(62.8% 0.2577 29.23)'
  // An sRGB mix of white and black is 128; only a mix done in OKLCH gives 99, so this proves where it was mixed.
  const mix = 'color-mix(in oklch, white 50%, black)'
  return {
    oklchSupported: CSS.supports('color', oklch),
    colorMixSupported: CSS.supports('color', mix),
    oklchPixel: pixelCheck(oklch, [255, 0, 0]),
    colorMixPixel: pixelCheck(mix, [99, 99, 99]),
  }
}

function checkGpu() {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
  if (!gl) return { webgl: false, vendor: '', renderer: '' }
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    webgl: true,
    vendor: String(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
    renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
  }
}

// ---------------------------------------------------------------------------------------------------------
// Month scene: October 2026 with today Wednesday the 28th, six people and about 120 events.

const PEOPLE = [
  { name: 'Mum', initial: 'M', colour: 'var(--person-0)' },
  { name: 'Dad', initial: 'D', colour: 'var(--person-1)' },
  { name: 'Ada', initial: 'A', colour: 'var(--person-2)' },
  { name: 'Ben', initial: 'B', colour: 'var(--person-3)' },
  { name: 'Gran', initial: 'G', colour: 'var(--person-4)' },
  { name: 'Eli', initial: 'E', colour: 'var(--person-5)' },
]

const TIMED_TITLES = [
  'Swimming lesson', 'Piano', 'School run', 'Dentist', 'Parents evening', 'Football practice', 'Book club',
  'Café with Jo', 'Bins out', 'Playgroup', 'Yoga', 'Vet appointment', 'Choir', 'Team meeting', 'Shopping',
  'Gym', 'Brownies', 'Walk with Sam', 'Guitar', 'Pick up parcel',
]

const BAR_TITLES = [
  'Half term', 'Gran visits', 'Work trip', 'Camping', 'School project', 'Art course', 'Conference', 'Cousins stay',
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEK_COUNT = 5
const LANES = 4
/** Day 0 is Monday 28 September; the grid runs to Sunday 1 November. */
const TODAY_INDEX = 30
const FIRST_OF_MONTH = 3
const LAST_OF_MONTH = 33

function dayNumber(index) {
  if (index < FIRST_OF_MONTH) return 28 + index
  if (index <= LAST_OF_MONTH) return index - FIRST_OF_MONTH + 1
  return index - LAST_OF_MONTH
}

const personFill = (person) => `color-mix(in oklab, ${person.colour} var(--bar-mix), var(--bg))`

function makeBadges(people) {
  const badges = el('span', 'badges')
  for (const person of people) badges.appendChild(el('span', 'badge', person.initial, { background: person.colour }))
  return badges
}

function pickPeople(random) {
  const first = Math.floor(random() * PEOPLE.length)
  if (random() > 0.25) return [PEOPLE[first]]
  return [PEOPLE[first], PEOPLE[(first + 1 + Math.floor(random() * (PEOPLE.length - 1))) % PEOPLE.length]]
}

function makeEvents(random) {
  const bars = []
  for (let i = 0; i < 16; i++) {
    const start = Math.floor(random() * 33)
    const length = 2 + Math.floor(random() * 4)
    bars.push({
      title: BAR_TITLES[i % BAR_TITLES.length],
      start,
      end: Math.min(start + length - 1, 34),
      people: pickPeople(random),
    })
  }
  const timed = []
  for (let i = 0; i < 104; i++) {
    const hour = 7 + Math.floor(random() * 14)
    const minute = random() > 0.5 ? 30 : 0
    timed.push({
      title: TIMED_TITLES[Math.floor(random() * TIMED_TITLES.length)],
      day: Math.floor(random() * 35),
      time: `${pad2(hour)}:${pad2(minute)}`,
      people: pickPeople(random),
    })
  }
  timed.sort((a, b) => a.time.localeCompare(b.time))
  return { bars, timed }
}

/** Gives each bar segment of a week a lane (first one free), dropping any that would need a fifth. */
function packBars(bars, week) {
  const first = week * 7
  const last = first + 6
  const laneEnds = Array(LANES).fill(-1)
  const placed = []
  const segments = bars
    .filter((bar) => bar.start <= last && bar.end >= first)
    .map((bar) => ({
      bar,
      from: Math.max(bar.start, first) - first,
      to: Math.min(bar.end, last) - first,
      roundStart: bar.start >= first,
      roundEnd: bar.end <= last,
    }))
    .sort((a, b) => a.from - b.from)
  for (const segment of segments) {
    const lane = laneEnds.findIndex((end) => end < segment.from)
    if (lane < 0) continue
    laneEnds[lane] = segment.to
    placed.push({ ...segment, lane })
  }
  return placed
}

function buildWeek(week, events) {
  const first = week * 7
  const weekEl = el('div', 'week')
  const bars = packBars(events.bars, week)
  const busy = Array.from({ length: 7 }, () => new Set())
  for (const bar of bars) for (let column = bar.from; column <= bar.to; column++) busy[column].add(bar.lane)

  // Tiles and day numbers first, so everything else paints over them.
  for (let column = 0; column < 7; column++) {
    const index = first + column
    const isToday = index === TODAY_INDEX
    const inMonth = index >= FIRST_OF_MONTH && index <= LAST_OF_MONTH
    weekEl.appendChild(
      el('div', 'tile', null, {
        gridColumn: column + 1,
        background: isToday ? 'var(--today-cell)' : inMonth ? 'var(--tile)' : 'var(--tile-out)',
      }),
    )
    const date = el('div', 'date', null, { gridColumn: column + 1 })
    date.appendChild(
      el('span', 'number', dayNumber(index), {
        background: isToday ? 'var(--today-num-bg)' : 'transparent',
        color: isToday ? 'var(--today-num-fg)' : inMonth ? 'var(--text)' : 'var(--faint)',
      }),
    )
    weekEl.appendChild(date)
  }

  for (const bar of bars) {
    const end = bar.roundEnd ? '999px' : '8px'
    const start = bar.roundStart ? '999px' : '8px'
    const node = el('div', 'bar', null, {
      gridColumn: `${bar.from + 1} / span ${bar.to - bar.from + 1}`,
      gridRow: bar.lane + 2,
      // A round end sits in from the tile's edge; a square one runs on into its neighbour.
      margin: `0 ${bar.roundEnd ? '8px' : '0'} 0 ${bar.roundStart ? '8px' : '0'}`,
      borderRadius: `${start} ${end} ${end} ${start}`,
      background: personFill(bar.bar.people[0]),
      '--ring': personFill(bar.bar.people[0]),
    })
    node.appendChild(makeBadges(bar.bar.people))
    node.appendChild(el('span', 'name', bar.bar.title))
    weekEl.appendChild(node)
  }

  for (let column = 0; column < 7; column++) {
    const index = first + column
    const free = [...Array(LANES).keys()].filter((lane) => !busy[column].has(lane))
    const items = events.timed.filter((event) => event.day === index)
    const overflow = items.length > free.length
    const shown = overflow ? free.slice(0, -1).length : items.length
    const tile = index === TODAY_INDEX ? 'var(--today-cell)' : 'var(--tile)'
    for (let i = 0; i < shown; i++) {
      const row = el('div', 'timed', null, { gridColumn: column + 1, gridRow: free[i] + 2, '--ring': tile })
      row.appendChild(makeBadges(items[i].people))
      row.appendChild(el('span', 'time', items[i].time))
      row.appendChild(el('span', 'name', items[i].title))
      weekEl.appendChild(row)
    }
    if (overflow && free.length > 0) {
      weekEl.appendChild(
        el('div', 'more', `+${items.length - shown} more`, { gridColumn: column + 1, gridRow: free[free.length - 1] + 2 }),
      )
    }
  }

  // Past days: the page background, translucent, over the tiles and what is on them.
  const past = Math.min(7, TODAY_INDEX - first)
  if (past > 0) weekEl.appendChild(el('div', 'veil', null, { gridColumn: `1 / span ${past}` }))
  return weekEl
}

/** What the side panel lists: today and the three days after, with a few rows each. */
function buildPanel(random) {
  const panel = el('div', 'panel')
  const now = el('div', 'now')
  now.appendChild(el('div', 'big-date', '28'))
  const weekday = el('div', 'weekday', 'Wednesday')
  const clockLine = el('div', 'clock-line', '00:00:00')
  clockLine.id = 'panel-clock'
  weekday.appendChild(clockLine)
  now.appendChild(weekday)
  panel.appendChild(now)

  const days = el('div', 'days')
  const labels = ['Today', 'Thursday', 'Friday', 'Saturday']
  const forecasts = ['14° / 8°', '13° / 7°', '12° / 6°', '11° / 5°']
  labels.forEach((label, dayIndex) => {
    const day = el('section', 'day')
    const head = el('header', 'day-head')
    head.appendChild(el('h2', 'day-label', label))
    head.appendChild(el('div', 'day-weather', forecasts[dayIndex]))
    day.appendChild(head)
    const rows = el('div', 'rows')
    const count = dayIndex === 0 ? 4 : 3
    for (let i = 0; i < count; i++) {
      const hour = 8 + i * 3 + Math.floor(random() * 2)
      // Today's first rows are already over, as they are on the real panel.
      const row = el('div', dayIndex === 0 && i < 2 ? 'row over' : 'row')
      row.appendChild(makeBadges(pickPeople(random)))
      row.appendChild(el('span', 'time', `${pad2(hour)}:${random() > 0.5 ? '30' : '00'}`))
      row.appendChild(el('span', 'name', TIMED_TITLES[Math.floor(random() * TIMED_TITLES.length)]))
      rows.appendChild(row)
    }
    day.appendChild(rows)
    days.appendChild(day)
  })
  panel.appendChild(days)
  return panel
}

function buildMonthScene() {
  const random = seeded(2026)
  const events = makeEvents(random)

  const side = el('div', 'side')
  const title = el('h1', 'title')
  title.appendChild(el('span', 'month', 'October'))
  title.appendChild(el('span', 'year', '2026'))
  side.appendChild(title)
  side.appendChild(buildPanel(random))

  const grid = el('div', 'grid')
  const weekdays = el('div', 'weekdays')
  for (const name of WEEKDAYS) weekdays.appendChild(el('div', 'weekday-name', name))
  grid.appendChild(weekdays)
  const weeks = el('div', 'weeks')
  for (let week = 0; week < WEEK_COUNT; week++) weeks.appendChild(buildWeek(week, events))
  grid.appendChild(weeks)

  monthScene.replaceChildren(side, grid)
  return events.bars.length + events.timed.length
}

/** The clocks tick once a second, so the page has a little real work going on as the wall does. */
function startClocks() {
  const tick = () => {
    const now = new Date()
    const panel = document.getElementById('panel-clock')
    if (panel) panel.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
    document.getElementById('pill-clock').textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  }
  tick()
  setInterval(tick, 1000)
}

// ---------------------------------------------------------------------------------------------------------
// Photos: the files the probe was given, or four photo-like images drawn here.

/** Draws one 2560x1440 picture with a sky, a sun, soft clouds, ridges and grain, so the JPEG is the weight of a photo. */
function drawPhoto(ctx, seed) {
  const random = seeded(seed * 7919 + 13)
  const w = STAGE_WIDTH
  const h = STAGE_HEIGHT
  const hue = [28, 190, 215, 95][seed % 4] + random() * 20
  const horizon = h * (0.55 + random() * 0.1)

  const sky = ctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, `hsl(${hue + 200} 45% 22%)`)
  sky.addColorStop(0.6, `hsl(${hue + 20} 70% 62%)`)
  sky.addColorStop(1, `hsl(${hue} 85% 78%)`)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // The sun and its glow.
  const sunX = w * (0.2 + random() * 0.6)
  const sunY = horizon - h * (0.05 + random() * 0.2)
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.7)
  glow.addColorStop(0, 'rgba(255, 244, 214, 0.95)')
  glow.addColorStop(0.08, 'rgba(255, 220, 160, 0.6)')
  glow.addColorStop(1, 'rgba(255, 200, 140, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // A few hundred soft blobs: clouds above, bokeh below.
  for (let i = 0; i < 320; i++) {
    const x = random() * w
    const y = random() * h
    const r = 30 + random() * 260
    const alpha = 0.03 + random() * 0.14
    const light = random() > 0.5 ? '255 255 255' : '40 30 60'
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r)
    blob.addColorStop(0, `rgba(${light.replaceAll(' ', ',')}, ${alpha})`)
    blob.addColorStop(1, `rgba(${light.replaceAll(' ', ',')}, 0)`)
    ctx.fillStyle = blob
    ctx.fillRect(x - r, y - r * 0.6, r * 2, r * 1.2)
  }

  // Four ridges, each darker and lower than the one behind.
  for (let layer = 0; layer < 4; layer++) {
    const base = horizon + layer * h * 0.07 - h * 0.08
    const phase = random() * 10
    const amplitude = h * (0.05 - layer * 0.008)
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 8) {
      const y = base + Math.sin(x / (260 - layer * 40) + phase) * amplitude + Math.sin(x / 71 + phase * 2) * amplitude * 0.25
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = `hsl(${hue + 10 * layer} ${40 - layer * 6}% ${46 - layer * 11}%)`
    ctx.fill()
  }

  // Blades of grass along the bottom.
  ctx.lineWidth = 2
  for (let i = 0; i < 900; i++) {
    const x = random() * w
    const y = h - random() * h * 0.2
    ctx.strokeStyle = `hsla(${hue + 30} 45% ${12 + random() * 20}% / 0.5)`
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (random() - 0.5) * 24, y - 20 - random() * 60)
    ctx.stroke()
  }

  // Grain, so the encoder has fine detail to keep.
  const image = ctx.getImageData(0, 0, w, h)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const noise = (random() - 0.5) * 36
    data[i] += noise
    data[i + 1] += noise * 0.9
    data[i + 2] += noise * 1.1
  }
  ctx.putImageData(image, 0, 0)
}

async function generatePhotos(count) {
  const canvas = document.createElement('canvas')
  canvas.width = STAGE_WIDTH
  canvas.height = STAGE_HEIGHT
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const urls = []
  for (let i = 0; i < count; i++) {
    progress('preparing', `Drawing photo ${i + 1} of ${count}`)
    setStatus(`Preparing photos ${i + 1}/${count}`)
    drawPhoto(ctx, i)
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob gave nothing'))), 'image/jpeg', 0.9)
    })
    urls.push(URL.createObjectURL(blob))
    // Let the browser breathe between pictures; a Pi 4 takes a while over each.
    await nextFrame()
  }
  return urls
}

/** Real photos are fetched once into object URLs, so a swap measures decoding and drawing and not the loopback. */
async function loadPhotoFiles(paths) {
  const urls = []
  for (let i = 0; i < paths.length; i++) {
    setStatus(`Loading photos ${i + 1}/${paths.length}`)
    const response = await fetch(paths[i])
    if (!response.ok) throw new Error(`Photo ${paths[i]} answered ${response.status}`)
    urls.push(URL.createObjectURL(await response.blob()))
  }
  return urls
}

/** Loads and decodes off screen, as PhotoView does, and says how long that took. */
async function preload(url) {
  const image = new Image()
  image.src = url
  const began = performance.now()
  await image.decode()
  return { image, ms: performance.now() - began }
}

// ---------------------------------------------------------------------------------------------------------
// Frame statistics and the measuring loop

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}

function summarise(name, deltas, refreshMs) {
  const sorted = [...deltas].sort((a, b) => a - b)
  const total = deltas.reduce((sum, value) => sum + value, 0)
  const dropped = deltas.reduce((sum, value) => sum + Math.max(0, Math.round(value / refreshMs) - 1), 0)
  const median = sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  return {
    name,
    seconds: round(total / 1000, 1),
    frames: deltas.length,
    droppedFrames: dropped,
    frameMs: {
      mean: round(deltas.length ? total / deltas.length : 0),
      median: round(median),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
      max: round(sorted.length ? sorted[sorted.length - 1] : 0),
    },
  }
}

/**
 * Runs requestAnimationFrame for `seconds`, calling `onFrame(timestamp)` on every frame and recording the gap
 * since the previous one under the tag `classify(timestamp)` gives (default ""). The first frame only sets the
 * baseline, so the switch into a scene never counts as a slow frame. The status line is rewritten once a second.
 */
function measure(label, seconds, { onFrame, classify } = {}) {
  return new Promise((resolve) => {
    const deltas = new Map()
    let start = null
    let last = null
    let shownLeft = null
    const step = (timestamp) => {
      if (start === null) start = timestamp
      if (onFrame) onFrame(timestamp, start)
      if (last !== null) {
        const tag = classify ? classify(timestamp) : ''
        if (!deltas.has(tag)) deltas.set(tag, [])
        deltas.get(tag).push(timestamp - last)
      }
      last = timestamp
      const left = Math.max(0, Math.ceil(seconds - (timestamp - start) / 1000))
      if (left !== shownLeft) {
        shownLeft = left
        setStatus(`${label}: ${left} s left`)
      }
      if (timestamp - start >= seconds * 1000) resolve(deltas)
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// ---------------------------------------------------------------------------------------------------------
// Photo scene (PhotoView.vue): two stacked layers, the next photo decoded off screen then faded in over the old one.

/** The same four drifts as app/utils/motion.ts: in and out in turn, towards or from a different corner. */
const REST = 'scale(1)'
const zoomed = (x, y) => `scale(1.04) translate(${x}%, ${y}%)`
const DRIFTS = [
  { from: REST, to: zoomed(-1, -1) },
  { from: zoomed(1, 1), to: REST },
  { from: REST, to: zoomed(1, -1) },
  { from: zoomed(-1, 1), to: REST },
]

class PhotoFrame {
  constructor(config, urls) {
    this.layers = [document.getElementById('layer-0'), document.getElementById('layer-1')]
    this.config = config
    this.urls = urls
    this.top = null
    this.shown = 0
    this.nextUrl = 0
    this.fades = 0
    this.fadeStart = 0
    this.fadeEnd = 0
    this.decodeMs = []
    this.held = null
    this.drifting = new Map()
    stage.style.setProperty('--fade-seconds', `${config.fadeSeconds}s`)
  }

  /** Decodes the next photo off screen and records how long that took. */
  async decodeNext() {
    const url = this.urls[this.nextUrl++ % this.urls.length]
    const { image, ms } = await preload(url)
    this.decodeMs.push(round(ms, 1))
    this.held = image
    return url
  }

  startDrift(layer) {
    if (!this.config.drift) return
    const drift = DRIFTS[this.shown % DRIFTS.length]
    // A layer given a new photo takes the other of two identical keyframe sets, which restarts the animation.
    const name = this.drifting.get(layer) === 'a' ? 'b' : 'a'
    this.drifting.set(layer, name)
    layer.style.setProperty('--drift-from', drift.from)
    layer.style.setProperty('--drift-to', drift.to)
    layer.style.setProperty('--drift-seconds', `${this.config.photoIntervalSeconds + this.config.fadeSeconds}s`)
    layer.classList.remove('drift-a', 'drift-b')
    layer.classList.add(`drift-${name}`)
  }

  /** The first photo has nothing beneath it, so it appears at once. */
  async showFirst() {
    const url = await this.decodeNext()
    const layer = this.layers[0]
    layer.style.transition = 'none'
    layer.src = url
    this.startDrift(layer)
    layer.classList.add('top')
    void layer.offsetWidth
    layer.style.transition = ''
    this.top = 0
    this.shown++
  }

  /** Puts the decoded photo on the hidden layer and fades it in over the one on show, which stays solid beneath. */
  fadeTo(url) {
    const previous = this.layers[this.top]
    const target = this.layers[this.top === 0 ? 1 : 0]
    target.src = url
    this.startDrift(target)
    // Flush the layer at opacity 0 first, so the change below is a transition and not a jump.
    void target.offsetWidth
    previous.classList.remove('top')
    previous.classList.add('under')
    target.classList.add('top')
    this.fadeStart = performance.now()
    this.fadeEnd = this.fadeStart + this.config.fadeSeconds * 1000
    this.fades++
    this.top = this.top === 0 ? 1 : 0
    this.shown++
    setTimeout(() => {
      previous.classList.remove('under', 'drift-a', 'drift-b')
      previous.removeAttribute('src')
    }, this.config.fadeSeconds * 1000)
  }

  inFade(timestamp) {
    return timestamp >= this.fadeStart && timestamp < this.fadeEnd
  }
}

// ---------------------------------------------------------------------------------------------------------
// The run

async function run(config, results) {
  progress('fonts', 'Loading fonts')
  results.fonts = await checkFonts()
  results.colour = checkColours()
  results.gpu = checkGpu()

  progress('preparing', 'Preparing photos')
  const prepareBegan = performance.now()
  const files = config.photos.length > 0
  const urls = files ? await loadPhotoFiles(config.photos) : await generatePhotos(4)
  results.photos = {
    source: files ? 'files' : 'generated',
    count: urls.length,
    prepareMs: Math.round(performance.now() - prepareBegan),
    decodeMs: [],
  }

  const eventCount = buildMonthScene()
  startClocks()
  monthScene.hidden = false
  await nextFrame()

  progress('warmup', `Warming up on the month grid (${eventCount} events)`)
  const warm = await measure('Warm-up', config.warmupSeconds)
  const warmDeltas = [...warm.values()].flat()
  const refreshMs = median(warmDeltas) ?? FALLBACK_REFRESH_MS
  results.refreshIntervalMs = round(refreshMs)

  progress('month', `Measuring the month grid for ${config.monthSeconds} s`)
  const month = await measure('Month grid', config.monthSeconds)
  const monthDeltas = [...month.values()].flat()

  // Switch scenes, and show the first photo before measuring, as the wall does.
  const frame = new PhotoFrame(config, urls)
  await frame.showFirst()
  monthScene.hidden = true
  photoScene.hidden = false
  await nextFrame()

  progress('photo', `Measuring the photo frame for ${config.photoSeconds} s`)
  let swapping = false
  let nextSwapAt = null
  const photoMs = config.photoSeconds * 1000
  const photo = await measure('Photo frame', config.photoSeconds, {
    onFrame: (timestamp, start) => {
      if (nextSwapAt === null) nextSwapAt = start + config.photoIntervalSeconds * 1000
      // A swap that could not finish its fade before the phase ends would only muddy the last numbers.
      if (swapping || timestamp < nextSwapAt || start + photoMs - timestamp < config.fadeSeconds * 1000) return
      swapping = true
      frame
        .decodeNext()
        .then((url) => {
          frame.fadeTo(url)
          nextSwapAt = frame.fadeStart + config.photoIntervalSeconds * 1000
        })
        .catch((error) => recordError(`Photo swap failed: ${error.message}`))
        .finally(() => {
          swapping = false
        })
    },
    classify: (timestamp) => (frame.inFade(timestamp) ? 'crossfade' : ''),
  })

  results.phases = [
    summarise('month', monthDeltas, refreshMs),
    // Steady drift only: the fades are counted in their own row so the two can be compared.
    summarise('photo', photo.get('') ?? [], refreshMs),
    { ...summarise('crossfade', photo.get('crossfade') ?? [], refreshMs), fades: frame.fades },
  ]
  results.photos.decodeMs = frame.decodeMs
}

async function main() {
  fitStage()
  window.addEventListener('resize', fitStage)

  const results = {
    version: 1,
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, stageScale: 1 },
    refreshIntervalMs: 0,
    gpu: { webgl: false, vendor: '', renderer: '' },
    fonts: [],
    colour: null,
    phases: [],
    photos: { source: 'generated', count: 0, prepareMs: 0, decodeMs: [] },
    memory: null,
    errors,
  }

  let config
  try {
    const response = await fetch('/config.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`answered ${response.status}`)
    config = await response.json()
  } catch (error) {
    setStatus('')
    showMessage('No probe', `This page needs hw-probe render to serve it (could not read /config.json: ${error.message}).`)
    return
  }

  try {
    await run(config, results)
  } catch (error) {
    recordError(`Benchmark stopped: ${error && error.message ? error.message : error}`)
  }

  results.viewport.stageScale = round(stageScale, 4)
  results.viewport.width = window.innerWidth
  results.viewport.height = window.innerHeight
  if (performance.memory) {
    results.memory = {
      jsHeapUsedMB: round(performance.memory.usedJSHeapSize / 1048576, 1),
      jsHeapTotalMB: round(performance.memory.totalJSHeapSize / 1048576, 1),
    }
  }

  setStatus('Sending results')
  showMessage('Done', 'The probe has what it needs. You can look at the terminal now.')
  try {
    const response = await fetch('/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results),
    })
    if (!response.ok) throw new Error(`answered ${response.status}`)
    setStatus('Finished')
  } catch (error) {
    showMessage('Results not sent', `Could not post the results: ${error.message}`)
  }
}

main()

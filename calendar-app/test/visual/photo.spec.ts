import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { photoResponseSchema } from '../../shared/photos'
import type { PhotoInfo } from '../../shared/photos'
import { fontsReady, playServer } from './helpers'
import events from './fixtures/events.json' with { type: 'json' }
import weather from './fixtures/weather.json' with { type: 'json' }

// The photo frame at the frozen clock (Wed 28 Oct 2026, 09:41 in London). The
// photos are the server's real renders of the fixture pictures: the spec asks
// the server for photos until it has the one it wants, so which photo is on the
// wall does not depend on the playlist's shuffle, and the page is told that is
// the one the server chose. The sources are all in test/fixtures/photos/.

/** The next photo for a display no spec shows, so the playlist of the one under test is not touched. */
async function photoNamed(request: APIRequestContext, id: string): Promise<PhotoInfo> {
  const seen: string[] = []
  // The pool is listed in the background at start-up, so the first answers may be empty. Four photos: a round shows each once.
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await request.get('/api/photos/next?display=kitchen')
    const { photo } = photoResponseSchema.parse(await response.json())
    if (photo?.id === id) return photo
    if (photo) seen.push(photo.id)
    else await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`The server never offered ${id}, only ${seen.join(', ')}`)
}

/** Makes the page's request for a photo get `answer`. Returns the requests made. */
async function answerPhotos(page: Page, answer: () => { photo: PhotoInfo | null }) {
  const asked: string[] = []
  await page.route('**/api/photos/next**', async (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('display') ?? '')
    await route.fulfill({ json: answer() })
  })
  return asked
}

/** Waits for the photo on top to be drawn at full strength, so a screenshot is of the finished picture. */
async function photoShown(page: Page) {
  await fontsReady(page)
  const top = page.locator('[data-testid^="photo-layer-"].top')
  await expect(top).toHaveCount(1)
  await expect.poll(() => top.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true)
  await expect.poll(() => top.evaluate(image => getComputedStyle(image).opacity)).toBe('1')
}

test('a landscape photo with the clock, the weather and the next event', async ({ page, request }) => {
  const photo = await photoNamed(request, 'local:sunset-landscape.jpg')
  const asked = await answerPhotos(page, () => ({ photo }))
  await playServer(page, { view: 'photo' }, events, weather)
  await page.goto('/display?id=hallway')
  await photoShown(page)

  expect(asked).toEqual(['hallway'])
  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('photo-clock')).toHaveText('09:41')
  await expect(page.getByTestId('photo-weather')).toHaveText('12°')
  await expect(page.getByTestId('photo-next-time')).toHaveText('10:30')
  await expect(page.getByTestId('photo-next-title')).toHaveText('Rhyme time')
  await expect(page.getByTestId('photo-empty')).toHaveCount(0)
  await expect(page).toHaveScreenshot('landscape.png')
})

test('a portrait photo is centred over its blurred copy', async ({ page, request }) => {
  const photo = await photoNamed(request, 'local:tall-portrait.jpg')
  expect(photo.orientation).toBe('portrait')
  await answerPhotos(page, () => ({ photo }))
  await playServer(page, { view: 'photo' }, events, weather)
  await page.goto('/display?id=kitchen')
  await photoShown(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
  await expect(page).toHaveScreenshot('portrait.png')
})

test('the pill is just the clock when there is no weather and no event', async ({ page, request }) => {
  const photo = await photoNamed(request, 'local:sunset-landscape.jpg')
  await answerPhotos(page, () => ({ photo }))
  await playServer(page, { view: 'photo' }, [], null)
  await page.goto('/display?id=hallway')
  await photoShown(page)

  await expect(page.getByTestId('photo-clock')).toHaveText('09:41')
  await expect(page.getByTestId('photo-weather')).toHaveCount(0)
  await expect(page.getByTestId('photo-next-event')).toHaveCount(0)
  await expect(page).toHaveScreenshot('pill-clock-only.png')
})

test('a very long event title is cut with an ellipsis', async ({ page, request }) => {
  const photo = await photoNamed(request, 'local:tall-portrait.jpg')
  await answerPhotos(page, () => ({ photo }))
  // Tomorrow's dentist appointment is the only event left.
  const long = events.filter(event => event.display_title.startsWith('Dentist'))
  await playServer(page, { view: 'photo' }, long, weather)
  await page.goto('/display?id=hallway')
  await photoShown(page)

  await expect(page.getByTestId('photo-next-time')).toHaveText('Tomorrow 08:15')
  const title = page.getByTestId('photo-next-title')
  expect(await title.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await expect(page).toHaveScreenshot('pill-long-title.png')
})

test('with no photos there is a calm message, and the pill is still there', async ({ page }) => {
  const asked = await answerPhotos(page, () => ({ photo: null }))
  await playServer(page, { view: 'photo' }, events, weather)
  await page.goto('/display?id=hallway')
  await fontsReady(page)

  await expect(page.getByTestId('photo-empty')).toHaveText('No photos yet')
  await expect(page.getByTestId('photo-pill')).toBeVisible()
  expect(asked).toEqual(['hallway'])
  await expect(page).toHaveScreenshot('empty.png')
})

test('the overlay banner sits clear of the pill', async ({ page, request }) => {
  const photo = await photoNamed(request, 'local:sunset-landscape.jpg')
  await answerPhotos(page, () => ({ photo }))
  const text = 'Dinner is at six, so please wash your hands, put your shoes away and come and lay the table before the pasta goes cold, and tell Grandma we are nearly ready to eat'
  await playServer(page, { view: 'photo', overlay: { text, icon: 'utensils', until: null } }, events, weather)
  await page.goto('/display?id=hallway')
  await photoShown(page)

  // It rises in over 0.4 s: wait for it to be there in full.
  const bannerBox = page.getByTestId('overlay-banner')
  await expect.poll(() => bannerBox.evaluate(element => getComputedStyle(element.parentElement!).opacity)).toBe('1')
  await expect.poll(() => bannerBox.evaluate(element => getComputedStyle(element.parentElement!).transform)).toBe('none')
  const banner = (await bannerBox.boundingBox())!
  const pill = (await page.getByTestId('photo-pill').boundingBox())!
  expect(pill.y + pill.height).toBeLessThan(banner.y)
  await expect(page).toHaveScreenshot('overlay.png')
})

test('moves on to the next photo when the server says so, and only then', async ({ page, request }) => {
  const first = await photoNamed(request, 'local:sunset-landscape.jpg')
  const second = await photoNamed(request, 'local:tall-portrait.jpg')
  const queue = [first, second]
  const asked = await answerPhotos(page, () => ({ photo: queue.shift() ?? null }))
  const server = await playServer(page, { view: 'photo' }, events, weather)
  await page.goto('/display?id=hallway')
  await photoShown(page)
  await expect(page.locator('[data-testid="photo-layer-0"]')).toHaveAttribute('src', first.url)
  expect(asked).toHaveLength(1)

  server.sendPhotoNext()

  await expect(page.locator('[data-testid="photo-layer-1"]')).toHaveAttribute('src', second.url)
  await expect(page.locator('[data-testid="photo-layer-1"]')).toHaveClass(/top/)
  expect(asked).toHaveLength(2)
})

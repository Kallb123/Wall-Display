import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { photoResponseSchema } from '../../shared/photos'
import type { PhotoInfo } from '../../shared/photos'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { fontsReady, playServer, settle } from './helpers'
import weather from './fixtures/weather.json' with { type: 'json' }

// The week and photo view at the frozen clock (Wed 28 Oct 2026, 09:41 in
// London), on the landscape stage (PR 5.14, mock 4o): the photo on the left,
// about 3:4, with the compact pill and its lower right corner rounded, and the
// week beside it in its narrow seven-column layout. The pane is taller than it
// is wide, so the page asks for the portrait render of the photo. The portrait
// stage is in portrait.spec.ts.

const events = fixtureEvents({ configFile: 'test/visual/config.visual.yaml' })

/** The server's portrait render of `id`, asked for on a display no spec shows, so the playlist of the one under test is not touched. */
async function portraitPhotoNamed(request: APIRequestContext, id: string): Promise<PhotoInfo> {
  const seen: string[] = []
  // The pool is listed in the background at start-up, so the first answers may be empty.
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await request.get('/api/photos/next?display=porch&orientation=portrait')
    const { photo } = photoResponseSchema.parse(await response.json())
    if (photo?.id === id) return photo
    if (photo) seen.push(photo.id)
    else await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`The server never offered ${id}, only ${seen.join(', ')}`)
}

/** Makes the page's requests for a photo get `photo`. Returns the `orientation` each asked for. */
async function serve(page: Page, photo: PhotoInfo) {
  const asked: (string | null)[] = []
  await page.route('**/api/photos/next**', async (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('orientation'))
    await route.fulfill({ json: { photo } })
  })
  return asked
}

/** Waits for the photo to be drawn at full strength and for the week to be there, so a screenshot is of the finished page. */
async function shown(page: Page) {
  await settle(page)
  await fontsReady(page)
  const top = page.locator('[data-testid^="photo-layer-"].top')
  await expect(top).toHaveCount(1)
  await expect.poll(() => top.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true)
  await expect.poll(() => top.evaluate(image => getComputedStyle(image).opacity)).toBe('1')
}

test('the photo beside the week, light theme (mock 4o)', async ({ page, request }) => {
  const photo = await portraitPhotoNamed(request, 'local:tall-portrait.jpg')
  const asked = await serve(page, photo)
  await playServer(page, { view: 'week_photo' }, events, weather)
  await page.goto('/display?id=hallway')
  await shown(page)

  expect(asked).toEqual(['portrait'])
  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  expect((await page.getByTestId('week-photo-photo-pane').boundingBox())!.width).toBe(1100)
  expect((await page.getByTestId('week-photo-week-pane').boundingBox())!.width).toBe(1460)
  await expect(page.getByTestId('photo-clock')).toHaveText('09:41')
  await expect(page.getByTestId('photo-next-event')).toHaveCount(0)
  await expect(page.getByTestId('week-title')).toHaveText('26 Oct – 1 Nov This week')
  await expect(page).toHaveScreenshot('week-photo-light.png')
})

test('the photo beside the week, dark theme', async ({ page, request }) => {
  const photo = await portraitPhotoNamed(request, 'local:sunset-landscape.jpg')
  const asked = await serve(page, photo)
  await playServer(page, { view: 'week_photo' }, events, weather)
  await page.goto('/display?id=kitchen')
  await shown(page)

  expect(asked).toEqual(['portrait'])
  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
  await expect(page).toHaveScreenshot('week-photo-dark.png')
})

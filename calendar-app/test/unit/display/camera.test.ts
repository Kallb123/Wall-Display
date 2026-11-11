import { describe, expect, it } from 'vitest'
import type { CameraState } from '../../../shared/display'
import { cameraSecondsLeft, isCameraShowing } from '../../../app/utils/camera'

const NOW = new Date('2026-10-28T12:00:00Z')

const camera: CameraState = {
  id: 'front-door',
  name: 'Front door',
  url: 'http://go2rtc.local:1984/stream.html?src=front_door',
  kind: 'page',
  until: '2026-10-28T12:00:30.000Z',
  restore_screen: false,
}

describe('isCameraShowing', () => {
  it('is true until the camera\'s time is up', () => {
    expect(isCameraShowing(camera, NOW)).toBe(true)
    expect(isCameraShowing(camera, new Date('2026-10-28T12:00:29.999Z'))).toBe(true)
    expect(isCameraShowing(camera, new Date('2026-10-28T12:00:30Z'))).toBe(false)
  })

  it('is false with no camera', () => {
    expect(isCameraShowing(null, NOW)).toBe(false)
  })
})

describe('cameraSecondsLeft', () => {
  it('rounds up to whole seconds, and stops at 0', () => {
    expect(cameraSecondsLeft(camera, NOW)).toBe(30)
    expect(cameraSecondsLeft(camera, new Date('2026-10-28T12:00:29.200Z'))).toBe(1)
    expect(cameraSecondsLeft(camera, new Date('2026-10-28T12:01:00Z'))).toBe(0)
  })
})

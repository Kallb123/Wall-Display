import { describe, expect, it } from 'vitest'
import type { CameraState } from '../../../shared/display'
import { cameraRows, cameraSecondsLeft, isCameraShowing } from '../../../app/utils/camera'

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

describe('cameraRows', () => {
  const cameras = [{ id: 'front-door', name: 'Front door' }, { id: 'garden', name: 'Garden' }]

  it('lists every camera in config order, none on the wall', () => {
    expect(cameraRows(cameras, null)).toEqual([
      { id: 'front-door', name: 'Front door', live: false },
      { id: 'garden', name: 'Garden', live: false },
    ])
  })

  it('marks the camera on the wall', () => {
    expect(cameraRows(cameras, { id: 'garden', name: 'Garden' })).toEqual([
      { id: 'front-door', name: 'Front door', live: false },
      { id: 'garden', name: 'Garden', live: true },
    ])
  })

  it('puts a camera on the wall that the list lacks first, so it can still be hidden', () => {
    expect(cameraRows(cameras, { id: 'porch', name: 'Porch' })).toEqual([
      { id: 'porch', name: 'Porch', live: true },
      { id: 'front-door', name: 'Front door', live: false },
      { id: 'garden', name: 'Garden', live: false },
    ])
    expect(cameraRows([], camera)).toEqual([{ id: 'front-door', name: 'Front door', live: true }])
  })

  it('is empty with no cameras and none on the wall', () => {
    expect(cameraRows([], null)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { Cloud, CloudFog, CloudHail, CloudLightning, CloudRain, CloudRainWind, CloudSnow, CloudSun, Moon, Sun, TriangleAlert, Wind } from 'lucide-vue-next'
import { WEATHER_CONDITIONS } from '../../../shared/weather'
import { formatHighLow, weatherIcon } from '../../../app/utils/weather'

describe('weatherIcon', () => {
  it('picks a picture for each condition', () => {
    expect(weatherIcon('sunny')).toBe(Sun)
    expect(weatherIcon('clear-night')).toBe(Moon)
    expect(weatherIcon('partlycloudy')).toBe(CloudSun)
    expect(weatherIcon('cloudy')).toBe(Cloud)
    expect(weatherIcon('fog')).toBe(CloudFog)
    expect(weatherIcon('rainy')).toBe(CloudRain)
    expect(weatherIcon('pouring')).toBe(CloudRainWind)
    expect(weatherIcon('snowy')).toBe(CloudSnow)
    expect(weatherIcon('snowy-rainy')).toBe(CloudSnow)
    expect(weatherIcon('hail')).toBe(CloudHail)
    expect(weatherIcon('lightning')).toBe(CloudLightning)
    expect(weatherIcon('lightning-rainy')).toBe(CloudLightning)
    expect(weatherIcon('windy')).toBe(Wind)
    expect(weatherIcon('windy-variant')).toBe(Wind)
    expect(weatherIcon('exceptional')).toBe(TriangleAlert)
  })

  it('has one for every condition the server can send', () => {
    for (const condition of WEATHER_CONDITIONS) expect(weatherIcon(condition), condition).not.toBeNull()
  })

  it('gives nothing for no condition', () => {
    expect(weatherIcon(null)).toBeNull()
  })
})

describe('formatHighLow', () => {
  it('writes the high, then the low', () => {
    expect(formatHighLow({ high: 14, low: 8 })).toBe('14° / 8°')
  })

  it('rounds to whole degrees and never writes -0', () => {
    expect(formatHighLow({ high: 13.6, low: -0.4 })).toBe('14° / 0°')
  })

  it('leaves out the part that is missing', () => {
    expect(formatHighLow({ high: 14, low: null })).toBe('14°')
    expect(formatHighLow({ high: null, low: 8 })).toBe('8°')
  })

  it('is null when neither is known', () => {
    expect(formatHighLow({ high: null, low: null })).toBeNull()
  })
})

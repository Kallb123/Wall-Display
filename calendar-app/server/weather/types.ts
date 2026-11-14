// What the fetch hands the mapper, after checking the shape of Home Assistant's
// answers. Pure types: nothing here touches the network.

/** One day of `weather.get_forecasts` with `type: daily`. What an integration leaves out is null. */
export interface HaForecastEntry {
  /** As Home Assistant writes it, normally an ISO 8601 instant. The mapper reads it. */
  datetime: string
  /** Not checked against the known conditions here: the mapper does that. */
  condition: string | null
  temperature: number | null
  /** The day's low. */
  templow: number | null
}

/** One hour of `weather.get_forecasts` with `type: hourly`. What an integration leaves out is null. */
export interface HaHourlyEntry {
  /** As Home Assistant writes it, normally an ISO 8601 instant. The mapper reads it. */
  datetime: string
  condition: string | null
  temperature: number | null
  /** Millimetres (or inches, for some units) expected in the hour. */
  precipitation: number | null
  /** The chance of rain, in per cent. */
  precipitation_probability: number | null
}

/** The `weather` entity's state, its forecast, and the few attributes we use. */
export interface HaWeather {
  /** The current condition, or `unavailable` or `unknown`. */
  state: string
  attributes: {
    /** The current temperature. */
    temperature: number | null
    /** `°C` or `°F`, the unit of every temperature here. */
    temperature_unit: string | null
  }
  forecast: HaForecastEntry[]
  /** Empty when the integration has no hourly forecast. */
  hourly: HaHourlyEntry[]
}

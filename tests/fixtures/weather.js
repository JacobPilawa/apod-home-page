export function weatherFixture(now = Date.parse('2026-10-08T16:00:00Z')) {
  const start = Math.floor(now / 3600000) * 3600 - 12 * 3600;
  return {
    timezone: 'America/Los_Angeles',
    current_units: { temperature_2m: '°C' }, hourly_units: { temperature_2m: '°C' },
    current: { time: now / 1000, temperature_2m: 20, relative_humidity_2m: 74, weather_code: 2, is_day: 1 },
    hourly: {
      time: Array.from({ length: 72 }, (_, i) => start + i * 3600),
      temperature_2m: Array.from({ length: 72 }, (_, i) => 15 + Math.cos(i / 24 * 2 * Math.PI) * 5),
      precipitation_probability: Array.from({ length: 72 }, (_, i) => Math.round((1 + Math.sin(i / 12 * Math.PI)) * 30))
    }
  };
}

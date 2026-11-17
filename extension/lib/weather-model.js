import { readLocation } from './sky-model.js';

export const WEATHER_FRESH_MS = 15 * 60 * 1000;
export const WEATHER_STALE_MS = 6 * 60 * 60 * 1000;
const HOUR = 3600000;
const numberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function weatherLocationKey(location) {
  const valid = readLocation(location);
  return valid ? `${valid.latitude.toFixed(2)},${valid.longitude.toFixed(2)}` : null;
}

export function weatherUrl(location) {
  const key = weatherLocationKey(location);
  if (!key) throw new Error('Weather needs a location.');
  const [latitude, longitude] = key.split(',');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude, longitude, current: 'temperature_2m,relative_humidity_2m,weather_code,is_day', hourly: 'temperature_2m,precipitation_probability', temperature_unit: 'celsius', timezone: 'auto', timeformat: 'unixtime', forecast_days: '3' });
  return url.href;
}

export function parseWeather(data) {
  const current = data?.current;
  const hourly = data?.hourly;
  if (!numberIn(current?.time, 1, 1e11) || !numberIn(current?.temperature_2m, -120, 80) ||
      !Array.isArray(hourly?.time) || !Array.isArray(hourly.temperature_2m) || !Array.isArray(hourly.precipitation_probability) ||
      hourly.time.length !== hourly.temperature_2m.length || hourly.time.length !== hourly.precipitation_probability.length ||
      data.current_units?.temperature_2m !== '°C' || data.hourly_units?.temperature_2m !== '°C') throw new Error('Weather response is incomplete.');
  // Epoch timestamps keep the chart correct across midnight and DST changes.
  new Intl.DateTimeFormat('en', { timeZone: data.timezone }).format();
  if (typeof data.timezone !== 'string') throw new Error('Weather time zone is missing.');
  const hours = hourly.time.map((time, i) => {
    if (!numberIn(time, 1, 1e11) || (i && time - hourly.time[i - 1] !== 3600)) throw new Error('Invalid forecast times.');
    return {
      time: time * 1000,
      temperature: numberIn(hourly.temperature_2m[i], -120, 80) ? hourly.temperature_2m[i] : null,
      rain: numberIn(hourly.precipitation_probability[i], 0, 100) ? hourly.precipitation_probability[i] : null
    };
  });
  return {
    timeZone: data.timezone,
    current: { time: current.time * 1000, temperature: current.temperature_2m,
      humidity: numberIn(current.relative_humidity_2m, 0, 100) ? current.relative_humidity_2m : null,
      code: current.weather_code, isDay: current.is_day === 1 },
    hours
  };
}

export const temperatureIn = (celsius, unit) => celsius === null ? null : unit === 'F' ? celsius * 9 / 5 + 32 : celsius;

export function forecastWindow(data, now, unit = 'F') {
  let start = data.hours.findIndex(hour => hour.time > now) - 1;
  if (start === -2) start = data.hours.length - 1;
  if (start < 0) start = 0;
  const hours = data.hours.slice(start, start + 25).map(hour => ({ ...hour, temperature: temperatureIn(hour.temperature, unit) }));
  if (hours.length < 24 || hours[0].time > now + HOUR || hours.at(-1).time < now + 22 * HOUR ||
      hours.filter(hour => hour.temperature !== null).length < 2) throw new Error('No upcoming forecast.');
  const temperatures = hours.flatMap(hour => hour.temperature === null ? [] : [hour.temperature]);
  const padding = unit === 'F' ? 2 : 1;
  const min = Math.floor(Math.min(...temperatures) - padding);
  const max = Math.ceil(Math.max(...temperatures) + padding);
  return { hours, min, max, rain: hours.find(hour => hour.time >= now)?.rain ?? null };
}

export function readWeatherCache(cache, location, now = Date.now(), maxAge = WEATHER_FRESH_MS) {
  if (!weatherLocationKey(location) || !cache || cache.location !== weatherLocationKey(location) || !Number.isFinite(cache.fetchedAt) ||
      now < cache.fetchedAt || now - cache.fetchedAt >= maxAge) return null;
  try {
    const data = parseWeather(cache.data);
    if (Math.abs(now - data.current.time) > WEATHER_STALE_MS) return null;
    forecastWindow(data, now);
    return data;
  } catch { return null; }
}

export function weatherCondition(code, isDay) {
  if (code === 0) return isDay ? 'Sunny' : 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55].includes(code)) return 'Drizzle';
  if ([56, 57, 66, 67].includes(code)) return 'Freezing rain';
  if ([61, 63, 65, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 97, 99].includes(code)) return 'Thunderstorms';
  return 'Local weather';
}

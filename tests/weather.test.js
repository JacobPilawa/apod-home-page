import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherUrl, parseWeather, forecastWindow, readWeatherCache, temperatureIn, weatherCondition, WEATHER_FRESH_MS, WEATHER_STALE_MS } from '../extension/lib/weather-model.js';
import { weatherFixture } from './fixtures/weather.js';

const now = Date.parse('2026-10-08T16:00:00Z');
const location = { latitude: 37.7749, longitude: -122.4194 };

test('weather requests use rounded coordinates and UTC epochs without an API key', () => {
  const url = new URL(weatherUrl(location));
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '37.77');
  assert.equal(url.searchParams.get('longitude'), '-122.42');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.throws(() => weatherUrl(null));
});

test('the forecast covers the next 24 hours across midnight and DST with both series', () => {
  for (const instant of [now, Date.parse('2026-11-01T08:30:00Z'), Date.parse('2026-03-08T09:30:00Z')]) {
    const data = parseWeather(weatherFixture(instant));
    const forecast = forecastWindow(data, instant);
    assert.equal(forecast.hours.length, 25);
    assert.ok(forecast.hours[0].time <= instant);
    assert.equal(forecast.hours.at(-1).time - forecast.hours[0].time, 24 * 3600000);
    assert.ok(forecast.hours.every(hour => hour.rain >= 0 && hour.rain <= 100 && hour.temperature >= forecast.min && hour.temperature <= forecast.max));
  }
});

test('missing observations remain gaps, zero precipitation is preserved, and corrupt responses are rejected', () => {
  const fixture = weatherFixture();
  fixture.hourly.temperature_2m[13] = null;
  fixture.hourly.precipitation_probability[12] = 0;
  fixture.hourly.precipitation_probability[13] = null;
  const forecast = forecastWindow(parseWeather(fixture), now);
  assert.equal(forecast.rain, 0);
  assert.equal(forecast.hours[1].temperature, null);
  assert.equal(forecast.hours[1].rain, null);
  assert.throws(() => parseWeather({ error: true }));
  fixture.hourly.time[1] += 1;
  assert.throws(() => parseWeather(fixture));
  assert.throws(() => forecastWindow(parseWeather(weatherFixture()), now + 72 * 3600000));
});

test('cached weather expires and never leaks a previous location into a new forecast', () => {
  const cache = { location: '37.77,-122.42', fetchedAt: now, data: weatherFixture() };
  assert.ok(readWeatherCache(cache, location, now + WEATHER_FRESH_MS - 1));
  assert.equal(readWeatherCache(cache, location, now + WEATHER_FRESH_MS), null);
  assert.ok(readWeatherCache(cache, location, now + WEATHER_FRESH_MS, WEATHER_STALE_MS));
  assert.equal(readWeatherCache(cache, location, now + WEATHER_STALE_MS, WEATHER_STALE_MS), null);
  assert.equal(readWeatherCache(cache, { latitude: 0, longitude: 0 }, now), null);
  assert.equal(readWeatherCache({ ...cache, data: {} }, location, now), null);
  assert.equal(readWeatherCache({ ...cache, fetchedAt: now + 1 }, location, now), null);
});

test('temperature units and day/night conditions are explicit', () => {
  assert.equal(temperatureIn(0, 'F'), 32);
  assert.equal(temperatureIn(-40, 'F'), -40);
  assert.equal(temperatureIn(20, 'C'), 20);
  assert.equal(temperatureIn(null, 'F'), null);
  assert.equal(weatherCondition(0, true), 'Sunny');
  assert.equal(weatherCondition(0, false), 'Clear');
  assert.equal(weatherCondition(97, false), 'Thunderstorms');
});

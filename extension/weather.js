import { readLocation } from './lib/sky-model.js';
import { weatherLocationKey, weatherUrl, parseWeather, readWeatherCache, forecastWindow, temperatureIn, weatherCondition, WEATHER_STALE_MS } from './lib/weather-model.js';

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
let location = null;
let cache = null;
let data = null;
let unit = 'F';
let stale = false;
let controller = null;
let retryAt = 0;

function svgNode(tag, attributes = {}, text) {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderChart(forecast) {
  const width = Math.max(100, $('weather-chart').clientWidth);
  const height = 64;
  const left = 29, right = width - 30, top = 9, bottom = 46;
  const { hours, min, max } = forecast;
  const x = i => left + i / (hours.length - 1) * (right - left);
  const yTemperature = value => bottom - (value - min) / (max - min) * (bottom - top);
  const yRain = value => bottom - value / 100 * (bottom - top);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: data.timeZone });
  const fullTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: data.timeZone, timeZoneName: 'short' });
  const pointLabel = hour => `${fullTime.format(hour.time)}: ${hour.temperature === null ? 'temperature unavailable' : `${Math.round(hour.temperature)}°${unit}`}, ${hour.rain === null ? 'precipitation chance unavailable' : `${hour.rain}% precipitation chance`}`;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': 'weather-chart-title weather-chart-description' });
  svg.append(svgNode('title', { id: 'weather-chart-title' }, `Next 24 hours: temperature (°${unit}, left axis) and precipitation chance (%, right axis)`),
    svgNode('desc', { id: 'weather-chart-description' }, hours.map(pointLabel).join('; ')));
  for (const y of [top, bottom]) svg.append(svgNode('line', { x1: left, x2: right, y1: y, y2: y, class: 'chart-grid' }));
  for (const [value, y] of [[max, top], [min, bottom]]) svg.append(svgNode('text', { x: 0, y: y + 3, class: 'temperature-axis' }, `${value}°`));
  for (const [value, y] of [[100, top], [0, bottom]]) svg.append(svgNode('text', { x: width, y: y + 3, 'text-anchor': 'end', class: 'rain-axis' }, `${value}%`));
  // Missing observations break the line rather than silently becoming zero.
  for (const [field, y, className] of [['rain', yRain, 'rain-line'], ['temperature', yTemperature, 'temperature-line']]) {
    let path = '', connected = false;
    hours.forEach((hour, i) => {
      if (hour[field] === null) { connected = false; return; }
      path += `${connected ? 'L' : 'M'}${x(i).toFixed(1)},${y(hour[field]).toFixed(1)} `;
      connected = true;
    });
    svg.append(svgNode('path', { d: path, class: `forecast-line ${className}` }));
  }
  const step = width >= 440 ? 3 : width >= 230 ? 6 : 12;
  hours.forEach((hour, i) => {
    if (i % step === 0) svg.append(svgNode('text', { x: x(i), y: 62, 'text-anchor': 'middle' }, time.format(hour.time).replace(/\s/g, '')));
    const hit = svgNode('rect', { x: x(i) - (right - left) / (hours.length - 1) / 2, y: 0, width: (right - left) / (hours.length - 1), height: 50, fill: 'transparent' });
    hit.append(svgNode('title', {}, pointLabel(hour)));
    svg.append(hit);
  });
  $('weather-chart').replaceChildren(svg);
}

function showStatus(message) {
  $('weather-content').hidden = true;
  $('weather-status').hidden = false;
  $('weather-status').textContent = message;
  $('weather').setAttribute('aria-busy', 'false');
}

function render() {
  if (!data) return;
  let forecast;
  try { forecast = forecastWindow(data, Date.now(), unit); }
  catch { showStatus('Weather is updating…'); return; }
  $('weather-content').hidden = false;
  $('weather-status').hidden = true;
  $('weather').setAttribute('aria-busy', 'false');
  $('weather-temperature').textContent = Math.round(temperatureIn(data.current.temperature, unit));
  $('weather-condition').textContent = weatherCondition(data.current.code, data.current.isDay);
  const updated = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: data.timeZone }).format(data.current.time);
  $('weather-updated').textContent = `${stale ? 'Saved' : 'Now'} · ${updated}`;
  $('weather-updated').title = `${stale ? 'Offline or update unavailable. Last conditions' : 'Conditions updated'}: ${new Date(data.current.time).toLocaleString(undefined, { timeZone: data.timeZone, timeZoneName: 'short' })}`;
  $('weather-rain').textContent = forecast.rain === null ? '—' : `${Math.round(forecast.rain)}%`;
  $('weather-rain').title = 'Precipitation chance in the next forecast hour (rain or snow).';
  $('weather-humidity').textContent = data.current.humidity === null ? '—' : `${Math.round(data.current.humidity)}%`;
  for (const [id, value] of [['weather-fahrenheit', 'F'], ['weather-celsius', 'C']]) $(id).setAttribute('aria-pressed', String(unit === value));
  renderChart(forecast);
}

async function refresh() {
  const key = weatherLocationKey(location);
  if (!key) { showStatus('Allow Location in Chrome or set coordinates in Customize for weather.'); return; }
  if (controller || Date.now() < retryAt) return;
  const fresh = readWeatherCache(cache, location);
  if (fresh) { data = fresh; stale = false; render(); return; }
  data = readWeatherCache(cache, location, Date.now(), WEATHER_STALE_MS);
  if (data) { stale = true; render(); }
  else showStatus('Loading local weather…');
  $('weather').setAttribute('aria-busy', 'true');
  const request = new AbortController();
  controller = request;
  const timeout = setTimeout(() => request.abort(), 12000);
  try {
    const response = await fetch(weatherUrl(location), { signal: request.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
    const raw = await response.json();
    const next = parseWeather(raw);
    if (Math.abs(Date.now() - next.current.time) > 3600000) throw new Error('Current conditions are outdated.');
    forecastWindow(next, Date.now());
    if (controller !== request || key !== weatherLocationKey(location)) return;
    data = next;
    cache = { location: key, fetchedAt: Date.now(), data: raw };
    stale = false;
    retryAt = 0;
    render();
    // A full/quota-limited storage area must not discard a successful forecast.
    try { await chrome.storage.local.set({ weatherCache: cache }); } catch { /* Keep this tab's forecast. */ }
  } catch {
    if (controller !== request || key !== weatherLocationKey(location)) return;
    retryAt = Date.now() + 5 * 60000;
    if (data) { stale = true; render(); }
    else showStatus('Weather unavailable · Will retry automatically');
  } finally {
    clearTimeout(timeout);
    if (controller === request) { controller = null; $('weather').setAttribute('aria-busy', 'false'); }
  }
}

function setLocation(value) {
  const next = readLocation(value);
  if (weatherLocationKey(location) === weatherLocationKey(next)) return;
  controller?.abort();
  controller = null;
  data = null;
  retryAt = 0;
  location = next;
  refresh();
}

async function init() {
  const saved = await chrome.storage.local.get(['observerLocation', 'weatherCache', 'weatherUnit']);
  cache = saved.weatherCache || null;
  unit = ['F', 'C'].includes(saved.weatherUnit) ? saved.weatherUnit : /^en-US\b/i.test(navigator.language) ? 'F' : 'C';
  location = readLocation(saved.observerLocation);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.observerLocation) setLocation(changes.observerLocation.newValue);
    if (changes.weatherUnit && ['F', 'C'].includes(changes.weatherUnit.newValue)) { unit = changes.weatherUnit.newValue; render(); }
    if (changes.weatherCache) {
      cache = changes.weatherCache.newValue || null;
      const fresh = readWeatherCache(cache, location);
      if (fresh) { data = fresh; stale = false; render(); }
    }
  });
  for (const [id, value] of [['weather-fahrenheit', 'F'], ['weather-celsius', 'C']]) $(id).addEventListener('click', () => {
    unit = value;
    render();
    chrome.storage.local.set({ weatherUnit: value }).catch(() => {});
  });
  new ResizeObserver(() => { if (data && !$('weather-content').hidden) render(); }).observe($('weather-chart'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', () => { retryAt = 0; refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  refresh();
}
init().catch(() => showStatus('Weather unavailable. Open a new tab to retry.'));

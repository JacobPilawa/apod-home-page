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
  const height = 78;
  const left = 29, right = width - 38, top = 18, bottom = 59;
  const { hours, min, max } = forecast;
  const x = i => left + i / (hours.length - 1) * (right - left);
  const yTemperature = value => bottom - (value - min) / (max - min) * (bottom - top);
  const yRain = value => bottom - value / 100 * (bottom - top);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: data.timeZone });
  const day = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: data.timeZone });
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: data.timeZone });
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: data.timeZone });
  const boundaries = hours.flatMap((hour, i) => (i ? day.format(hour.time) !== day.format(hours[i - 1].time) : clock.format(hour.time) === '00:00') ? [i] : []);
  const fullTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: data.timeZone, timeZoneName: 'short' });
  const pointLabel = hour => `${fullTime.format(hour.time)}: ${hour.temperature === null ? 'temperature unavailable' : `${Math.round(hour.temperature)}°${unit}`}, ${hour.rain === null ? 'precipitation chance unavailable' : `${hour.rain}% precipitation chance`}`;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', tabindex: '0', 'aria-label': `Next 24 hours: temperature (°${unit}, left axis) and precipitation chance (%, right axis). Use arrow keys to explore.`, 'aria-describedby': 'weather-chart-description weather-readout' });
  svg.append(svgNode('desc', { id: 'weather-chart-description' }, hours.map(pointLabel).join('; ')));
  for (const y of [top, bottom]) svg.append(svgNode('line', { x1: left, x2: right, y1: y, y2: y, class: 'chart-grid' }));
  for (const [value, y] of [[max, top], [min, bottom]]) svg.append(svgNode('text', { x: 0, y: y + 3, class: 'temperature-axis' }, `${value}°`));
  for (const [value, y] of [[100, top], [0, bottom]]) svg.append(svgNode('text', { x: width, y: y + 3, 'text-anchor': 'end', class: 'rain-axis' }, `${value}%`));
  for (const i of boundaries) {
    svg.append(svgNode('line', { x1: x(i), x2: x(i), y1: 8, y2: bottom + 3, class: 'day-boundary' }));
  }
  const now = Date.now();
  if (now >= hours[0].time && now <= hours.at(-1).time) {
    const currentX = left + (now - hours[0].time) / (hours.at(-1).time - hours[0].time) * (right - left);
    svg.append(svgNode('line', { x1: currentX, x2: currentX, y1: 8, y2: bottom + 3, class: 'current-time', 'aria-label': 'Current time' }));
  }
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
    const boundary = boundaries.includes(i);
    if (boundary || (i % step === 0 && boundaries.every(b => Math.abs(x(i) - x(b)) > 46))) {
      const label = time.format(hour.time).replace(/\s/g, '');
      svg.append(svgNode('text', { x: x(i), y: 76, 'text-anchor': 'middle', class: boundary ? 'day-label' : 'time-label' }, boundary ? `${weekday.format(hour.time)} ${label}` : label));
    }
    if (i % step === 0 && hour.temperature !== null) svg.append(svgNode('text', { x: x(i), y: yTemperature(hour.temperature) - 6, 'text-anchor': i === 0 ? 'start' : i === hours.length - 1 ? 'end' : 'middle', class: 'temperature-value' }, `${Math.round(hour.temperature)}°`));
  });

  svg.append(svgNode('rect', { x: 0, y: 0, width, height, fill: 'transparent', 'aria-hidden': 'true' }));
  const scrub = svgNode('g', { class: 'weather-scrub', visibility: 'hidden', 'aria-hidden': 'true', 'pointer-events': 'none' });
  const guide = svgNode('line', { y1: 17, y2: bottom + 3 });
  const temperatureDot = svgNode('circle', { r: 2.5, class: 'scrub-temperature' });
  const rainDot = svgNode('circle', { r: 2.5, class: 'scrub-rain' });
  scrub.append(guide, temperatureDot, rainDot);
  svg.append(scrub);
  const readout = document.createElement('div');
  readout.id = 'weather-readout';
  readout.className = 'weather-readout';
  readout.setAttribute('role', 'tooltip');
  readout.setAttribute('aria-live', 'polite');
  readout.setAttribute('aria-atomic', 'true');
  readout.hidden = true;
  const hoverTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: data.timeZone });
  let selected = -1;
  function showHour(index) {
    selected = Math.max(0, Math.min(hours.length - 1, index));
    const hour = hours[selected];
    const px = x(selected);
    guide.setAttribute('x1', px);
    guide.setAttribute('x2', px);
    for (const [dot, value, y] of [[temperatureDot, hour.temperature, yTemperature], [rainDot, hour.rain, yRain]]) {
      if (value === null) dot.setAttribute('display', 'none');
      else dot.removeAttribute('display');
      if (value !== null) { dot.setAttribute('cx', px); dot.setAttribute('cy', y(value)); }
    }
    scrub.setAttribute('visibility', 'visible');
    readout.textContent = `${hoverTime.format(hour.time)} · ${hour.temperature === null ? '—' : `${Math.round(hour.temperature)}°${unit}`} · Precip ${hour.rain === null ? '—' : `${Math.round(hour.rain)}%`}`;
    readout.hidden = false;
    readout.style.left = `${Math.max(0, Math.min(width - readout.offsetWidth, px - readout.offsetWidth / 2))}px`;
    $('weather-chart').setAttribute('data-scrubbing', '');
  }
  function clearScrub() {
    selected = -1;
    scrub.setAttribute('visibility', 'hidden');
    readout.hidden = true;
    $('weather-chart').removeAttribute('data-scrubbing');
  }
  svg.addEventListener('pointermove', event => {
    const bounds = svg.getBoundingClientRect();
    const px = (event.clientX - bounds.left) / bounds.width * width;
    const index = Math.max(0, Math.min(hours.length - 1, Math.round((px - left) / (right - left) * (hours.length - 1))));
    if (index !== selected) showHour(index);
  });
  svg.addEventListener('pointerleave', clearScrub);
  svg.addEventListener('blur', clearScrub);
  svg.addEventListener('keydown', event => {
    const current = selected < 0 ? Math.round((now - hours[0].time) / 3600000) : selected;
    if (event.key === 'Escape') { clearScrub(); return; }
    const index = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: hours.length - 1 }[event.key];
    if (index === undefined) return;
    event.preventDefault();
    showHour(index);
  });
  $('weather-chart').removeAttribute('data-scrubbing');
  $('weather-chart').replaceChildren(svg, readout);
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
  $('weather-saved').hidden = !stale;
  $('weather-saved').title = `Update unavailable. Last conditions: ${updated}`;
  $('weather-condition').title = `Conditions updated: ${new Date(data.current.time).toLocaleString(undefined, { timeZone: data.timeZone, timeZoneName: 'short' })}`;
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
  new ResizeObserver(([entry]) => {
    $('weather').style.width = `${entry.contentRect.width}px`;
  }).observe(document.querySelector('.sky-strip'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', () => { retryAt = 0; refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  refresh();
}
init().catch(() => showStatus('Weather unavailable. Open a new tab to retry.'));

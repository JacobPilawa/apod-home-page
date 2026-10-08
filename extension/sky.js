import { localSky, readLocation, locationFromInputs } from './lib/sky-model.js';

const $ = id => document.getElementById(id);
let savedLocation = null;
let selectedDay = null;
let detectedDraft = null;
let locationRequest = 0;

export function prepareLocationSettings() {
  locationRequest++;
  const location = readLocation(savedLocation);
  detectedDraft = savedLocation?.automatic ? savedLocation : null;
  $('sky-latitude').value = location?.latitude ?? '';
  $('sky-longitude').value = location?.longitude ?? '';
  $('sky-location-status').textContent = '';
}

export function readLocationInputs() {
  const location = locationFromInputs($('sky-latitude').value, $('sky-longitude').value);
  if (location && detectedDraft?.latitude === location.latitude && detectedDraft?.longitude === location.longitude) return detectedDraft;
  return location;
}

function renderTime(id, date, ready, missing) {
  const el = $(id);
  const minute = date && new Date(Math.round(date.getTime() / 60000) * 60000);
  el.textContent = !ready ? '—' : minute ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(minute) : missing;
  el.title = !ready ? 'Location unavailable. Set coordinates in Customize.' : date ? date.toLocaleString(undefined, { timeZoneName: 'short' }) : `${missing} on this date.`;
}

function renderSky() {
  const current = new Date();
  const currentDay = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
  const now = selectedDay && selectedDay !== currentDay ? new Date(`${selectedDay}T12:00:00`) : current;
  const location = readLocation(savedLocation);
  const sky = localSky(now, location);
  const ready = Boolean(location);
  renderTime('sunrise-time', sky.sun?.sunrise, ready, 'No rise');
  renderTime('sunset-time', sky.sun?.sunset, ready, 'No set');
  renderTime('moonrise-time', sky.moon?.rise, ready, 'No rise');
  renderTime('moonset-time', sky.moon?.set, ready, 'No set');
  $('moon-phase').textContent = sky.phase;
  $('moon-illumination').textContent = `· ${Math.round(sky.illumination.fraction * 100)}%`;
  $('moon-illumination').title = 'Illuminated fraction of the Moon';
}

function detectLocation() {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve({
    latitude: Math.round(position.coords.latitude * 100) / 100,
    longitude: Math.round(position.coords.longitude * 100) / 100,
    automatic: true,
    checkedAt: Date.now()
  }), reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }));
}

async function updateAutomaticLocation() {
  if (readLocation(savedLocation) && !savedLocation.automatic) return;
  if (readLocation(savedLocation) && Date.now() - savedLocation.checkedAt < 300000) return;
  const request = ++locationRequest;
  try {
    const location = await detectLocation();
    if (request !== locationRequest) return;
    await chrome.storage.local.set({ observerLocation: location });
  } catch { /* Keep saved coordinates, or show dashes until location is available. */ }
}

$('use-sky-location').addEventListener('click', async () => {
  const request = ++locationRequest;
  $('use-sky-location').disabled = true;
  $('sky-location-status').textContent = 'Detecting…';
  try {
    const location = await detectLocation();
    if (request !== locationRequest) return;
    detectedDraft = location;
    $('sky-latitude').value = location.latitude;
    $('sky-longitude').value = location.longitude;
    $('sky-location-status').textContent = 'Location detected. Save changes to use it.';
  } catch {
    if (request === locationRequest) $('sky-location-status').textContent = 'Location unavailable. You can enter coordinates instead.';
  } finally { $('use-sky-location').disabled = false; }
});
$('clear-sky-location').addEventListener('click', () => {
  locationRequest++;
  detectedDraft = null;
  $('sky-latitude').value = '';
  $('sky-longitude').value = '';
  $('sky-location-status').textContent = 'Save changes to use automatic location.';
});
$('settings-dialog').addEventListener('close', () => locationRequest++);
document.addEventListener('apod-day-changed', event => { selectedDay = event.detail; renderSky(); });

async function init() {
  savedLocation = (await chrome.storage.local.get('observerLocation')).observerLocation || null;
  renderSky();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.observerLocation) {
      locationRequest++;
      savedLocation = changes.observerLocation.newValue || null;
      renderSky();
      if (!readLocation(savedLocation)) updateAutomaticLocation();
    }
  });
  updateAutomaticLocation();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderSky(); updateAutomaticLocation(); } });
  setInterval(() => { if (!document.hidden) renderSky(); }, 60000);
}
init().catch(error => console.warn('Could not load local sun and moon:', error));

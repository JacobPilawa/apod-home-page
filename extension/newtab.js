import { fetchPicture } from './lib/apod.js';
import { DEFAULT_SETTINGS, MAX_SHORTCUTS, FIRST_APOD_DAY, dayKey, pictureDay, offsetDay, formatPictureDay, readSettings, shouldRefresh, validateShortcuts } from './lib/model.js';

const $ = id => document.getElementById(id);
let settings = { ...DEFAULT_SETTINGS };
let cache = null;
let topSites = [];
let draft = [];
let refreshing = false;
let displayedDay = null;
let selectedDay = null;
const archiveCache = new Map();

function applyTheme() { document.documentElement.dataset.theme = settings.theme; }

function updateNavigation() {
  $('previous-day').disabled = refreshing || !displayedDay || displayedDay <= FIRST_APOD_DAY;
  $('next-day').disabled = refreshing || !displayedDay || displayedDay >= dayKey();
  $('today-button').disabled = refreshing;
  $('next-day').title = displayedDay >= dayKey() ? 'Tomorrow’s APOD has not been published yet.' : 'Next day';
}

function mediaMessage(text, url, label = 'Open on APOD ↗') {
  const box = document.createElement('div');
  box.className = 'media-message';
  const message = document.createElement('span');
  message.textContent = text;
  box.append(message);
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = label;
    box.append(link);
  }
  $('media').replaceChildren(box);
}

function renderPicture(data) {
  displayedDay = pictureDay(data.dateKey || data.date);
  $('picture-date').dateTime = displayedDay;
  $('picture-date').textContent = formatPictureDay(displayedDay);
  $('picture-title').textContent = data.title;
  $('picture-credit').textContent = data.credit ? (/(?:credit|copyright):/i.test(data.credit) ? data.credit : `Image credit: ${data.credit}`) : '';
  $('explanation').textContent = data.explanation;
  $('source-link').href = data.sourceUrl;
  $('source-link').title = `APOD · ${data.date}`;
  $('caption-toggle').hidden = false;
  $('caption-toggle').textContent = 'Read explanation';
  $('caption-toggle').setAttribute('aria-expanded', 'false');
  $('explanation').classList.add('collapsed');
  if (data.mediaType !== 'image') {
    mediaMessage('Today’s APOD is a video. Enjoy it on the original page.', data.sourceUrl, 'Watch today’s APOD ↗');
  } else {
    const link = document.createElement('a');
    link.href = data.fullImageUrl || data.imageUrl;
    link.title = 'Open the full image';
    const image = document.createElement('img');
    image.alt = data.alt || data.title;
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      // Ignore late errors from an image that a refresh has already replaced.
      if (image.isConnected) mediaMessage('The image could not load. Your shortcuts are still ready.', data.sourceUrl);
    }, { once: true });
    image.src = data.imageUrl;
    link.append(image);
    $('media').replaceChildren(link);
  }
  document.querySelector('.apod').setAttribute('aria-busy', 'false');
}

async function refreshPicture(force = false, requestedDay = null) {
  if (refreshing || (!force && !shouldRefresh(cache))) return;
  if (requestedDay && (requestedDay < FIRST_APOD_DAY || requestedDay > dayKey())) return;
  if (requestedDay === dayKey()) requestedDay = null;
  refreshing = true;
  updateNavigation();
  document.querySelector('.apod').setAttribute('aria-busy', 'true');
  $('status').textContent = requestedDay ? `Loading ${formatPictureDay(requestedDay)}…` : 'Checking for today’s picture…';
  try {
    const data = requestedDay && archiveCache.has(requestedDay) ? archiveCache.get(requestedDay) : await fetchPicture({ date: requestedDay });
    selectedDay = requestedDay;
    renderPicture(data);
    $('status').textContent = '';
    if (requestedDay) {
      archiveCache.set(requestedDay, data);
      if (archiveCache.size > 30) archiveCache.delete(archiveCache.keys().next().value);
    } else {
      cache = { data, checkedAt: Date.now(), checkedDay: dayKey() };
      retryAfter = 0;
      try { await chrome.storage.local.set({ apodCache: cache }); }
      catch { $('status').textContent = 'Picture loaded. Could not save it for the next tab.'; }
    }
  } catch (error) {
    console.warn('APOD refresh failed:', error.message);
    // Back off for five minutes, including when no saved picture is available.
    if (!requestedDay) retryAfter = Date.now() + 5 * 60 * 1000;
    if (requestedDay) {
      $('status').textContent = `Could not load ${formatPictureDay(requestedDay)}. Try the arrow again or return to Today.`;
    } else if (displayedDay) {
      $('status').textContent = 'Showing the last saved APOD. Today’s update is unavailable; try Today again.';
    } else {
      mediaMessage('The cosmos will be back shortly. APOD is unavailable right now.', 'https://apod.com/en/');
      $('status').textContent = 'Try Today again. Your site shortcuts work independently.';
      document.querySelector('.apod').setAttribute('aria-busy', 'false');
    }
  } finally {
    refreshing = false;
    document.querySelector('.apod').setAttribute('aria-busy', 'false');
    updateNavigation();
  }
}

function renderShortcuts() {
  const sites = settings.shortcutMode === 'custom' ? settings.shortcuts : topSites;
  const nodes = sites.map(site => {
    const link = document.createElement('a');
    link.className = 'shortcut';
    link.href = site.url;
    link.title = `${site.title}\n${site.url}`;
    const circle = document.createElement('span');
    circle.className = 'shortcut-icon';
    const initial = document.createElement('span');
    initial.textContent = site.title.slice(0, 1).toUpperCase();
    circle.append(initial);
    const image = document.createElement('img');
    image.alt = '';
    const favicon = new URL(chrome.runtime.getURL('/_favicon/'));
    favicon.searchParams.set('pageUrl', site.url);
    favicon.searchParams.set('size', '32');
    image.addEventListener('load', () => { initial.hidden = true; }, { once: true });
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = favicon.href;
    circle.append(image);
    const title = document.createElement('span');
    title.className = 'shortcut-name';
    title.textContent = site.title;
    link.append(circle, title);
    return link;
  });
  // Keep a full row of ten sites aligned like Chrome's original layout.
  if (sites.length < 10) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'shortcut add-tile';
    const icon = document.createElement('span');
    icon.className = 'shortcut-icon';
    icon.textContent = '+';
    const title = document.createElement('span');
    title.className = 'shortcut-name';
    title.textContent = 'Add shortcut';
    add.append(icon, title);
    add.addEventListener('click', () => openSettings(true));
    nodes.push(add);
  }
  $('shortcuts-grid').replaceChildren(...nodes);
  $('shortcuts-empty').hidden = sites.length > 0;
}

function collectDraft() {
  draft = [...$('shortcut-rows').children].map(row => ({ title: row.querySelector('[data-field="title"]').value, url: row.querySelector('[data-field="url"]').value }));
}

function renderDraft(focusIndex = -1) {
  const rows = draft.map((site, index) => {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    for (const field of ['title', 'url']) {
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.field = field;
      input.value = site[field];
      input.placeholder = field === 'title' ? 'Site name' : 'https://example.com';
      input.setAttribute('aria-label', `${field === 'title' ? 'Name' : 'Address'} of shortcut ${index + 1}`);
      input.maxLength = field === 'title' ? 100 : 2048;
      if (field === 'url') input.spellcheck = false;
      row.append(input);
    }
    const controls = document.createElement('div');
    controls.className = 'row-controls';
    for (const [label, symbol, offset] of [['Move up', '↑', -1], ['Move down', '↓', 1], ['Remove', '×', 0]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = symbol;
      button.setAttribute('aria-label', `${label} shortcut ${index + 1}`);
      button.disabled = offset === -1 ? index === 0 : offset === 1 && index === draft.length - 1;
      button.addEventListener('click', () => {
        collectDraft();
        if (offset === 0) draft.splice(index, 1);
        else [draft[index], draft[index + offset]] = [draft[index + offset], draft[index]];
        renderDraft(Math.min(Math.max(index + offset, 0), draft.length - 1));
      });
      controls.append(button);
    }
    row.append(controls);
    return row;
  });
  $('shortcut-rows').replaceChildren(...rows);
  $('add-shortcut').disabled = draft.length >= MAX_SHORTCUTS;
  if (focusIndex >= 0) rows[focusIndex]?.querySelector('input').focus();
}

function openSettings(add = false) {
  draft = settings.shortcuts.map(site => ({ ...site }));
  $('theme').value = settings.theme;
  const mode = add ? 'custom' : settings.shortcutMode;
  document.querySelector(`input[name="shortcut-mode"][value="${mode}"]`).checked = true;
  if (add) {
    if (settings.shortcutMode === 'automatic') draft = topSites.map(site => ({ ...site }));
    if (draft.length < MAX_SHORTCUTS) draft.push({ title: '', url: '' });
  }
  $('shortcut-editor').hidden = mode !== 'custom';
  $('settings-error').textContent = '';
  renderDraft();
  $('settings-dialog').showModal();
  if (add) $('shortcut-rows').lastElementChild?.querySelector('input').focus();
}

$('settings-button').addEventListener('click', () => openSettings());
for (const id of ['close-settings', 'cancel-settings']) $(id).addEventListener('click', () => $('settings-dialog').close());
for (const radio of document.querySelectorAll('input[name="shortcut-mode"]')) {
  radio.addEventListener('change', () => {
    const custom = radio.value === 'custom';
    $('shortcut-editor').hidden = !custom;
    if (custom && !draft.length) { draft = topSites.map(site => ({ ...site })); renderDraft(); }
  });
}
$('add-shortcut').addEventListener('click', () => {
  collectDraft();
  if (draft.length >= MAX_SHORTCUTS) return;
  draft.push({ title: '', url: '' });
  renderDraft(draft.length - 1);
});
$('copy-top-sites').addEventListener('click', () => { draft = topSites.map(site => ({ ...site })); renderDraft(); });
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('settings-error').textContent = '';
  try {
    const mode = document.querySelector('input[name="shortcut-mode"]:checked').value;
    collectDraft();
    const next = { theme: $('theme').value, shortcutMode: mode, shortcuts: mode === 'custom' ? validateShortcuts(draft) : settings.shortcuts };
    await chrome.storage.local.set({ settings: next });
    settings = next;
    applyTheme();
    renderShortcuts();
    $('settings-dialog').close();
  } catch (error) { $('settings-error').textContent = error.message || 'Could not save your changes.'; }
});
$('caption-toggle').addEventListener('click', () => {
  const expanded = $('caption-toggle').getAttribute('aria-expanded') !== 'true';
  $('caption-toggle').setAttribute('aria-expanded', String(expanded));
  $('caption-toggle').textContent = expanded ? 'Show less' : 'Read explanation';
  $('explanation').classList.toggle('collapsed', !expanded);
});
$('today-button').addEventListener('click', () => refreshPicture(true));
$('previous-day').addEventListener('click', () => { if (displayedDay) refreshPicture(true, offsetDay(displayedDay, -1)); });
$('next-day').addEventListener('click', () => { if (displayedDay) refreshPicture(true, offsetDay(displayedDay, 1)); });

let retryAfter = 0;
function checkForUpdate() { if (selectedDay === null && !document.hidden && Date.now() >= retryAfter) refreshPicture(); }
document.addEventListener('visibilitychange', checkForUpdate);
setInterval(checkForUpdate, 60 * 1000);

async function init() {
  const saved = await chrome.storage.local.get(['settings', 'apodCache']);
  settings = readSettings(saved.settings);
  cache = saved.apodCache || null;
  applyTheme();
  if (cache?.data) renderPicture(cache.data);
  updateNavigation();
  // A topSites error must not stop the APOD or custom shortcuts from rendering.
  try {
    const sites = await chrome.topSites.get();
    topSites = sites.flatMap(site => { try { return validateShortcuts([site]); } catch { return []; } }).slice(0, 10);
  } catch { topSites = []; }
  renderShortcuts();
  refreshPicture();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = readSettings(changes.settings.newValue);
      applyTheme();
      renderShortcuts();
    }
  });
}
init().catch(error => {
  console.warn('APOD New Tab could not initialize:', error);
  mediaMessage('Load this folder as a Chrome extension to use APOD New Tab.');
  $('status').textContent = 'See the README for installation instructions.';
  document.querySelector('.apod').setAttribute('aria-busy', 'false');
});

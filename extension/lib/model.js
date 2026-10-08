export const DEFAULT_SETTINGS = { theme: 'light', shortcutMode: 'automatic', shortcuts: [] };
export const MAX_SHORTCUTS = 20;

export function normalizeShortcutUrl(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Enter a website address for every shortcut.');
  // Schemes other than http(s) are deliberately rejected, including javascript:.
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Use an http:// or https:// website address without a username or password.');
  }
  return url.href;
}

export function validateShortcuts(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_SHORTCUTS) throw new Error(`Choose up to ${MAX_SHORTCUTS} shortcuts.`);
  return rows.map(row => {
    const url = normalizeShortcutUrl(row.url);
    const title = String(row.title || '').trim().slice(0, 100) || new URL(url).hostname.replace(/^www\./, '');
    return { title, url };
  });
}

export function readSettings(value) {
  let shortcuts = [];
  try { shortcuts = validateShortcuts(value?.shortcuts || []); } catch { /* Ignore corrupt saved data. */ }
  return {
    theme: ['light', 'dark', 'system'].includes(value?.theme) ? value.theme : 'light',
    shortcutMode: value?.shortcutMode === 'custom' ? 'custom' : 'automatic',
    shortcuts
  };
}

export function dayKey(date = new Date()) {
  // APOD's publishing day follows US Eastern time, not the viewer's timezone.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export const FIRST_APOD_DAY = '1995-06-16';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function pictureDay(value) {
  if (typeof value !== 'string') throw new Error('Missing APOD date.');
  let key = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const classic = value.match(/^(\d{4})\s+([A-Za-z]+)\s+(\d{1,2})$/);
    const nasa = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (!classic && !nasa) throw new Error('Unrecognized APOD date.');
    const year = classic ? classic[1] : nasa[3];
    const month = MONTHS.findIndex(name => name.toLowerCase() === (classic ? classic[2] : nasa[1]).toLowerCase()) + 1;
    const day = classic ? classic[3] : nasa[2];
    key = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const date = new Date(`${key}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) throw new Error('Invalid APOD date.');
  return key;
}

export function offsetDay(value, amount) {
  const date = new Date(`${pictureDay(value)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function formatPictureDay(value) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${pictureDay(value)}T12:00:00Z`));
}

export function shouldRefresh(cache, now = Date.now()) {
  return !cache?.data || cache.checkedDay !== dayKey(new Date(now)) || now - cache.checkedAt > 60 * 60 * 1000;
}

export function safeRemoteUrl(value, base) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  } catch { return null; }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShortcutUrl, validateShortcuts, readSettings, safeRemoteUrl, dayKey, shouldRefresh, pictureDay, offsetDay, formatPictureDay } from '../extension/lib/model.js';

test('shortcut addresses support hostnames, paths and explicit http(s)', () => {
  assert.equal(normalizeShortcutUrl(' github.com/openai '), 'https://github.com/openai');
  assert.equal(normalizeShortcutUrl('http://localhost:3000/'), 'http://localhost:3000/');
  assert.deepEqual(validateShortcuts([{ title: '', url: 'https://www.example.com/a' }]), [{ title: 'example.com', url: 'https://www.example.com/a' }]);
});
test('shortcut addresses reject executable schemes, missing hosts and embedded credentials', () => {
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/test', 'chrome://settings', 'https://user:pass@example.com']) {
    assert.throws(() => normalizeShortcutUrl(url));
  }
  assert.throws(() => validateShortcuts(Array(21).fill({ title: 'Site', url: 'example.com' })));
});
test('settings recover safely from corrupt or unexpected saved values', () => {
  assert.deepEqual(readSettings({ theme: 'nope', shortcutMode: 'invalid', shortcuts: [{ url: 'javascript:bad' }] }), { theme: 'light', shortcutMode: 'automatic', shortcuts: [] });
  assert.equal(readSettings({ theme: 'dark', shortcutMode: 'custom', shortcuts: [] }).theme, 'dark');
});
test('remote image URLs resolve relative paths and reject unsafe schemes', () => {
  assert.equal(safeRemoteUrl('../image/test.jpg', 'https://apod.com/en/'), 'https://apod.com/image/test.jpg');
  assert.equal(safeRemoteUrl('http://apod.com/image.jpg'), 'https://apod.com/image.jpg');
  for (const url of [null, undefined, '', 'javascript:alert(1)', 'data:image/png;base64,x']) assert.equal(safeRemoteUrl(url, 'https://apod.com/en/'), null);
});
test('publishing day uses Eastern midnight across daylight saving transitions', () => {
  assert.equal(dayKey(new Date('2026-10-09T03:59:00Z')), '2026-10-08');
  assert.equal(dayKey(new Date('2026-10-09T04:00:00Z')), '2026-10-09');
  assert.equal(dayKey(new Date('2026-12-02T04:59:00Z')), '2026-12-01');
});
test('cache updates at the date boundary and retries hourly for late publications', () => {
  const now = Date.parse('2026-10-08T16:00:00Z');
  const cache = { data: { title: 'Saved' }, checkedAt: now - 1000, checkedDay: '2026-10-08' };
  assert.equal(shouldRefresh(cache, now), false);
  assert.equal(shouldRefresh({ ...cache, checkedDay: '2026-10-07' }, now), true);
  assert.equal(shouldRefresh({ ...cache, checkedAt: now - 3600001 }, now), true);
  assert.equal(shouldRefresh(null, now), true);
});

test('archive dates support both APOD formats and reject invalid calendar days', () => {
  assert.equal(pictureDay('2026 October 8'), '2026-10-08');
  assert.equal(pictureDay('October 8, 2026'), '2026-10-08');
  assert.equal(formatPictureDay('2026 October 8'), 'October 8, 2026');
  for (const value of ['2026-02-30', '2026 April 31', 'Unknown 8, 2026']) assert.throws(() => pictureDay(value));
});
test('archive date arithmetic crosses months, years, and leap days without timezone shifts', () => {
  assert.equal(offsetDay('2026-01-01', -1), '2025-12-31');
  assert.equal(offsetDay('2024-03-01', -1), '2024-02-29');
  assert.equal(offsetDay('2026-10-08', 1), '2026-10-09');
});

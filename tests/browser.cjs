// Browser integration checks use a disposable profile and the actual unpacked extension.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const extension = path.resolve(__dirname, '../extension');
const imagePage = `<!doctype html><html><head><title>APOD</title></head><body>
<h1>Astronomy Picture of the Day</h1>
<center>2026 October 8<p><a href="image/full.jpg"><img src="image/small.jpg" alt="A field of stars"></a></p></center>
<center><b>A Test Nebula</b><br>Image Credit &amp; Copyright: <a href="https://example.com/artist">Example Artist</a></center>
<p><b>Explanation:</b> A distant nebula shines in the night sky. <a href="https://example.com">Stars</a> light its clouds.
<br><br><b>Tomorrow's picture:</b> more stars</p><script>window.remoteScriptRan=true</script></body></html>`;
const nasaPage = `<html><body><img src="https://example.com/unrelated-logo.png"><div class="hds-media-detail-hero">
<div class="media-detail-hero__media"><a href="/image-article/today/"><img src="https://assets.science.nasa.gov/test.png" alt="A galaxy"></a></div>
<h2>A Test Galaxy</h2><p class="media-detail-hero__description"><strong>Explanation:</strong> The galaxy is far away.<br><strong>Tomorrow’s picture:</strong> clouds</p>
<table><tr><th>Date:</th><td>October 8, 2026</td></tr><tr><th>Credit:</th><td>Example Photographer</td></tr></table></div></body></html>`;
const videoPage = imagePage.replace('<a href="image/full.jpg"><img src="image/small.jpg" alt="A field of stars"></a>', '<iframe src="https://www.youtube.com/embed/test"></iframe>').replace('</body>', '<img src="https://example.com/footer-logo.png"></body>');

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'apod-extension-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.APOD_BROWSER_EXECUTABLE ? { executablePath: process.env.APOD_BROWSER_EXECUTABLE } : { channel: 'chromium' }),
      headless: true, viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles', locale: 'en-US',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    let mode = 'image';
    let requests = 0;
    await context.addInitScript(() => {
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : ['2026-10-08T16:00:00Z'])); }
        static now() { return new RealDate('2026-10-08T16:00:00Z').getTime(); }
      };
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: (success, failure) => {
        if (window.blockLocation) failure({ code: 1, message: 'Location denied' });
        else success({ coords: { latitude: 37.7749, longitude: -122.4194 } });
      } });
    });
    const pixel = await fs.readFile(path.join(extension, 'icons/new-tab32.png'));
    await context.route('https://**/*', async route => {
      const url = route.request().url();
      if (url === 'https://apod.com/en/ap261007.html' || url.startsWith('https://science.nasa.gov/wp-json/wp/v2/image-article') || url === 'https://science.nasa.gov/image-article/apod-2026-october-7-test-archive/') {
        requests++;
        if (mode === 'offline') return route.abort('internetdisconnected');
        if (url === 'https://apod.com/en/ap261007.html') return route.fulfill({ status: 403, body: 'Forbidden' });
        if (url.includes('/wp-json/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ link: 'https://science.nasa.gov/image-article/apod-2026-october-17-wrong-date/' }, { link: 'https://science.nasa.gov/image-article/apod-2026-october-7-test-archive/' }]) });
        return route.fulfill({ contentType: 'text/html', body: nasaPage.replace('October 8, 2026', 'October 7, 2026').replace('A Test Galaxy', 'Yesterday’s Test Galaxy') });
      }
      if (url === 'https://apod.com/en/ap261006.html') return route.fulfill({ contentType: 'text/html', body: imagePage.replace('2026 October 8', '2026 October 6').replace('A Test Nebula', 'Earlier Test Nebula') });
      if (url === 'https://apod.com/en/' || url === 'https://science.nasa.gov/apod/') {
        requests++;
        if (mode === 'offline') return route.abort('internetdisconnected');
        if (mode === 'fallback' && url.startsWith('https://apod.com/')) return route.fulfill({ status: 403, body: 'Forbidden' });
        return route.fulfill({ contentType: 'text/html', body: mode === 'video' ? videoPage : mode === 'fallback' ? nasaPage : imagePage });
      }
      return route.fulfill({ contentType: 'image/png', body: pixel });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('chrome://newtab/');
    await page.waitForFunction(() => document.getElementById('picture-title')?.textContent === 'A Test Nebula');
    const id = await page.evaluate(() => chrome.runtime.id);
    assert.ok(id, 'New Tab is served by the loaded extension');
    await page.waitForFunction(() => document.getElementById('sunrise-time').textContent === '7:12 AM');
    assert.equal(await page.locator('#sunset-time').textContent(), '6:42 PM');
    assert.equal(await page.locator('#moonrise-time').textContent(), '5:09 AM');
    assert.equal(await page.locator('#moonset-time').textContent(), '5:38 PM');
    assert.equal(await page.locator('#moon-phase').textContent(), 'Waning crescent');
    assert.equal(await page.locator('#moon-illumination').textContent(), '· 5%');
    assert.equal(await page.locator('.sky-fact').count(), 5);
    const automaticLocation = await page.evaluate(async () => (await chrome.storage.local.get('observerLocation')).observerLocation);
    assert.deepEqual([automaticLocation.latitude, automaticLocation.longitude, automaticLocation.automatic], [37.77, -122.42, true]);
    // Location failure keeps phase available, and manual coordinates are a fallback.
    await page.evaluate(async () => { window.blockLocation = true; await chrome.storage.local.remove('observerLocation'); });
    await page.waitForFunction(() => document.getElementById('sunrise-time').textContent === '—');
    assert.equal(await page.locator('#moon-phase').textContent(), 'Waning crescent');
    await page.locator('#settings-button').click();
    await page.locator('#sky-latitude').fill('37.77');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.match(await page.locator('#settings-error').textContent(), /longitude/);
    await page.locator('#sky-longitude').fill('-122.42');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('sunrise-time').textContent === '7:12 AM');
    await page.locator('#settings-button').click();
    await page.locator('#sky-latitude').fill('0');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('observerLocation')).observerLocation.latitude), 37.77);
    assert.equal(await page.locator('#picture-credit').textContent(), 'Image Credit & Copyright: Example Artist');
    assert.match(await page.locator('#explanation').textContent(), /Stars light its clouds/);
    assert.ok(!(await page.locator('#explanation').textContent()).includes('Tomorrow'));
    assert.equal(await page.evaluate(() => window.remoteScriptRan), undefined);
    assert.equal(await page.locator('#media img').getAttribute('src'), 'https://apod.com/en/image/small.jpg');
    assert.equal(await page.locator('#picture-date').textContent(), 'October 8, 2026');
    assert.equal(await page.locator('#next-day').isDisabled(), true, 'tomorrow is not published yet');
    assert.equal(await page.locator('#refresh-button, footer').count(), 0);
    assert.equal(await page.locator('#picture-details').isVisible(), false);
    assert.equal(await page.locator('#picture-credit').isVisible(), false);
    assert.equal(await page.locator('#explanation').isVisible(), false);
    assert.equal(await page.locator('#details-cue').textContent(), 'Click for details');
    await page.locator('#details-toggle').click();
    assert.equal(await page.locator('#details-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#picture-credit').isVisible(), true);
    assert.equal(await page.locator('#explanation').isVisible(), true);
    assert.equal(await page.locator('#source-link').isVisible(), true);
    await page.locator('#details-toggle').press('Enter');
    assert.equal(await page.locator('#picture-details').isVisible(), false);
    await page.locator('#details-toggle').press('Space');
    assert.equal(await page.locator('#picture-details').isVisible(), true);

    // Date navigation falls back to the exact NASA archive entry and keeps the
    // daily cache separate so new tabs always return to the latest picture.
    await page.locator('#previous-day').click();
    await page.waitForFunction(() => document.getElementById('picture-title').textContent === 'Yesterday’s Test Galaxy');
    assert.match(await page.locator('#sunrise-time').getAttribute('title'), /10\/7\/2026/);
    assert.equal(await page.locator('#picture-details').isVisible(), false, 'a newly selected picture starts with its details hidden');
    assert.equal(await page.locator('#picture-date').textContent(), 'October 7, 2026');
    assert.equal(await page.locator('#next-day').isDisabled(), false);
    await page.locator('#previous-day').click();
    await page.waitForFunction(() => document.getElementById('picture-title').textContent === 'Earlier Test Nebula');
    await page.locator('#next-day').click();
    await page.waitForFunction(() => document.getElementById('picture-title').textContent === 'Yesterday’s Test Galaxy');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.locator('#picture-date').textContent(), 'October 7, 2026');
    await page.locator('#next-day').click();
    await page.waitForFunction(() => document.getElementById('picture-title').textContent === 'A Test Nebula');
    await page.locator('#previous-day').click();
    await page.waitForFunction(() => document.getElementById('picture-date').textContent === 'October 7, 2026');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('picture-date').textContent === 'October 8, 2026');
    assert.equal(await page.locator('#picture-details').isVisible(), false, 'fresh tabs start with details hidden');

    // Customize, reject executable URLs, save, reorder, and persist across tabs.
    await page.locator('#settings-button').click();
    await page.locator('input[value="custom"]').check();
    // A fresh Chromium profile may ship default top sites; start with an empty custom list.
    while (await page.locator('.shortcut-row').count()) {
      await page.locator('.row-controls button[aria-label^="Remove"]').last().click();
    }
    await page.locator('#add-shortcut').click();
    await page.getByLabel('Name of shortcut 1', { exact: true }).fill('Example');
    await page.getByLabel('Address of shortcut 1', { exact: true }).fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForFunction(() => document.getElementById('settings-error').textContent.length > 0);
    assert.equal(await page.locator('#settings-dialog').evaluate(el => el.open), true);
    await page.getByLabel('Address of shortcut 1', { exact: true }).fill('example.com');
    await page.locator('#add-shortcut').click();
    await page.getByLabel('Name of shortcut 2', { exact: true }).fill('Other site');
    await page.getByLabel('Address of shortcut 2', { exact: true }).fill('https://example.org/');
    await page.getByLabel('Move up shortcut 2', { exact: true }).click();
    await page.locator('#theme').selectOption('dark');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForFunction(() => !document.getElementById('settings-dialog').open || document.getElementById('settings-error').textContent.length > 0);
    assert.equal(await page.locator('#settings-dialog').evaluate(el => el.open), false, await page.locator('#settings-error').textContent());
    assert.equal(await page.locator('.shortcut-name').first().textContent(), 'Other site');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    const beforeReload = requests;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.shortcut-name')?.textContent === 'Other site');
    assert.equal(requests, beforeReload, 'fresh cache avoids network calls in new tabs');

    // Cancel discards edits.
    await page.locator('#settings-button').click();
    await page.getByLabel('Name of shortcut 1', { exact: true }).fill('Discard me');
    await page.locator('#cancel-settings').click();
    assert.equal(await page.locator('.shortcut-name').first().textContent(), 'Other site');

    await page.locator('#previous-day').click();
    await page.waitForFunction(() => document.getElementById('picture-date').textContent === 'October 7, 2026');
    mode = 'fallback';
    await page.locator('#today-button').click();
    await page.waitForFunction(() => document.getElementById('picture-title').textContent === 'A Test Galaxy');
    assert.equal(await page.locator('#source-link').getAttribute('href'), 'https://science.nasa.gov/image-article/today/');
    assert.equal(await page.locator('#picture-credit').textContent(), 'Image credit: Example Photographer');
    mode = 'offline';
    await page.evaluate(async () => {
      const saved = await chrome.storage.local.get('apodCache');
      saved.apodCache.checkedAt -= 3600001;
      await chrome.storage.local.set(saved);
    });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('last saved'));
    assert.equal(await page.locator('#picture-title').textContent(), 'A Test Galaxy');
    assert.equal(await page.locator('.shortcut-name').first().textContent(), 'Other site');
    mode = 'video';
    await page.locator('#today-button').click();
    await page.waitForFunction(() => document.getElementById('media').textContent.includes('video'));
    assert.equal(await page.locator('iframe').count(), 0, 'video days never embed remote scripts or autoplay');

    // A corrupt/error HTML response must be rejected instead of caching an empty page.
    const parserChecks = await page.evaluate(async () => {
      const { parseApod } = await import('./lib/apod.js');
      let rejected = false;
      try { parseApod('<h1>Access denied</h1>', 'https://apod.com/en/'); } catch { rejected = true; }
      return rejected;
    });
    assert.equal(parserChecks, true);

    // Check the automatic row with ten controlled sites and responsive overflow.
    await page.evaluate(async () => {
      await chrome.storage.local.set({ settings: { theme: 'light', shortcutMode: 'custom', shortcuts: Array.from({ length: 10 }, (_, i) => ({ title: `Site ${i + 1}`, url: `https://example.com/${i}` })) } });
    });
    await page.waitForFunction(() => document.querySelectorAll('a.shortcut').length === 10);
    const y = await page.locator('a.shortcut').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().y));
    assert.ok(y.every(value => value === y[0]), 'ten site icons fit in a single desktop row');
    for (const height of [800, 600]) {
      await page.setViewportSize({ width: 1440, height });
      assert.equal(await page.locator('a.shortcut').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().bottom <= innerHeight)), true, 'shortcuts stay visible on shorter desktop windows with details closed');
      const strip = await page.locator('.sky-strip').boundingBox();
      assert.ok(strip.height < 30, 'sun and moon info stays in one thin row');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#settings-button').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Escape');

    // Cold-start outage still presents shortcuts and a useful recovery state.
    mode = 'offline';
    await page.evaluate(() => chrome.storage.local.remove('apodCache'));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('independently'));
    assert.equal(await page.locator('a.shortcut').count(), 10);
    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log('Browser checks passed: real extension override, parsing, safe rendering, fallback, cache, offline recovery, videos, shortcuts, persistence, responsive layout.');
  } finally {
    if (context) await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

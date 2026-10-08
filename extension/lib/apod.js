import { safeRemoteUrl, pictureDay, formatPictureDay, FIRST_APOD_DAY, dayKey } from './model.js';

const SOURCES = ['https://apod.com/en/', 'https://science.nasa.gov/apod/'];
const clean = value => (value || '').replace(/\s+/g, ' ').trim();
const explanationText = node => clean(node?.textContent).replace(/^Explanation:\s*/i, '').split(/Tomorrow['’]s (?:picture|image):/i)[0].trim();

// Detached HTML is parsed only for text and URLs. It is never inserted into the page.
export function parseApod(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const hero = doc.querySelector('.hds-media-detail-hero, .media-detail-hero');
  return hero ? parseNasa(hero, base) : parseClassic(doc, base);
}

function parseNasa(hero, base) {
  const meta = {};
  for (const row of hero.querySelectorAll('tr')) {
    meta[clean(row.querySelector('th')?.textContent).replace(/:$/, '').toLowerCase()] = clean(row.querySelector('td')?.textContent);
  }
  const image = hero.querySelector('.media-detail-hero__media img');
  const sourceUrl = safeRemoteUrl(image?.closest('a')?.getAttribute('href'), base) || base;
  return validatePicture({
    title: clean(hero.querySelector('h2, h1')?.textContent),
    date: meta.date || '', credit: meta.credit || '',
    explanation: explanationText(hero.querySelector('.media-detail-hero__description')),
    mediaType: image ? 'image' : 'video',
    imageUrl: image ? safeRemoteUrl(image.getAttribute('src'), base) : null,
    alt: clean(image?.getAttribute('alt')), sourceUrl
  });
}

function parseClassic(doc, base) {
  const marker = [...doc.querySelectorAll('b, strong')].find(node => /^Explanation:/i.test(clean(node.textContent)));
  const paragraph = marker?.closest('p');
  const center = [...doc.querySelectorAll('center')].find(node => /\b\d{4}\s+[A-Za-z]+\s+\d{1,2}\b/.test(node.textContent));
  // Video pages sometimes have unrelated footer/logo images. Prefer the media
  // in the dated center, and only fall back to an explicitly linked APOD image.
  const image = center?.querySelector('img') || (!center?.querySelector('iframe, video, embed, object') && doc.querySelector('a[href*="image/"] img')) || null;
  const date = clean(center?.textContent).match(/\b\d{4}\s+[A-Za-z]+\s+\d{1,2}\b/)?.[0] || '';
  const titleNode = [...doc.querySelectorAll('center b, center strong')].find(node => !/credit|copyright|explanation|astronomy picture/i.test(clean(node.textContent)));
  const info = clean(titleNode?.parentElement?.textContent);
  const credit = info.match(/(?:Image |Video |Illustration )?(?:Credit(?:s)?(?:\s*(?:&|and)\s*Copyright)?|Copyright):\s*(.*)/i)?.[0] || '';
  return validatePicture({
    title: clean(titleNode?.textContent), date, credit,
    explanation: explanationText(paragraph), mediaType: image ? 'image' : 'video',
    imageUrl: image ? safeRemoteUrl(image.getAttribute('src'), base) : null,
    alt: clean(image?.getAttribute('alt')), sourceUrl: base
  });
}

function validatePicture(data) {
  if (!data.title || !data.explanation || !data.date || (data.mediaType === 'image' && !data.imageUrl)) {
    throw new Error('The APOD page has an unrecognized format.');
  }
  return { ...data, dateKey: pictureDay(data.date) };
}

async function request(fetcher, url) {
  const response = await fetcher(url, { credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

export async function fetchPicture({ date = null, fetcher = fetch } = {}) {
  if (date) {
    date = pictureDay(date);
    if (date < FIRST_APOD_DAY || date > dayKey()) throw new Error('Choose a published APOD date.');
  }
  if (date && date !== dayKey()) return fetchArchive(date, fetcher);
  const failures = [];
  for (const source of SOURCES) {
    try {
      const response = await request(fetcher, source);
      return parseApod(await response.text(), response.url || source);
    } catch (error) { failures.push(`${new URL(source).hostname}: ${error.message}`); }
  }
  throw new Error(failures.join('; '));
}

async function fetchArchive(date, fetcher) {
  const stamp = date.replaceAll('-', '').slice(2);
  const mirror = `https://apod.com/en/ap${stamp}.html`;
  try {
    const response = await request(fetcher, mirror);
    const data = parseApod(await response.text(), response.url || mirror);
    if (data.dateKey !== date) throw new Error('Archive returned a different date.');
    return data;
  } catch { /* Use NASA's dated article if the mirror is unavailable. */ }
  const [month, day, year] = formatPictureDay(date).replace(',', '').split(' ');
  const search = new URL('https://science.nasa.gov/wp-json/wp/v2/image-article');
  search.searchParams.set('search', `APOD ${year} ${month} ${Number(day)}`);
  search.searchParams.set('per_page', '20');
  search.searchParams.set('_fields', 'link');
  const response = await request(fetcher, search.href);
  const articles = await response.json();
  if (!Array.isArray(articles)) throw new Error('Unrecognized archive response.');
  const prefix = `/image-article/apod-${Number(year)}-${month.toLowerCase()}-${Number(day)}-`;
  const article = articles.find(item => {
    const url = safeRemoteUrl(item.link);
    return url && new URL(url).origin === 'https://science.nasa.gov' && new URL(url).pathname.startsWith(prefix);
  });
  if (!article) throw new Error('This APOD is not available in the archive.');
  const page = await request(fetcher, article.link);
  const data = parseApod(await page.text(), page.url || article.link);
  if (data.dateKey !== date) throw new Error('Archive returned a different date.');
  return data;
}

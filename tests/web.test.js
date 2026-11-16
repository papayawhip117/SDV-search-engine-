// Website tests: start the real server on a free port, with a database built
// from the saved wiki fixtures, and fetch pages like a browser would.

import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { escapeHtml, html, queryString, raw } from '../src/web/html.js';
import { ART, artSvg, pixelSvg } from '../src/web/pixelArt.js';
import { CATEGORIES } from '../src/web/components.js';
import { createApp } from '../src/web/server.js';

const fixturesDir = new URL('./fixtures/', import.meta.url);
let db;

/** Start a server for one group of tests; returns { get, close }. */
async function startServer(options) {
  const server = http.createServer(createApp({ db, ...options }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: async (path) => {
      const response = await fetch(base + path, { redirect: 'manual' });
      return { status: response.status, headers: response.headers, body: await response.text() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

beforeAll(() => {
  db = openDatabase(':memory:');
  const pages = readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => JSON.parse(readFileSync(new URL(name, fixturesDir))).query?.pages ?? []);
  buildFromRawData(db, { retrievedAt: '2026-11-16T00:00:00.000Z', pages });
});

describe('html helpers', () => {
  it('escapes everything put into a page, unless it is our own HTML', () => {
    expect(escapeHtml(`<b>"Pierre's" & co</b>`)).toBe('&lt;b&gt;&quot;Pierre&#39;s&quot; &amp; co&lt;/b&gt;');
    expect(String(html`<p>${'<script>'}</p>`)).toBe('<p>&lt;script&gt;</p>');
    expect(String(html`<p>${html`<b>ok</b>`}${raw('<i>raw</i>')}</p>`)).toBe('<p><b>ok</b><i>raw</i></p>');
    expect(String(html`${['a', 'b']}${null}${false}${undefined}${0}`)).toBe('ab0');
  });

  it('builds query strings without the empty values', () => {
    expect(queryString({ q: 'blue berry', type: '', season: null })).toBe('?q=blue+berry');
    expect(queryString({})).toBe('');
  });
});

describe('pixel art', () => {
  it('turns letter grids into SVG rectangles, joining runs of one colour', () => {
    const svg = pixelSvg({ width: 3, height: 1, layers: [{ map: ['KK.'] }] });
    expect(svg).toContain('viewBox="0 0 3 1"');
    expect(svg.match(/<rect /g)).toHaveLength(1);
    expect(svg).toContain('width="2"');
  });

  it('draws every picture, and refuses unknown letters and names', () => {
    for (const name of Object.keys(ART)) expect(artSvg(name)).toMatch(/^<svg .*<\/svg>$/);
    expect(() => pixelSvg({ width: 1, height: 1, layers: [{ map: ['?'] }] })).toThrow(/Unknown pixel letter/);
    expect(artSvg('constructor')).toBeNull();
    expect(artSvg('nope')).toBeNull();
  });
});

describe('the website', () => {
  let site;
  beforeAll(async () => {
    site = await startServer({ ai: null });
  });
  afterAll(() => site.close());

  it('shows the homepage with a labelled search box and the category links', async () => {
    const { status, body, headers } = await site.get('/');
    expect(status).toBe(200);
    expect(headers.get('content-type')).toContain('text/html');
    expect(headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(body).toContain('<h1>Search the Stardew Valley Wiki</h1>');
    expect(body).toMatch(/<label class="visually-hidden" for="search-q">/);
    expect(body).toMatch(/<form class="search search--big" action="\/search"/);
    for (const category of CATEGORIES) expect(body).toContain(`href="${category.href}"`);
    expect(body).toContain('CC BY-NC-SA');
  });

  it('every category link opens a page with results', async () => {
    for (const category of CATEGORIES) {
      const { status, body } = await site.get(category.href);
      expect(status, category.href).toBe(200);
      expect(body, category.href).toMatch(/class="result"|class="villager-list"/);
    }
  });

  it('searches and shows each result with its wiki source and revision', async () => {
    const { status, body } = await site.get('/search?q=berry');
    expect(status).toBe(200);
    expect(body).toContain('href="/item?name=Strawberry"');
    expect(body).toContain('href="https://stardewvalleywiki.com/Strawberry"');
    expect(body).toMatch(/href="https:\/\/stardewvalleywiki\.com\/mediawiki\/index\.php\?oldid=\d+"/);
    expect(body).toContain('value="berry"'); // the search box keeps the words
  });

  it('filters by type and season, and marks the chosen options', async () => {
    const { body } = await site.get('/search?type=fish&season=Winter');
    expect(body).toContain('<option value="fish" selected>');
    expect(body).toContain('<option value="Winter" selected>');
    expect(body).toContain('Tuna');
    expect(body).not.toContain('>Catfish<'); // Spring and Fall only
  });

  it('never runs what someone types: search words are shown as text', async () => {
    const { body } = await site.get(`/search?q=${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(body).not.toContain('<script>alert(1)');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('explains bad choices and too-short words instead of crashing', async () => {
    expect((await site.get('/search?type=bogus')).body).toContain('There’s no type called “bogus”.');
    expect((await site.get('/search?q=ok')).body).toContain('Type at least 3 letters to search.');
    expect((await site.get('/search?q=zzzzqqq')).body).toContain('Nothing found.');
  });

  it('sends an empty search back to the homepage', async () => {
    const { status, headers } = await site.get('/search?q=');
    expect(status).toBe(302);
    expect(headers.get('location')).toBe('/');
  });

  it('points to the Gifts page when the words name a villager', async () => {
    const { body } = await site.get('/search?q=abigail');
    expect(body).toContain('href="/gifts?villager=Abigail"');
  });

  it('shows an item page with facts, gift tastes and the source revision', async () => {
    const { status, body } = await site.get('/item?name=strawberry');
    expect(status).toBe(200);
    expect(body).toContain('<h1>Strawberry');
    expect(body).toContain('Every 4 days');
    expect(body).toContain('href="/item?name=Strawberry+Seeds"');
    expect(body).toContain('Loved by');
    expect(body).toMatch(/oldid=\d+/);
  });

  it('suggests names for a misspelt item', async () => {
    const { status, body } = await site.get('/item?name=strawbery');
    expect(status).toBe(404);
    expect(body).toContain('Did you mean');
    expect(body).toContain('href="/item?name=Strawberry"');
  });

  it('lists villagers and shows one villager', async () => {
    expect((await site.get('/gifts')).body).toContain('href="/gifts?villager=Abigail"');
    const { body } = await site.get('/gifts?villager=abigail');
    expect(body).toContain('<h1>Abigail</h1>');
    expect(body).toContain('Fall');
    expect(body).toContain('Amethyst');
  });

  it('answers Ask AI with cited facts and a friendly note when there is no key', async () => {
    const empty = await site.get('/ask');
    expect(empty.body).toContain('The AI helper is resting');
    const { body } = await site.get(`/ask?q=${encodeURIComponent('What does Abigail love?')}`);
    expect(body).toContain('What the wiki says');
    expect(body).toContain('Abigail loves:');
    expect(body).toContain('id="fact-F1"');
    expect(body).toContain('href="https://stardewvalleywiki.com/List_of_All_Gifts"');
  });

  it('shows the About page with the database counts and the license', async () => {
    const { body } = await site.get('/about');
    expect(body).toContain('villagers');
    expect(body).toContain('href="/search?type=fish"');
    expect(body).toContain('CC BY-NC-SA');
  });

  it('serves the stylesheet and pictures, and 404s for anything else', async () => {
    expect((await site.get('/style.css')).headers.get('content-type')).toContain('text/css');
    const art = await site.get('/art/farm.svg');
    expect(art.headers.get('content-type')).toBe('image/svg+xml');
    expect((await site.get('/art/nope.svg')).status).toBe(404);
    expect((await site.get('/../package.json')).status).toBe(404);
    expect((await site.get('/nowhere')).status).toBe(404);
  });
});

describe('Ask AI with an API key (a fake AI)', () => {
  it('shows an accepted answer with only the facts it cites', async () => {
    const ai = { complete: async () => ({ text: 'Abigail loves Amethyst [F2].', stopReason: 'end_turn' }) };
    const site = await startServer({ ai });
    try {
      const { body } = await site.get(`/ask?q=${encodeURIComponent('What does Abigail love?')}`);
      expect(body).toContain('Abigail loves Amethyst [F2].');
      expect(body).toContain('id="fact-F2"');
      expect(body).not.toContain('id="fact-F1"');
      expect(body).not.toContain('The AI helper is resting');
    } finally {
      await site.close();
    }
  });

  it('hides an answer that fails the checks, and shows the facts instead', async () => {
    const ai = { complete: async () => ({ text: 'Abigail loves 999 Diamonds [F2].', stopReason: 'end_turn' }) };
    const site = await startServer({ ai });
    try {
      const { body } = await site.get(`/ask?q=${encodeURIComponent('What does Abigail love?')}`);
      expect(body).toContain('didn’t pass the app’s checks');
      expect(body).not.toContain('<h2>Answer</h2>'); // the problems may quote it, but the answer isn't shown
      expect(body).toContain('id="fact-F1"');
    } finally {
      await site.close();
    }
  });

  it('shows the facts when the AI call fails', async () => {
    const ai = { complete: async () => { throw new Error('network down'); } };
    const site = await startServer({ ai });
    try {
      const { body } = await site.get(`/ask?q=${encodeURIComponent('What does Abigail love?')}`);
      expect(body).toContain('Couldn’t get an AI answer');
      expect(body).toContain('id="fact-F1"');
    } finally {
      await site.close();
    }
  });
});

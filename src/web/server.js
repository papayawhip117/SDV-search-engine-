// The local website: a small web server built with Node's own `http` module
// (no framework needed). It reads the same database and calls the same
// search functions as the command line.
//
//   npm start          then open http://localhost:3000
//
// Each request is a URL like /search?q=berry&season=Summer. The server
// looks at the path (/search), reads the ?query values, asks the database,
// and sends back a finished HTML page. The pages need no JavaScript in the
// browser, so they work with the keyboard, screen readers and old browsers.

import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { SEASON_ORDER } from '../calc/profit.js';
import { answerQuestion, createClaudeAI, explainError } from '../assistant/answer.js';
import { findFacts } from '../assistant/findFacts.js';
import { suggestNames } from '../cli/item.js';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { getVillager, getVillagerNames } from '../queries/giftQueries.js';
import { ITEM_TYPES, SORT_OPTIONS, getItemDetails, searchItems, toFtsQuery } from '../queries/search.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';
import { artSvg } from './pixelArt.js';
import {
  aboutPage,
  askPage,
  giftsPage,
  homePage,
  itemNotFoundPage,
  itemPage,
  notFoundPage,
  resultsPage,
  villagerPage,
} from './pages.js';

export const DEFAULT_PORT = 3000;
export const RESULTS_LIMIT = 60;
const STYLESHEET_URL = new URL('./public/style.css', import.meta.url);

// Rules for the browser. Our pages run no scripts at all and only load files
// from this server, so the browser can refuse anything else (a safety net
// if something unexpected ever got into a page).
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function send(res, status, body, contentType = 'text/html; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...SECURITY_HEADERS, ...extraHeaders });
  res.end(String(body));
}

/** Read one ?value from the URL, trimmed and limited in length. */
function param(url, name, maxLength = 200) {
  return (url.searchParams.get(name) ?? '').trim().slice(0, maxLength);
}

/** Find villagers named in the search words ("abigail" → Abigail). */
function villagersIn(text, villagerNames) {
  const words = new Set(text.toLowerCase().match(/[\p{L}.']+/gu) ?? []);
  return villagerNames.filter((name) => words.has(name.toLowerCase()));
}

/**
 * Make the function that answers every request.
 *
 * @param db   an open database
 * @param ai   the AI for Ask AI (createClaudeAI(), or a fake in tests); null when there's no API key
 */
export function createApp({ db, ai = null }) {
  // The database doesn't change while the server runs, so these are looked up once.
  const knownItems = new Set(db.prepare('SELECT name FROM items').all().map((row) => row.name));
  const villagerNames = getVillagerNames(db);

  const routes = {
    '/': () => [200, homePage()],

    '/search': (url) => {
      const query = { q: param(url, 'q'), type: param(url, 'type'), season: param(url, 'season'), sort: param(url, 'sort') };
      if (!query.q && !query.type && !query.season) return [302, null, { Location: '/' }];

      // Check the choices here so a hand-typed URL gets a friendly message.
      let error = null;
      if (query.type && !ITEM_TYPES.includes(query.type)) error = `There’s no type called “${query.type}”.`;
      else if (query.season && !SEASON_ORDER.includes(query.season)) error = `There’s no season called “${query.season}”.`;
      else if (query.sort && !SORT_OPTIONS.includes(query.sort)) error = `Can’t sort by “${query.sort}”.`;
      else if (query.sort === 'relevance' && !toFtsQuery(query.q).query) error = 'Sorting by best match needs some search words.';
      else if (query.q && !toFtsQuery(query.q).query) error = 'Type at least 3 letters to search.';
      if (error) return [400, resultsPage({ query, results: [], error, limit: RESULTS_LIMIT })];

      const { results, ignoredWords } = searchItems(db, {
        text: query.q,
        type: query.type || undefined,
        season: query.season || undefined,
        sortBy: query.sort || undefined,
        limit: RESULTS_LIMIT,
      });
      return [200, resultsPage({ query, results, ignoredWords, villagers: villagersIn(query.q, villagerNames), limit: RESULTS_LIMIT })];
    },

    '/item': (url) => {
      const name = param(url, 'name');
      const item = name ? getItemDetails(db, name) : null;
      if (!item) return [404, itemNotFoundPage(name, name.length >= 3 ? suggestNames(db, name) : [])];
      return [200, itemPage(item, { knownItems })];
    },

    '/gifts': (url) => {
      const name = param(url, 'villager');
      if (!name) return [200, giftsPage(villagerNames.map((villagerName) => getVillager(db, villagerName)))];
      const villager = getVillager(db, name);
      if (!villager) return [404, notFoundPage()];
      return [200, villagerPage(villager, { knownItems })];
    },

    '/ask': async (url) => {
      const question = param(url, 'q', 500);
      if (!question) return [200, askPage({ hasKey: Boolean(ai) })];
      if (!ai) return [200, askPage({ question, result: findFacts(db, question), hasKey: false })];
      try {
        return [200, askPage({ question, result: await answerQuestion(db, question, { ai }), hasKey: true })];
      } catch (error) {
        return [200, askPage({ question, result: findFacts(db, question), hasKey: true, error: explainError(error) })];
      }
    },

    '/about': () => {
      const counts = db.prepare('SELECT item_type AS type, COUNT(*) AS count FROM items GROUP BY item_type ORDER BY count DESC').all();
      return [200, aboutPage({ counts, villagerCount: villagerNames.length })];
    },
  };

  return async function handleRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Only GET requests are supported', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/style.css') {
        send(res, 200, readFileSync(STYLESHEET_URL, 'utf8'), 'text/css; charset=utf-8');
        return;
      }
      const art = url.pathname.match(/^\/art\/([a-z]+)\.svg$/);
      if (art) {
        const svg = artSvg(art[1]);
        if (svg) send(res, 200, svg, 'image/svg+xml', { 'Cache-Control': 'max-age=3600' });
        else send(res, 404, 'No such picture', 'text/plain; charset=utf-8');
        return;
      }
      const route = routes[url.pathname];
      if (!route) {
        send(res, 404, notFoundPage());
        return;
      }
      const [status, body, headers = {}] = await route(url);
      if (status === 302) {
        res.writeHead(302, { ...SECURITY_HEADERS, ...headers });
        res.end();
        return;
      }
      send(res, status, body);
    } catch (error) {
      // Show the details in the terminal, and a plain message in the browser.
      console.error(error);
      send(res, 500, 'Something went wrong. The details are in the terminal where the server is running.', 'text/plain; charset=utf-8');
    }
  };
}

/** Load .env (where the API key lives) if there is one. */
function loadEnvFile() {
  if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
}

function main() {
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }
  loadEnvFile();
  const db = openDatabase(DATABASE_PATH);
  const ai = process.env.ANTHROPIC_API_KEY ? createClaudeAI() : null;
  const port = Number(process.env.PORT) || DEFAULT_PORT;

  // 127.0.0.1 means "this computer only": other devices on your network can't open it.
  const server = http.createServer(createApp({ db, ai }));
  server.listen(port, '127.0.0.1', () => {
    console.log(`Stardew Guide is running at http://localhost:${port}`);
    console.log(ai ? 'Ask AI: using Claude (API key found in .env).' : 'Ask AI: no API key, so it shows the wiki facts.');
    console.log('Press Ctrl+C to stop it.');
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Stop the other server, or run: PORT=3001 npm start`);
    else console.error(error);
    process.exitCode = 1;
  });
}

if (isRunDirectly(import.meta.url)) main();

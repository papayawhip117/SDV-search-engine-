// Reusable pieces of the web pages. Each function returns a piece of HTML
// (built with html`...`, so everything is escaped), and the pages in
// pages.js put them together.

import { WIKI_BASE_URL } from '../wiki/apiClient.js';
import { html, queryString } from './html.js';

export const SITE_NAME = 'Stardew Guide';

/** The shortcut buttons under the search bar. Each one is a normal link. */
export const CATEGORIES = [
  { label: 'Crops', icon: 'strawberry', href: '/search?type=crop' },
  { label: 'Fish', icon: 'fish', href: '/search?type=fish' },
  { label: 'Gifts', icon: 'gift', href: '/gifts' },
  { label: 'Recipes', icon: 'pot', href: '/search?type=dish' },
  { label: 'Forage', icon: 'leaf', href: '/search?type=forage' },
  { label: 'Minerals', icon: 'gem', href: '/search?type=mineral' },
];

/** Friendly names for the item types in the database (singular, plural). */
export const TYPE_LABELS = {
  crop: ['Crop', 'Crops'],
  seed: ['Seed', 'Seeds'],
  fish: ['Fish', 'Fish'],
  artisan: ['Artisan good', 'Artisan goods'],
  machine: ['Machine', 'Machines'],
  dish: ['Dish', 'Cooking recipes'],
  crafted: ['Crafted item', 'Crafted items'],
  forage: ['Forage', 'Forage'],
  mineral: ['Mineral', 'Minerals'],
  geode: ['Geode', 'Geodes'],
  artifact: ['Artifact', 'Artifacts'],
  flower: ['Flower', 'Flowers'],
  book: ['Book', 'Books'],
};

const NAV = [
  { label: 'Search', href: '/' },
  { label: 'Ask AI', href: '/ask' },
  { label: 'About', href: '/about' },
];

/** A link to an exact old version of a wiki page (the revision our facts came from). */
export function revisionUrl(revision) {
  return `${WIKI_BASE_URL}/mediawiki/index.php?oldid=${encodeURIComponent(revision)}`;
}

/** The link to one item's page in this app. */
export function itemHref(name) {
  return `/item${queryString({ name })}`;
}

/** "120g", or a dash when we don't know. */
export function gold(value) {
  return value === null || value === undefined ? '–' : `${value}g`;
}

/** A small pixel-art picture. Decorative pictures get alt="" so screen readers skip them. */
export function pixelImage(name, { size = 24, alt = '', className = 'pixel' } = {}) {
  return html`<img class="${className}" src="/art/${name}.svg" width="${size}" height="${size}" alt="${alt}">`;
}

/**
 * The search box. `big` is the large one on the homepage. `extra` is more
 * form fields (the filters on the results page), sent with the same form.
 */
export function searchBar({ value = '', big = false, action = '/search', name = 'q', label = 'Search the guide', placeholder = 'Search for crops, fish, items…', button = 'Search', extra = null } = {}) {
  return html`
    <form class="search${big ? ' search--big' : ''}" action="${action}" method="get" role="search">
      <div class="search-bar">
        <label class="visually-hidden" for="search-${name}">${label}</label>
        <svg class="search-bar__icon" viewBox="0 0 10 10" aria-hidden="true" shape-rendering="crispEdges">
          <path d="M3 0h3v1H3zM2 1h1v1H2zM6 1h1v1H6zM1 2h1v3H1zM7 2h1v3H7zM2 5h1v1H2zM6 5h1v1H6zM3 6h3v1H3zM7 6h1v1H7zM8 7h1v1H8zM9 8h1v1H9z" fill="currentColor"/>
        </svg>
        <input id="search-${name}" name="${name}" type="search" value="${value}" placeholder="${placeholder}" autocomplete="off"${big ? html` autofocus` : ''}>
        <button class="button" type="submit">${button}</button>
      </div>
      ${extra}
    </form>`;
}

/** A labelled drop-down list. options: [{ value, label }]. */
export function select({ name, label, options, value }) {
  return html`
    <label class="field">
      <span class="field__label">${label}</span>
      <select name="${name}">
        ${options.map((option) => html`<option value="${option.value}"${option.value === (value ?? '') ? html` selected` : ''}>${option.label}</option>`)}
      </select>
    </label>`;
}

/** A small coloured label for a season. */
export function seasonTag(season) {
  return html`<span class="tag tag--${season.toLowerCase()}">${season}</span>`;
}

/** The row of category shortcut links. */
export function categoryChips({ current } = {}) {
  return html`
    <nav class="chips" aria-label="Browse by category">
      <ul>
        ${CATEGORIES.map(
          (category) => html`
            <li>
              <a class="chip" href="${category.href}"${category.href === current ? html` aria-current="page"` : ''}>
                ${pixelImage(category.icon, { size: 22 })}<span>${category.label}</span>
              </a>
            </li>`,
        )}
      </ul>
    </nav>`;
}

/** "Wiki: Corn ↗ · revision 192088" for one fact or item. */
export function sourceLink({ title, url, revision }) {
  return html`<span class="source">Source:
    <a href="${url}" rel="noopener" target="_blank">${title ?? 'Stardew Valley Wiki'}<span class="visually-hidden"> (wiki page, opens in a new tab)</span></a>${
      revision
        ? html` · <a href="${revisionUrl(revision)}" rel="noopener" target="_blank">revision ${revision}<span class="visually-hidden"> (opens in a new tab)</span></a>`
        : ''
    }</span>`;
}

/** A friendly box for messages such as "no results". */
export function notice(content, { tone = 'info' } = {}) {
  return html`<div class="notice notice--${tone}" role="${tone === 'error' ? 'alert' : 'status'}">${content}</div>`;
}

/** The whole page around the content: head, header with the menu, footer. */
export function layout({ title, current, main, wide = false }) {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title ? `${title} · ${SITE_NAME}` : SITE_NAME}</title>
  <link rel="icon" href="/art/strawberry.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/">
      ${pixelImage('strawberry', { size: 32 })}
      <span>${SITE_NAME}</span>
    </a>
    <nav aria-label="Main">
      <ul class="site-nav">
        ${NAV.map(
          (link) => html`<li><a href="${link.href}"${link.href === current ? html` aria-current="page"` : ''}>${link.label}</a></li>`,
        )}
      </ul>
    </nav>
  </header>
  <main id="main" class="${wide ? 'page page--wide' : 'page'}">
    ${main}
  </main>
  <footer class="site-footer">
    <div class="site-footer__art" aria-hidden="true"></div>
    <p class="site-footer__text">
      Game facts from the <a href="https://stardewvalleywiki.com/" rel="noopener">Stardew Valley Wiki</a>,
      licensed <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" rel="noopener">CC BY-NC-SA</a>.
      A fan-made learning project, not affiliated with ConcernedApe.
    </p>
  </footer>
</body>
</html>`;
}

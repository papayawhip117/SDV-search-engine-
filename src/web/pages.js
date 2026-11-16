// The pages of the website. Each function gets the data it needs (the
// server looks it up) and returns the whole page as HTML. No database work
// happens here, which keeps these easy to test.

import { formatIngredient, formatRecipe } from '../cli/item.js';
import { SEASON_ORDER } from '../calc/profit.js';
import { ITEM_TYPES } from '../queries/search.js';
import {
  CATEGORIES,
  TYPE_LABELS,
  categoryChips,
  gold,
  itemHref,
  layout,
  notice,
  pixelImage,
  searchBar,
  seasonTag,
  select,
  sourceLink,
} from './components.js';
import { html, queryString } from './html.js';

// ---- Home -------------------------------------------------------------------

export function homePage() {
  return layout({
    current: '/',
    main: html`
      <section class="hero">
        <img class="hero__art pixel" src="/art/farm.svg" width="360" height="170" alt="">
        <h1>Search the Stardew Valley Wiki</h1>
        <p class="hero__tagline">${pixelImage('sparkle', { size: 12 })} Find crops, fish, gifts, recipes and more ${pixelImage('sparkle', { size: 12 })}</p>
        ${searchBar({ big: true })}
        ${categoryChips()}
        <p class="hero__plan">Planning your day?
          <a href="/today">${pixelImage('calendar', { size: 18 })} Today on the farm</a>
          <a href="/profit">${pixelImage('coin', { size: 18 })} Profit planner</a>
        </p>
      </section>`,
  });
}

// ---- Search results -----------------------------------------------------------

const SORT_LABELS = { relevance: 'Best match', name: 'Name (A–Z)', sell: 'Sell price (highest)', buy: 'Buy price (cheapest)' };

function filterFields({ type, season, sort }) {
  return html`
    <div class="filters">
      ${select({
        name: 'type',
        label: 'Type',
        value: type,
        options: [{ value: '', label: 'Everything' }, ...ITEM_TYPES.map((value) => ({ value, label: TYPE_LABELS[value][1] }))],
      })}
      ${select({
        name: 'season',
        label: 'Season',
        value: season,
        options: [{ value: '', label: 'Any season' }, ...SEASON_ORDER.map((value) => ({ value, label: value }))],
      })}
      ${select({
        name: 'sort',
        label: 'Sort by',
        value: sort,
        options: [{ value: '', label: 'Automatic' }, ...Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label }))],
      })}
      <button class="button button--quiet" type="submit">Apply</button>
    </div>`;
}

function resultItem(result) {
  return html`
    <li class="result">
      <div class="result__head">
        <a class="result__name" href="${itemHref(result.name)}">${result.name}</a>
        <span class="tag">${TYPE_LABELS[result.type]?.[0] ?? result.type}</span>
        ${result.seasons.map(seasonTag)}
      </div>
      <dl class="result__facts">
        <div><dt>Sells for</dt><dd>${gold(result.sellPrice)}</dd></div>
        ${result.buyPrice !== null ? html`<div><dt>Buy from</dt><dd>${gold(result.buyPrice)}</dd></div>` : ''}
      </dl>
      <p class="result__source">${sourceLink({ title: result.sourceTitle, url: result.sourceUrl, revision: result.sourceRevision })}</p>
    </li>`;
}

/** A heading that says what was searched: "“berry” in Summer", "Fish", "Everything". */
function describeSearch({ q, type, season }) {
  const what = q ? `“${q}”` : type ? TYPE_LABELS[type]?.[1] ?? type : 'Everything';
  const kind = q && type ? ` in ${TYPE_LABELS[type]?.[1].toLowerCase() ?? type}` : '';
  return `${what}${kind}${season ? `, ${season}` : ''}`;
}

/**
 * @param query      { q, type, season, sort } as typed in the address bar
 * @param results    from searchItems, or null if the search failed
 * @param error      a message to show instead of results
 * @param villagers  villager names that match the words (they live on the Gifts page)
 * @param limit      how many results were asked for, to say when there may be more
 */
export function resultsPage({ query, results = [], ignoredWords = [], error = null, villagers = [], limit }) {
  const current = CATEGORIES.find((category) => category.href === `/search${queryString({ type: query.type })}` && !query.q && !query.season);
  return layout({
    title: query.q || TYPE_LABELS[query.type]?.[1] || 'Search',
    current: '/',
    wide: true,
    main: html`
      ${searchBar({ value: query.q ?? '', extra: filterFields(query) })}
      ${categoryChips({ current: current?.href })}
      <section class="results" aria-labelledby="results-heading">
        <h1 id="results-heading">${describeSearch(query)}</h1>
        ${error ? notice(error, { tone: 'error' }) : ''}
        ${ignoredWords.length ? notice(`Words shorter than 3 letters are skipped: ${ignoredWords.join(', ')}`) : ''}
        ${villagers.map(
          (name) => html`<p class="villager-hint">${pixelImage('gift', { size: 20 })} Looking for the villager?
            <a href="/gifts${queryString({ villager: name })}">See ${name}'s birthday and favourite gifts</a></p>`,
        )}
        ${!error && results.length === 0
          ? notice(html`Nothing found. Try fewer or shorter words, another type or season, or <a href="/ask${queryString({ q: query.q })}">ask a question</a>.`)
          : ''}
        ${results.length
          ? html`
            <p class="results__count">${results.length === limit ? `Showing the first ${limit} results. Add words or filters to narrow it down.` : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}</p>
            <ol class="result-list">${results.map(resultItem)}</ol>`
          : ''}
      </section>`,
  });
}

// ---- One item ---------------------------------------------------------------

/** A comma-separated list of names, linking the ones that have an item page. */
export function nameLinks(names, knownItems) {
  return names.map((name, i) => html`${i ? ', ' : ''}${knownItems.has(name) ? html`<a href="${itemHref(name)}">${name}</a>` : name}`);
}

function prices(list) {
  if (list.length === 0) return 'Not sold in shops (by the wiki infobox)';
  return list.map(({ shop, price, note }, i) => html`${i ? html`<br>` : ''}${gold(price)} at ${shop}${note ? ` ${note}` : ''}`);
}

/** The rows of the item's fact table: [label, value] pairs, empty ones left out. */
function itemRows(item, knownItems) {
  const rows = [];
  const add = (label, value) => rows.push([label, value]);

  if (item.sellPrice !== null) add('Sell price', `${gold(item.sellPrice)}${item.sellPriceNote ? ` (${item.sellPriceNote})` : ''}`);
  else if (item.sellPriceNote) add('Sell price', item.sellPriceNote);
  if (item.type === 'seed' || item.buyPrices.length) add('Buy', prices(item.buyPrices));
  if (item.seasons.length) add('Seasons', item.seasons.map(seasonTag));

  if (item.crop) {
    const { crop } = item;
    if (crop.growthDays !== null) {
      add('Growth', `${crop.growthDays} days${crop.growthNote ? ` ${crop.growthNote}` : ''}${crop.stageDays.length ? ` (stages: ${crop.stageDays.join(', ')})` : ''}`);
    }
    if (crop.regrows !== null) add('Regrows', crop.regrows ? `Every ${crop.regrowthDays} days` : 'No');
    if (crop.isTrellis) add('Trellis', 'Yes, you can’t walk through it');
    if (crop.seed && crop.seed.name !== item.name) add('Seed', html`${nameLinks([crop.seed.name], knownItems)}<br>${prices(crop.seed.prices)}`);
  }
  if (item.growsInto.length) add('Grows into', nameLinks(item.growsInto, knownItems));

  if (item.fish) {
    const { fish } = item;
    add('Caught with', `${fish.catchMethod}${fish.isLegendary ? ' (legendary)' : ''}`);
    add('Where', fish.location ?? 'Unknown');
    if (fish.time) add('Time', fish.time);
    if (fish.weather || fish.weatherNote) add('Weather', fish.weather ?? fish.weatherNote);
    if (fish.difficulty !== null) add('Difficulty', `${fish.difficulty}${fish.behavior ? ` (${fish.behavior})` : ''}`);
    if (fish.fishingLevel !== null) add('Needs', `Fishing level ${fish.fishingLevel}${fish.fishingLevelNote ? ` ${fish.fishingLevelNote}` : ''}`);
  }
  if (item.machine?.products.length) add('Makes', nameLinks(item.machine.products, knownItems));
  if (item.madeBy.length) add('How it’s made', item.madeBy.map((recipe, i) => html`${i ? html`<br>` : ''}${formatRecipe(recipe)}`));
  if (item.dish) {
    const { dish } = item;
    add('Ingredients', dish.ingredients.map((ingredient, i) => html`${i ? ', ' : ''}${ingredient.name && knownItems.has(ingredient.name) ? html`<a href="${itemHref(ingredient.name)}">${formatIngredient(ingredient)}</a>` : formatIngredient(ingredient)}`));
    if (dish.buffs) add('Buffs', `${dish.buffs}${dish.buffDuration ? ` (${dish.buffDuration})` : ''}`);
    if (dish.edibility !== null) add('Energy', dish.edibility);
    add('Recipe from', dish.recipeSource ?? 'Unknown');
  }
  if (item.crafting) {
    const { crafting } = item;
    add('Crafted from', `${crafting.ingredients.map(formatIngredient).join(', ')}${crafting.outputQuantity > 1 ? ` (makes ${crafting.outputQuantity})` : ''}`);
    add('Recipe from', crafting.recipeSource ?? 'Unknown');
  }
  if (item.usedInDishes.length) add('Cooked into', nameLinks(item.usedInDishes, knownItems));
  if (item.usedInCrafting.length) add('Crafted into', nameLinks(item.usedInCrafting, knownItems));
  for (const entry of item.collections) {
    if (entry.found) add('Found', entry.found);
    if (entry.gemologistPrice !== null) add('Gemologist', `${gold(entry.gemologistPrice)} (with the Gemologist profession)`);
    if (entry.details) add('Details', entry.details);
  }
  return rows;
}

const TASTE_LABELS = [['love', 'Loved by'], ['like', 'Liked by'], ['dislike', 'Disliked by'], ['hate', 'Hated by']];

function giftSection(item) {
  const { giftTastes } = item;
  const rows = TASTE_LABELS.filter(([taste]) => giftTastes[taste].length);
  if (rows.length === 0) return '';
  return html`
    <section class="panel">
      <h2>${pixelImage('heart', { size: 18 })} As a gift</h2>
      <dl class="facts">
        ${rows.map(([taste, label]) => html`<div><dt>${label}</dt><dd>${
          giftTastes[taste].length === giftTastes.total
            ? 'Everyone'
            : giftTastes[taste].map((name, i) => html`${i ? ', ' : ''}<a href="/gifts${queryString({ villager: name })}">${name}</a>`)
        }</dd></div>`)}
      </dl>
    </section>`;
}

/** Other sources than the item's own page (a crafting recipe from the Crafting page, a Minerals table...). */
function extraSources(item) {
  const seen = new Set([item.source.url]);
  const sources = [];
  const add = (title, url, revision) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      sources.push({ title, url, revision });
    }
  };
  if (item.crafting) add('Crafting', item.crafting.sourceUrl, item.crafting.revisionId);
  for (const entry of item.collections) add(entry.page, entry.sourceUrl, entry.revisionId);
  for (const recipe of item.madeBy) add(recipe.sourceTitle, recipe.sourceUrl, null);
  return sources;
}

export function itemPage(item, { knownItems = new Set() } = {}) {
  const rows = itemRows(item, knownItems);
  const { source } = item;
  return layout({
    title: item.name,
    current: '/',
    main: html`
      <p class="back"><a href="/search${queryString({ type: item.type })}">← All ${TYPE_LABELS[item.type]?.[1].toLowerCase() ?? item.type}</a></p>
      <article class="item">
        <h1>${item.name} <span class="tag">${TYPE_LABELS[item.type]?.[0] ?? item.type}</span></h1>
        ${item.summary ? html`<p class="item__summary">${item.summary}</p>` : ''}
        ${rows.length ? html`<section class="panel"><h2 class="visually-hidden">Facts</h2><dl class="facts">${rows.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl></section>` : ''}
        ${giftSection(item)}
        <footer class="item__source">
          <p>${sourceLink(source)}${source.revisionTime ? ` · edited ${source.revisionTime.slice(0, 10)}` : ''} · downloaded ${source.retrievedAt.slice(0, 10)}</p>
          ${extraSources(item).map((extra) => html`<p>Also from ${sourceLink(extra)}</p>`)}
        </footer>
      </article>`,
  });
}

export function itemNotFoundPage(name, suggestions) {
  return layout({
    title: 'Not found',
    main: html`
      <h1>No item called “${name}”</h1>
      ${suggestions.length
        ? html`<p>Did you mean ${suggestions.map((suggestion, i) => html`${i ? ', ' : ''}<a href="${itemHref(suggestion)}">${suggestion}</a>`)}?</p>`
        : ''}
      ${searchBar({ value: name })}`,
  });
}

// ---- Gifts ------------------------------------------------------------------

/** villagers: [{ name, birthday: { season, day } | null }] */
export function giftsPage(villagers) {
  return layout({
    title: 'Gifts',
    current: '/',
    main: html`
      ${categoryChips({ current: '/gifts' })}
      <h1>Villagers and their gifts</h1>
      <p>Pick a villager to see their birthday and what they love, like, dislike and hate.</p>
      ${villagers.length === 0 ? notice('No villagers in the database yet. Run npm run build-db with the villager pages imported.') : ''}
      <ul class="villager-list">
        ${villagers.map(
          (villager) => html`<li><a href="/gifts${queryString({ villager: villager.name })}">${villager.name}</a>
            ${villager.birthday ? html`<span class="muted">${villager.birthday.season} ${villager.birthday.day}</span>` : ''}</li>`,
        )}
      </ul>`,
  });
}

/** One villager (from getVillager). */
export function villagerPage(villager, { knownItems = new Set() } = {}) {
  const tastes = [['love', 'Loves'], ['like', 'Likes'], ['neutral', 'Neutral'], ['dislike', 'Dislikes'], ['hate', 'Hates']];
  return layout({
    title: villager.name,
    current: '/',
    main: html`
      <p class="back"><a href="/gifts">← All villagers</a></p>
      <article class="item">
        <h1>${villager.name}</h1>
        <section class="panel">
          <dl class="facts">
            <div><dt>Birthday</dt><dd>${villager.birthday ? html`${seasonTag(villager.birthday.season)} ${villager.birthday.day}` : 'Unknown'}</dd></div>
            ${villager.marriageable !== null ? html`<div><dt>Can marry</dt><dd>${villager.marriageable ? 'Yes' : 'No'}</dd></div>` : ''}
          </dl>
        </section>
        <section class="panel">
          <h2>${pixelImage('gift', { size: 18 })} Gifts</h2>
          <p class="muted">Their own lists, as the wiki writes them. Universal loves and likes apply too.</p>
          <dl class="facts">
            ${tastes
              .filter(([taste]) => villager.tastes[taste].length)
              .map(([taste, label]) => html`<div><dt>${label}</dt><dd>${nameLinks(villager.tastes[taste], knownItems)}</dd></div>`)}
          </dl>
        </section>
        <footer class="item__source"><p>${sourceLink({ title: villager.name, url: villager.source.url, revision: villager.source.revision })}</p></footer>
      </article>`,
  });
}

// ---- Ask AI -----------------------------------------------------------------

const EXAMPLE_QUESTIONS = ['What does Abigail love?', 'Best crops to plant in summer', 'Where do I catch a Catfish?'];

function factList(facts) {
  return html`
    <ol class="fact-list">
      ${facts.map(
        (fact) => html`
          <li id="fact-${fact.id}">
            <span class="fact-list__id">${fact.id}</span>
            <div>
              <p>${fact.text}</p>
              <p class="result__source">${fact.sources.map((source, i) => html`${i ? html`<br>` : ''}${sourceLink(source)}`)}</p>
            </div>
          </li>`,
      )}
    </ol>`;
}

function understoodLine({ understood, usedSearch }) {
  const parts = [
    understood.villagers.length && `villagers: ${understood.villagers.join(', ')}`,
    understood.items.length && `items: ${understood.items.join(', ')}`,
    understood.seasons.length && `seasons: ${understood.seasons.join(', ')}`,
    understood.topics.length && `topics: ${understood.topics.join(', ')}`,
  ].filter(Boolean);
  return html`<p class="muted">I looked for ${parts.length ? parts.join('; ') : 'the closest search results'}${usedSearch ? ' (no names recognised, so these are the closest search results)' : ''}.</p>`;
}

/**
 * @param question  what was asked ('' shows only the form)
 * @param result    from findFacts (no key) or answerQuestion (with a key)
 * @param hasKey    whether an API key is set up
 * @param error     a message when asking Claude failed
 */
export function askPage({ question = '', result = null, hasKey = false, error = null }) {
  let body = '';
  if (question && result) {
    const showAnswer = result.answer !== undefined && result.accepted;
    body = html`
      ${error ? notice(`Couldn’t get an AI answer: ${error} Here are the facts from the wiki instead.`, { tone: 'error' }) : ''}
      ${result.answer !== undefined && !result.accepted
        ? notice(html`The AI’s answer didn’t pass the app’s checks, so it isn’t shown:<ul>${result.problems.map((problem) => html`<li>${problem}</li>`)}</ul>Here are the facts from the wiki instead.`, { tone: 'error' })
        : ''}
      ${showAnswer ? html`<section class="panel answer"><h2>Answer</h2><p>${result.answer}</p></section>` : ''}
      ${result.facts.length === 0
        ? notice(html`I couldn’t find facts about that in the database. Try naming an item, a villager or a season, or <a href="/search${queryString({ q: question })}">search instead</a>.`)
        : html`
          <section class="answer-facts">
            <h2>${showAnswer ? 'Sources' : 'What the wiki says'}</h2>
            ${understoodLine(result)}
            ${factList(showAnswer ? result.cited : result.facts)}
          </section>`}`;
  }

  return layout({
    title: 'Ask AI',
    current: '/ask',
    main: html`
      <section class="ask-intro">
        <h1>Ask a question</h1>
        <p>Ask about crops, fish, gifts, recipes or villagers. Every answer comes from the wiki facts in this app, with a link to each source.</p>
      </section>
      ${searchBar({ action: '/ask', value: question, label: 'Your question', placeholder: 'e.g. What does Abigail love?', button: 'Ask' })}
      ${!hasKey
        ? notice(html`${pixelImage('sparkle', { size: 12 })} The AI helper is resting: there’s no API key set up, so you’ll see the wiki facts that answer your question, each with its source. (You can add a key later; see the README.)`)
        : ''}
      ${!question
        ? html`<p class="muted">Try: ${EXAMPLE_QUESTIONS.map((example, i) => html`${i ? ' · ' : ''}<a href="/ask${queryString({ q: example })}">${example}</a>`)}</p>`
        : ''}
      ${body}`,
  });
}

// ---- About and errors ---------------------------------------------------------

/** counts: [{ type, count }] of items in the database. */
export function aboutPage({ counts = [], villagerCount = 0 } = {}) {
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  return layout({
    title: 'About',
    current: '/about',
    main: html`
      <article class="prose">
        <h1>About this guide</h1>
        <p>A cozy little search engine for Stardew Valley, built as a learning project. It searches a database made from the
          <a href="https://stardewvalleywiki.com/">Stardew Valley Wiki</a> on your own computer, so searches are instant and work offline.</p>
        <h2>What’s inside</h2>
        <p>${total} items and ${villagerCount} villagers:</p>
        <ul class="count-list">
          ${counts.map((row) => html`<li><a href="/search${queryString({ type: row.type })}">${TYPE_LABELS[row.type]?.[1] ?? row.type}</a> <span class="muted">${row.count}</span></li>`)}
        </ul>
        <h2>Where the facts come from</h2>
        <p>Every fact links to the wiki page it came from and the exact revision of that page, so you can check it.
          Prices and profit numbers are worked out by the app’s own code, never by the AI.</p>
        <p>Wiki text is licensed <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/">CC BY-NC-SA</a>: this project is non-commercial
          and shares its data under the same license. The pixel art is original; no game images are copied.
          Stardew Valley is © ConcernedApe.</p>
      </article>`,
  });
}

export function notFoundPage() {
  return layout({
    title: 'Page not found',
    main: html`
      <h1>This path leads nowhere</h1>
      <p>Maybe a raccoon moved it. Try a search instead.</p>
      ${searchBar()}`,
  });
}

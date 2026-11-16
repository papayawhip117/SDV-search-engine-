// Step 1 of the AI assistant: question → facts from our database.
//
// No AI here. This reads the question, works out what it's about (items,
// villagers, seasons, and a few topics like "profit" or "birthday"), and
// collects the facts our database has about those things. Every fact keeps
// the wiki page it came from.
//
//   findFacts(db, 'What does Abigail love?')
//   → { understood: { villagers: ['Abigail'], ... },
//       facts: [{ id: 'F1', text: 'Abigail loves: Amethyst, ...', sources: [{ title, url, revision }] }, ...] }
//
// In step 2 the AI gets only these facts and must cite their ids, and in
// step 3 the app checks those citations. So the rule "the AI may only use
// verified data" is enforced here: if a fact isn't in this list, the AI
// never sees it.
//
// Numbers the app works out (profit per day, artisan values) are marked
// "worked out by the app", so it's clear they come from code, not the wiki
// text and not the AI.

import { SEASON_ORDER, calculateProfit } from '../calc/profit.js';
import { getProfitInputs } from '../queries/cropQueries.js';
import { getFish } from '../queries/fishQueries.js';
import { getProcessingOptions } from '../queries/artisanQueries.js';
import { getBirthdays, getVillager, giftTaste, whoLikes } from '../queries/giftQueries.js';
import { getItemDetails, searchItems } from '../queries/search.js';

/** At most this many facts go to the AI, so the prompt stays small and focused. */
export const MAX_FACTS = 40;

const TOPICS = {
  profit: /\b(profit|profitable|money|gold per day|best crops?|most (money|gold))\b/i,
  fish: /\b(fish|fishing|catch)\b/i,
  birthday: /\bbirthdays?\b/i,
  forage: /\bforag(e|ing)\b/i,
  gift: /\b(gifts?|give|loves?|likes?|hates?|dislikes?)\b/i,
};

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Strawberry" → it, "Strawberries", "Strawberrys"; "Peach" → "Peaches". */
function nameForms(name) {
  const forms = [name, `${name}s`, `${name}es`];
  if (/[^aeiou]y$/i.test(name)) forms.push(`${name.slice(0, -1)}ies`);
  return forms;
}

/**
 * Find the names from a list that appear in the question, longest first and
 * without overlaps ("Ancient Seeds" wins over "Ancient Seed").
 */
function findNames(question, names) {
  const found = [];
  const taken = []; // [start, end] ranges already used
  const sorted = [...names].filter((name) => name.length >= 3).sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const pattern = new RegExp(`(?<![\\w'])(${nameForms(name).map(escapeRegExp).join('|')})(?![\\w])`, 'i');
    const match = pattern.exec(question);
    if (!match) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (taken.some(([from, to]) => start < to && end > from)) continue;
    taken.push([start, end]);
    found.push({ name, start });
  }
  return found.sort((a, b) => a.start - b.start).map((entry) => entry.name);
}

/**
 * Work out what a question is about. Nothing clever: names and words we
 * know, matched in the text.
 * Returns { items, villagers, seasons, topics }.
 */
export function understandQuestion(db, question) {
  const text = question.replace(/[’‘]/g, "'");
  const villagerNames = db.prepare('SELECT name FROM villagers').all().map((row) => row.name);
  const itemNames = db.prepare('SELECT name FROM items').all().map((row) => row.name);
  const villagers = findNames(text, villagerNames);
  // A villager's name isn't also read as an item (there's no item called Abigail, but be safe).
  const items = findNames(text, itemNames).filter((name) => !villagers.includes(name));
  const seasons = SEASON_ORDER.filter((season) => new RegExp(`\\b${season}\\b`, 'i').test(text));
  if (/\bautumn\b/i.test(text) && !seasons.includes('Fall')) seasons.push('Fall');
  const topics = Object.keys(TOPICS).filter((topic) => TOPICS[topic].test(text));
  return { items, villagers, seasons, topics };
}

/** Turns page URLs into { title, url, revision } using the source_pages table. */
function sourceLookup(db) {
  const byUrl = db.prepare(
    'SELECT page_title AS title, page_url AS url, revision_id AS revision FROM source_pages WHERE page_url = ? ORDER BY id DESC LIMIT 1',
  );
  const byTitle = db.prepare(
    'SELECT page_title AS title, page_url AS url, revision_id AS revision FROM source_pages WHERE page_title = ? ORDER BY id DESC LIMIT 1',
  );
  return {
    url: (url) => (url ? byUrl.get(url) ?? null : null),
    title: (title) => byTitle.get(title) ?? null,
  };
}

/** A list of names as "A, B and C". */
function listOf(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function gold(value) {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}g`;
}

/** Facts about one item, from its details. */
function itemFacts(db, name, add, sources) {
  const item = getItemDetails(db, name);
  if (!item) return;
  const own = sources.url(item.source.url);

  const price =
    item.sellPrice !== null
      ? `sells for ${item.sellPrice}g${item.sellPriceNote ? ` (${item.sellPriceNote})` : ''}`
      : item.sellPriceNote
        ? `sell price: ${item.sellPriceNote}`
        : 'has no sell price in our data';
  add(`${item.name} is a ${item.type} item. It ${price}.`, [own]);
  if (item.summary) add(`The wiki describes ${item.name}: "${item.summary}"`, [own]);
  if (item.seasons.length) add(`${item.name} is in season in ${listOf(item.seasons)}.`, [own]);

  if (item.crop) {
    const { crop } = item;
    const growth = crop.growthDays === null ? 'an unknown number of days' : `${crop.growthDays} days${crop.growthNote ? ` ${crop.growthNote}` : ''}`;
    const regrowth = crop.regrows === null ? '' : crop.regrows ? ` It regrows every ${crop.regrowthDays} days.` : ' It does not regrow.';
    add(`${item.name} takes ${growth} to grow.${regrowth}${crop.isTrellis ? ' It grows on a trellis.' : ''}`, [own]);
    if (crop.seed && crop.seed.name !== item.name) {
      const prices = crop.seed.prices.map((p) => `${p.price}g at ${p.shop}${p.note ? ` ${p.note}` : ''}`);
      add(
        `${item.name} grows from ${crop.seed.name}${prices.length ? `, which costs ${listOf(prices)}` : ', which no shop in our data sells'}.`,
        [own, ...crop.seed.prices.map((p) => sources.url(p.sourceUrl))],
      );
    }
  }
  if (item.growsInto.length) add(`${item.name} grows into ${listOf(item.growsInto)}.`, [own]);
  if (item.buyPrices.length && item.type === 'seed') {
    add(`${item.name} can be bought for ${listOf(item.buyPrices.map((p) => `${p.price}g at ${p.shop}${p.note ? ` ${p.note}` : ''}`))}.`, [
      ...item.buyPrices.map((p) => sources.url(p.sourceUrl)),
    ]);
  }

  if (item.fish) {
    const { fish } = item;
    const parts = [
      `caught with a ${fish.catchMethod}`,
      fish.location && `at ${fish.location}`,
      fish.time && `between ${fish.time}`,
      (fish.weather || fish.weatherNote) && `weather: ${fish.weather ?? fish.weatherNote}`,
      fish.difficulty !== null && `difficulty ${fish.difficulty}${fish.behavior ? ` (${fish.behavior})` : ''}`,
      fish.seasonNote && `the wiki notes "${fish.seasonNote}"`,
      fish.isLegendary && 'it is a legendary fish',
    ].filter(Boolean);
    add(`${item.name}: ${parts.join('; ')}.`, [own]);
  }

  if (item.machine?.products.length) add(`A ${item.name} makes ${listOf(item.machine.products)}.`, [own]);
  for (const recipe of item.madeBy.slice(0, 4)) {
    const time = recipe.minutes !== null ? `${recipe.minutes} minutes (${recipe.days} days)` : recipe.timeNote ?? 'an unknown time';
    const value = recipe.sellPrice !== null ? `${recipe.sellPrice}g` : recipe.priceNote ?? 'an unknown price';
    add(`${recipe.product} is made in a ${recipe.machine} from ${recipe.inputNote ?? 'an unknown input'}; it takes ${time} and sells for ${value}.`, [
      sources.url(recipe.sourceUrl),
    ]);
  }

  const processing = getProcessingOptions(db, item.name);
  for (const option of processing?.options.slice(0, 4) ?? []) {
    if (option.value === null) continue;
    const per = option.valuePerInput !== null && option.inputQuantity !== 1 ? ` (${gold(option.valuePerInput)} per ${item.name})` : '';
    add(
      `${item.name} can be made into ${option.product} in a ${option.machine}, worth ${gold(option.value)}${per}. ` +
        '(Worked out by the app from the wiki\'s price formula.)',
      [sources.url(option.sourceUrl), sources.url(processing.basePriceSource)],
    );
  }

  if (item.dish) {
    const ingredients = item.dish.ingredients.map((i) => `${i.name ?? `any ${i.group}`} ×${i.quantity}`);
    add(`${item.name} is cooked from ${listOf(ingredients)}. Recipe from: ${item.dish.recipeSource ?? 'unknown'}.`, [own]);
    if (item.dish.buffs) add(`${item.name} gives ${item.dish.buffs}${item.dish.buffDuration ? ` for ${item.dish.buffDuration}` : ''}.`, [own]);
  }
  if (item.usedInDishes.length) add(`${item.name} is an ingredient in ${listOf(item.usedInDishes)}.`, [own]);

  if (item.crafting) {
    const { crafting } = item;
    const craftSource = sources.url(crafting.sourceUrl);
    const ingredients = crafting.ingredients.map((i) => `${i.name ?? `any ${i.group}`} ×${i.quantity}`);
    const makes = crafting.outputQuantity > 1 ? ` One craft makes ${crafting.outputQuantity}.` : '';
    add(`${item.name} is crafted from ${listOf(ingredients)}.${makes} Recipe from: ${crafting.recipeSource ?? 'unknown'}.`, [craftSource]);
  }
  if (item.usedInCrafting.length) {
    add(`${item.name} is used to craft ${listOf(item.usedInCrafting.slice(0, 15))}${item.usedInCrafting.length > 15 ? ' and more' : ''}.`, [
      sources.title('Crafting'),
    ]);
  }

  for (const entry of item.collections) {
    const parts = [
      entry.sections && `listed under ${entry.sections.replace(/ \| /g, ', ')}`,
      entry.found && `found: ${entry.found}`,
      entry.gemologistPrice !== null && `${entry.gemologistPrice}g with the Gemologist profession`,
      entry.details,
    ].filter(Boolean);
    if (parts.length) add(`The ${entry.page} page says about ${item.name}: ${parts.join('; ')}.`, [sources.url(entry.sourceUrl)]);
  }

  const tastes = item.giftTastes;
  const giftParts = [
    ['love', 'loved by'],
    ['like', 'liked by'],
    ['dislike', 'disliked by'],
    ['hate', 'hated by'],
  ]
    .filter(([taste]) => tastes[taste].length)
    .map(([taste, label]) => `${label} ${tastes[taste].length === tastes.total ? 'everyone' : listOf(tastes[taste])}`);
  if (giftParts.length) {
    add(`As a gift, ${item.name} is ${giftParts.join('; ')}.`, [sources.title('List of All Gifts'), sources.title('Friendship')]);
  }
}

/** Facts about one villager. */
function villagerFacts(db, name, add, sources) {
  const villager = getVillager(db, name);
  if (!villager) return;
  const giftPage = sources.url(villager.source.url);
  const birthday = villager.birthday ? `${villager.birthday.season} ${villager.birthday.day}` : 'unknown';
  const marriage =
    villager.marriageable === null ? '' : villager.marriageable ? ' They can be married.' : ' They are not a marriage candidate.';
  add(`${villager.name}'s birthday is ${birthday}.${marriage}`, [giftPage, ...(villager.marriageable === null ? [] : [sources.title('Villagers')])]);
  const labels = { love: 'loves', like: 'likes', neutral: 'is neutral about', dislike: 'dislikes', hate: 'hates' };
  for (const [taste, label] of Object.entries(labels)) {
    if (villager.tastes[taste].length) add(`${villager.name} ${label}: ${villager.tastes[taste].join(', ')}.`, [giftPage]);
  }
  add(`Everyone also has the universal gift tastes, unless their own list says otherwise.`, [
    sources.title('List of All Gifts'),
    sources.title('Friendship'),
  ]);
}

/** Facts for a season and a topic ("best crops in Summer", "Fall birthdays"). */
function seasonFacts(db, season, topics, add, sources) {
  if (topics.includes('profit')) {
    const ranked = getProfitInputs(db, season)
      .map((crop) => ({ crop, result: calculateProfit(crop, crop.seedPrice, { season, plantDay: 1 }) }))
      .filter(({ result }) => result.ok)
      .sort((a, b) => b.result.profitPerDay - a.result.profitPerDay)
      .slice(0, 5);
    for (const { crop, result } of ranked) {
      add(
        `Planted on ${season} 1, one ${crop.name} plant gives ${result.harvests} harvest(s) and ${gold(result.profit)} profit ` +
          `(${gold(result.profitPerDay)} per day), with seeds at ${crop.seedPrice}g from ${crop.seedShop}. ` +
          '(Worked out by the app: base quality, no fertilizer or professions.)',
        [sources.url(crop.cropSourceUrl), sources.url(crop.seedPriceSourceUrl)],
      );
    }
  }
  if (topics.includes('fish')) {
    const { fish } = getFish(db, { season });
    for (const row of fish.slice(0, 8)) {
      add(`${row.name} can be caught in ${season} (${row.location ?? row.catchMethod}${row.time ? `, ${row.time}` : ''}); it sells for ${row.sellPrice}g.`, [
        sources.url(row.sourceUrl),
      ]);
    }
  }
  if (topics.includes('birthday')) {
    const birthdays = getBirthdays(db, season).map((row) => `${row.name} (${season} ${row.day})`);
    if (birthdays.length) add(`Birthdays in ${season}: ${birthdays.join(', ')}.`, [sources.title('List of All Gifts')]);
  }
  if (topics.includes('forage')) {
    const { results } = searchItems(db, { type: 'forage', season, sortBy: 'sell', limit: 12 });
    if (results.length) {
      add(`Forage in ${season}: ${results.map((r) => `${r.name} (${r.sellPrice}g)`).join(', ')}.`, [sources.title('Foraging')]);
    }
  }
}

/**
 * Collect the facts that answer a question.
 * Returns { question, understood, facts, usedSearch }.
 * Each fact: { id: 'F1', text, sources: [{ title, url, revision }] }.
 * usedSearch is true when no name was recognised and full-text search picked the items.
 */
export function findFacts(db, question) {
  const understood = understandQuestion(db, question);
  const sources = sourceLookup(db);
  const facts = [];
  const seen = new Set();
  const add = (text, factSources) => {
    if (facts.length >= MAX_FACTS || seen.has(text)) return;
    seen.add(text);
    const unique = [...new Map(factSources.filter(Boolean).map((source) => [source.url, source])).values()];
    if (unique.length === 0) return; // a fact we can't cite is a fact we don't use
    facts.push({ id: `F${facts.length + 1}`, text, sources: unique });
  };

  // A villager and an item together: the direct answer first.
  for (const villager of understood.villagers) {
    for (const item of understood.items) {
      const taste = giftTaste(db, villager, item);
      add(
        taste
          ? `${villager} ${taste.taste === 'neutral' ? 'is neutral about' : `${taste.taste}s`} ${item} as a gift (${
              taste.from.startsWith('villager') ? `${villager}'s own list` : 'the universal list'
            }: ${taste.because}).`
          : `The wiki's gift lists don't say how ${villager} feels about ${item}.`,
        taste ? [sources.url(taste.sourceUrl)] : [sources.title('List of All Gifts')],
      );
    }
  }
  for (const villager of understood.villagers) villagerFacts(db, villager, add, sources);
  for (const item of understood.items) itemFacts(db, item, add, sources);
  for (const season of understood.seasons) seasonFacts(db, season, understood.topics, add, sources);

  // Nothing recognised: let the search engine suggest the closest items.
  let usedSearch = false;
  if (facts.length === 0) {
    try {
      const { results } = searchItems(db, { text: question, limit: 3 });
      for (const result of results) itemFacts(db, result.name, add, sources);
      usedSearch = results.length > 0;
    } catch {
      // Questions with only short or ignored words can't be searched; no facts then.
    }
  }
  return { question, understood, facts, usedSearch };
}

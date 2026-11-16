// Turns one downloaded fish page into clean fish facts.
//
// Fish pages use their own template, {{Infobox fish}}. The real Tuna page:
//
//   {{Infobox fish
//   |eng        = Tuna
//   |location   = [[The Beach|Ocean]] • [[Ginger Island]]
//   |time       = 6am – 7pm
//   |season     = {{Season|Summer}} • {{Season|Winter}}<br />
//   '''[[Ginger Island]] (except Island North):''' {{Season|All}}
//   |weather    = Any
//   |difficulty = 70
//   |behavior   = Smooth
//   |size       = 12-61
//   |price      = 100
//   }}
//
// Crab pot fish have no location/time/weather/difficulty. They have a
// "source" field instead ("Crab Pot: Saltwater").
//
// SEASONS: the season field is often a sentence ("Fall • Winter with Rain
// Totem"), which we can't safely turn into a list. So:
//   - if it's a plain list ("Summer • Winter", "All") we use it, and check
//     it against the page's season categories (Category:Summer fish ...)
//   - otherwise we use the season categories, which the wiki's editors keep
//     for the normal seasons, and keep the full sentence in seasonNote.
// Where fish live (Ocean, River, Lake...) also comes from the categories,
// with the infobox's own wording kept in locationNote.

import {
  findTemplateCall,
  parseLeadingInteger,
  parseTemplateParams,
  toPlainText,
} from './wikitext.js';
import { getWikitext } from './cropExtractor.js';

export const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

/** Wiki category → the area name we store. Read from the 71 fish pages. */
export const AREA_CATEGORIES = {
  'Ocean fish': 'Ocean',
  'River fish': 'River',
  'Lake fish': 'Lake',
  'Pond fish': 'Pond',
  'Mine fish': 'The Mines',
  'Desert fish': 'The Desert',
  'Secret Woods fish': 'Secret Woods',
  'Sewer fish': 'The Sewers',
  'Island fish': 'Ginger Island',
};

/** The categories that mark a page as a fish we collected (used by the importer). */
export const FISH_CATEGORIES = [
  ...SEASONS.map((season) => `${season} fish`),
  ...Object.keys(AREA_CATEGORIES),
  'Legendary fish',
  'Crab pot fish',
];

const WEATHER_VALUES = ['Any', 'Sun', 'Rain'];

export function isFishPage(page) {
  return findTemplateCall(getWikitext(page) ?? '', 'Infobox fish') !== null;
}

/**
 * Infobox value → one line of readable text. Line breaks and list items
 * become "; " so "6am – 11am<br />6pm – 2am" reads "6am – 11am; 6pm – 2am".
 */
export function plainValue(value) {
  if (!value) return null;
  const withBreaks = value
    .replace(/<!--[\s\S]*?-->/g, '') // editors' hidden comments
    .replace(/<br\s*\/?>|<\/li>|\n/gi, ' ;; ')
    .replace(/;;\s*\*/g, ';;'); // "* item" list bullets
  const parts = toPlainText(withBreaks)
    .split(';;')
    .map((part) => part.trim())
    .filter(Boolean);

  // A line that ends in ":" or "•" carries on onto the next one:
  // "Secret Woods:" + "Spring • Summer" → "Secret Woods: Spring • Summer"
  const lines = [];
  for (const part of parts) {
    const previous = lines[lines.length - 1];
    if (previous && /[:•]$/.test(previous)) lines[lines.length - 1] = `${previous} ${part}`;
    else lines.push(part);
  }
  return lines.join('; ') || null;
}

/**
 * A season value that is only a list of seasons → that list, else null.
 *   "{{Season|Summer}} • {{Season|Winter}}" → ['Summer', 'Winter']
 *   "All" or "Any"                         → all four
 *   "{{Season|Fall}} • {{Season|Winter}} with [[Rain Totem]]" → null
 */
export function parsePlainSeasonList(value) {
  const text = toPlainText((value ?? '').replace(/<br\s*\/?>/gi, ' '));
  if (!text) return null;
  if (/^(all|any)$/i.test(text)) return [...SEASONS];

  const words = text.split(/\s*•\s*/).filter(Boolean);
  const seasons = words.map((word) => SEASONS.find((season) => season.toLowerCase() === word.toLowerCase()));
  if (seasons.some((season) => season === undefined)) return null;
  return SEASONS.filter((season) => seasons.includes(season)); // in calendar order, no repeats
}

/** "12-61" → { min: 12, max: 61 } (inches). */
export function parseSize(value) {
  const match = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(value ?? '');
  return match ? { min: Number(match[1]), max: Number(match[2]) } : null;
}

/**
 * Extract one fish page.
 * Returns { ok: true, fish, warnings, notes } or { ok: false, reason }.
 */
export function extractFish(page) {
  const wikitext = getWikitext(page);
  const infobox = findTemplateCall(wikitext ?? '', 'Infobox fish');
  if (infobox === null) return { ok: false, reason: 'no {{Infobox fish}} on the page' };

  const { named } = parseTemplateParams(infobox);
  const warnings = [];
  const notes = [];
  const categories = (page.categories ?? []).map((category) => category.title.replace(/^Category:/, ''));

  const name = plainValue(named.eng) ?? page.title;

  const sellPrice = parseLeadingInteger(named.price);
  if (sellPrice === null) warnings.push(`could not read the price "${named.price ?? ''}"`);

  // Seasons (see the explanation at the top of this file).
  const categorySeasons = SEASONS.filter((season) => categories.includes(`${season} fish`));
  const listedSeasons = parsePlainSeasonList(named.season);
  let seasons;
  let seasonNote = null;
  if (listedSeasons) {
    seasons = listedSeasons;
    if (categorySeasons.length && categorySeasons.join() !== listedSeasons.join()) {
      warnings.push(
        `the infobox seasons (${listedSeasons.join(', ')}) differ from the season categories (${categorySeasons.join(', ')})`,
      );
    }
  } else {
    seasons = categorySeasons;
    seasonNote = plainValue(named.season);
    if (seasons.length === 0) {
      warnings.push(`no season list: the infobox says "${seasonNote ?? ''}" and the page is in no season category`);
    } else {
      notes.push(`seasons ${seasons.join(', ')} taken from the categories; the infobox says "${seasonNote}"`);
    }
  }

  const areas = Object.entries(AREA_CATEGORIES)
    .filter(([category]) => categories.includes(category))
    .map(([, area]) => area);

  const weatherNote = plainValue(named.weather);
  const weather = WEATHER_VALUES.find((value) => value.toLowerCase() === (weatherNote ?? '').toLowerCase()) ?? null;

  const difficulty = parseLeadingInteger(named.difficulty);
  if (named.difficulty && difficulty === null) warnings.push(`could not read the difficulty "${named.difficulty}"`);

  const size = parseSize(named.size);
  if (named.size && size === null) warnings.push(`could not read the size "${named.size}"`);

  // "fl" is the fishing level needed (legendary fish): "7 (Forge)" → 7 + note.
  const fishingLevel = parseLeadingInteger(named.fl);
  const fishingLevelNote = named.fl ? plainValue(named.fl.replace(/^\s*\d+/, '')) : null;

  const isCrabPot = categories.includes('Crab pot fish');

  return {
    ok: true,
    fish: {
      name,
      sellPrice,
      seasons,
      seasonNote,
      areas,
      // crab pot fish have "source" ("Crab Pot: Saltwater") instead of "location"
      locationNote: plainValue(named.location) ?? plainValue(named.source),
      timeNote: plainValue(named.time),
      weather,
      // only kept when it says more than Any/Sun/Rain
      weatherNote: weather ? null : weatherNote,
      difficulty,
      behavior: plainValue(named.behavior),
      sizeMin: size?.min ?? null,
      sizeMax: size?.max ?? null,
      fishingLevel,
      fishingLevelNote,
      isLegendary: categories.includes('Legendary fish'),
      catchMethod: isCrabPot ? 'crab pot' : 'fishing rod',
    },
    warnings,
    notes,
  };
}

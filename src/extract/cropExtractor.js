// Turns one downloaded crop page into clean crop facts.
//
// Where each fact comes from (verified on real pages, see docs/phase-1-research.md 3b):
//   name, seed, growth, season, sellprice  →  the {{Infobox}} at the top
//   regrowth and days per stage            →  the table in the "Stages" section
//
// Rules:
//   - A value we can't read becomes null and gets a warning. We never guess.
//   - A page without an infobox "growth" field isn't a crop: we skip it and
//     say why, so it can be checked by hand.

import {
  findTemplateCall,
  firstTemplateArgument,
  getSection,
  parseFirstTable,
  parseLeadingInteger,
  parseTemplateParams,
  stripLinks,
} from './wikitext.js';

export const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

/** The current wikitext of an API page object (formatversion=2). */
export function getWikitext(page) {
  return page.revisions?.[0]?.slots?.main?.content ?? null;
}

/**
 * Read the season field. The wiki writes it two ways:
 *   "Spring"
 *   "{{Season|Summer}} • {{Season|Fall}}"
 * Returns { seasons: ['Summer', 'Fall'], unknown: [] }.
 */
export function parseSeasons(value) {
  if (!value) return { seasons: [], unknown: [] };

  let names = [...value.matchAll(/\{\{\s*[Ss]eason\s*\|\s*([^}|]+?)\s*\}\}/g)].map((m) => m[1]);
  if (names.length === 0) {
    names = stripLinks(value)
      .split(/•|,|\/|<br\s*\/?>|\band\b/i)
      .map((name) => name.trim())
      .filter(Boolean);
  }

  const seasons = [];
  const unknown = [];
  for (const name of names) {
    const known = SEASONS.find((season) => season.toLowerCase() === name.toLowerCase());
    if (known) {
      if (!seasons.includes(known)) seasons.push(known);
    } else {
      unknown.push(name);
    }
  }
  return { seasons, unknown };
}

/**
 * Read the "Stages" table. Its last data row looks like:
 *   1 Day | 1 Day | 2 Days | 2 Days | 2 Days | Total: 8 Days | Regrowth: 4 Days
 * Returns { stageDays: [1,1,2,2,2], totalDays: 8, regrowthDays: 4 | null } or null.
 */
export function parseStagesTable(wikitext) {
  const section = getSection(wikitext, 'Stages');
  if (section === null) return null;
  const rows = parseFirstTable(section);
  if (!rows) return null;

  const daysRow = rows.find((row) => row.some((cell) => /^Total:/i.test(cell)));
  if (!daysRow) return null;

  const stageDays = [];
  let totalDays = null;
  let regrowthDays = null;
  for (const cell of daysRow) {
    const total = /^Total:\s*(\d+)/i.exec(cell);
    const regrowth = /^Regrowth:\s*(\d+)/i.exec(cell);
    const stage = /^(\d+)\s*Days?$/i.exec(cell);
    if (total) totalDays = Number(total[1]);
    else if (regrowth) regrowthDays = Number(regrowth[1]);
    else if (stage) stageDays.push(Number(stage[1]));
  }
  return { stageDays, totalDays, regrowthDays };
}

/** Split an infobox value that lists several variants on separate lines ("a<br />b"). */
export function splitVariants(value) {
  if (!value) return [];
  return value.split(/<br\s*\/?>/i).map((part) => part.trim()).filter(Boolean);
}

/**
 * Some pages describe more than one way to grow the crop. Grape's infobox says:
 *   growth = 7 days (Summer Seeds)<br />10 days (Grape Starter)
 *   season = {{Season|Summer}} (Summer Seeds and Foraging)<br />{{Season|Fall}} (Grape Starter)
 *   seed   = {{Name|Summer Seeds|Summer}}{{Name|Grape Starter|Fall}}
 * The Stages table only describes ONE of them (Grape's adds up to 10 days).
 * We pick the variant whose growth time matches the table, and only if
 * exactly one does. Otherwise we give up on those fields rather than guess.
 *
 * Returns { growth, season, seed, note } for the chosen variant,
 * { ambiguous: true } if we can't tell, or null if there's only one variant.
 */
export function chooseVariant(fields, stagesTotalDays) {
  const growthVariants = splitVariants(fields.growth);
  if (growthVariants.length <= 1) return null;

  const seasonVariants = splitVariants(fields.season);
  const seedNames = [...(fields.seed ?? '').matchAll(/\{\{\s*Name\s*\|\s*([^|}]+)/g)].map((m) => m[1].trim());
  const count = growthVariants.length;
  if (seasonVariants.length !== count || seedNames.length !== count || stagesTotalDays === null) {
    return { ambiguous: true };
  }

  const matching = growthVariants
    .map((growth, index) => ({ index, days: parseLeadingInteger(growth) }))
    .filter(({ days }) => days === stagesTotalDays);
  if (matching.length !== 1) return { ambiguous: true };

  const { index } = matching[0];
  return {
    growth: growthVariants[index],
    season: seasonVariants[index],
    seed: seedNames[index],
    note: `infobox lists ${count} ways to grow this; used "${seedNames[index]}" because its ${stagesTotalDays} days match the Stages table`,
  };
}

/**
 * Extra text after the number of days, e.g. "8 days (6 when irrigated)" → "(6 when irrigated)".
 * A note that only repeats the seed name (Grape's "(Grape Starter)") is dropped.
 */
export function growthNote(growthValue, seedName) {
  if (!growthValue) return null;
  const note = stripLinks(growthValue).replace(/^\s*\d+\s*days?\s*/i, '').trim();
  if (!note || note === `(${seedName})`) return null;
  return note;
}

/**
 * Extract crop facts from one page.
 * Returns { ok: true, crop, warnings, notes } or { ok: false, reason }.
 *   warnings = values we couldn't read (stored as null)
 *   notes    = choices the extractor made that a person may want to check
 */
export function extractCrop(page) {
  const wikitext = getWikitext(page);
  if (!wikitext) return { ok: false, reason: 'page has no wikitext' };

  const infoboxInner = findTemplateCall(wikitext, 'Infobox');
  if (!infoboxInner) return { ok: false, reason: 'no {{Infobox}} on the page' };

  const fields = parseTemplateParams(infoboxInner).named;
  if (!fields.growth) return { ok: false, reason: 'infobox has no "growth" field, so this is not a crop page' };

  const warnings = [];
  const notes = [];
  const warnIfNull = (value, label) => {
    if (value === null) warnings.push(`could not read ${label}`);
    return value;
  };

  // Read the Stages table first: it decides between variants (see chooseVariant).
  const stages = parseStagesTable(wikitext);

  let growthField = fields.growth;
  let seasonField = fields.season;
  let seedName = fields.seed ? firstTemplateArgument(fields.seed, 'Name') ?? (stripLinks(fields.seed).trim() || null) : null;

  const variant = chooseVariant(fields, stages?.totalDays ?? null);
  if (variant?.ambiguous) {
    warnings.push('infobox lists several ways to grow this and none clearly matches the Stages table');
    growthField = null;
    seasonField = null;
    seedName = null;
  } else if (variant) {
    growthField = variant.growth;
    seasonField = variant.season;
    seedName = variant.seed;
    notes.push(variant.note);
  }

  const name = (fields.eng && stripLinks(fields.eng).trim()) || page.title;
  warnIfNull(seedName, 'seed');
  const growthDays = warnIfNull(parseLeadingInteger(growthField), 'growth days');
  const sellPrice = warnIfNull(parseLeadingInteger(fields.sellprice), 'sell price');

  const { seasons, unknown } = parseSeasons(seasonField);
  if (seasons.length === 0) warnings.push('could not read seasons');
  for (const value of unknown) warnings.push(`unrecognised season "${value}"`);

  // The wiki's own "Trellis Crops" category. Unknown if we have no category data.
  const categoryNames = page.categories?.map((category) => category.title.replace(/^Category:/, ''));
  const isTrellis = categoryNames && categoryNames.length > 0 ? categoryNames.includes('Trellis Crops') : null;

  // Regrowth: the Stages table is the source of truth. No "Regrowth:" cell
  // means the crop doesn't regrow. No table at all means we don't know.
  let regrows = null;
  let regrowthDays = null;
  let stageDays = [];
  if (stages) {
    regrows = stages.regrowthDays !== null;
    regrowthDays = stages.regrowthDays;
    stageDays = stages.stageDays;

    const stageSum = stageDays.reduce((sum, days) => sum + days, 0);
    if (growthDays !== null && stages.totalDays !== null && stages.totalDays !== growthDays) {
      warnings.push(`infobox says ${growthDays} growth days but Stages table total says ${stages.totalDays}`);
    }
    if (stageDays.length > 0 && stages.totalDays !== null && stageSum !== stages.totalDays) {
      warnings.push(`stage days add up to ${stageSum}, not the table total of ${stages.totalDays}`);
    }
  } else {
    warnings.push('no Stages table found, so regrowth is unknown');
  }

  // Cross-check with the opening sentence: "...continues to produce every 4 days..."
  const prose = /produce every (\d+) days?/i.exec(wikitext);
  if (prose && Number(prose[1]) !== regrowthDays) {
    warnings.push(`text says it regrows every ${prose[1]} days but Stages table says ${regrowthDays ?? 'no regrowth'}`);
  }

  return {
    ok: true,
    crop: {
      name,
      seedName,
      growthDays,
      growthNote: growthNote(growthField, seedName),
      seasons,
      sellPrice,
      regrows,
      regrowthDays,
      stageDays,
      isTrellis,
    },
    warnings,
    notes,
  };
}

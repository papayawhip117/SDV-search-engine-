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

/**
 * Extract crop facts from one page.
 * Returns { ok: true, crop, warnings } or { ok: false, reason }.
 */
export function extractCrop(page) {
  const wikitext = getWikitext(page);
  if (!wikitext) return { ok: false, reason: 'page has no wikitext' };

  const infoboxInner = findTemplateCall(wikitext, 'Infobox');
  if (!infoboxInner) return { ok: false, reason: 'no {{Infobox}} on the page' };

  const fields = parseTemplateParams(infoboxInner).named;
  if (!fields.growth) return { ok: false, reason: 'infobox has no "growth" field, so this is not a crop page' };

  const warnings = [];
  const warnIfNull = (value, label) => {
    if (value === null) warnings.push(`could not read ${label}`);
    return value;
  };

  const name = (fields.eng && stripLinks(fields.eng).trim()) || page.title;
  const seedName = warnIfNull(
    fields.seed ? firstTemplateArgument(fields.seed, 'Name') ?? (stripLinks(fields.seed).trim() || null) : null,
    'seed',
  );
  const growthDays = warnIfNull(parseLeadingInteger(fields.growth), 'growth days');
  const sellPrice = warnIfNull(parseLeadingInteger(fields.sellprice), 'sell price');

  const { seasons, unknown } = parseSeasons(fields.season);
  if (seasons.length === 0) warnings.push('could not read seasons');
  for (const value of unknown) warnings.push(`unrecognised season "${value}"`);

  // Regrowth: the Stages table is the source of truth. No "Regrowth:" cell
  // means the crop doesn't regrow. No table at all means we don't know.
  const stages = parseStagesTable(wikitext);
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
    crop: { name, seedName, growthDays, seasons, sellPrice, regrows, regrowthDays, stageDays },
    warnings,
  };
}

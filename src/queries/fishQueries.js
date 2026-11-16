// Fish searches, used by the command line, the website's Today page and the AI assistant.
//
//   getFish(db, { season: 'Summer', weather: 'Rain', area: 'Ocean' })

import { SEASONS, AREA_CATEGORIES } from '../extract/fishExtractor.js';

export const WEATHERS = ['Sun', 'Rain'];
export const AREAS = Object.values(AREA_CATEGORIES);

/** Match what the user typed against a fixed list, ignoring letter case. */
function pick(value, allowed, label) {
  if (value === undefined || value === null || value === '') return null;
  const match = allowed.find((option) => option.toLowerCase() === String(value).toLowerCase());
  if (!match) throw new Error(`Unknown ${label} "${value}". Choose one of: ${allowed.join(', ')}`);
  return match;
}

/**
 * Fish you can catch, highest sell price first, each with its wiki source.
 *
 * @param options.season   'Spring' | 'Summer' | 'Fall' | 'Winter'
 * @param options.weather  'Sun' | 'Rain': fish whose weather is that or 'Any'
 * @param options.area     'Ocean' | 'River' | 'Lake' | ... (see AREAS)
 * @param options.includeLegendary  false by default: legendary fish can be caught once
 *
 * Returns { fish, unclearWeather }. Fish whose weather is more than a single
 * word ("Sun; Any during Trout Derby") are left out of a weather search and
 * listed in unclearWeather instead, so the user can check them.
 */
export function getFish(db, { season, weather, area, includeLegendary = false } = {}) {
  const seasonName = pick(season, SEASONS, 'season');
  const weatherName = pick(weather, WEATHERS, 'weather');
  const areaName = pick(area, AREAS, 'area');

  const conditions = [];
  const params = {};
  if (seasonName) {
    conditions.push(
      'EXISTS (SELECT 1 FROM fish_seasons fs JOIN seasons s ON s.id = fs.season_id WHERE fs.fish_item_id = f.item_id AND s.name = :season)',
    );
    params.season = seasonName;
  }
  if (areaName) {
    conditions.push('EXISTS (SELECT 1 FROM fish_areas fa WHERE fa.fish_item_id = f.item_id AND fa.area = :area)');
    params.area = areaName;
  }
  if (!includeLegendary) conditions.push('f.is_legendary = 0');

  const rows = db
    .prepare(
      `SELECT
         i.name             AS name,
         i.base_sell_price  AS sellPrice,
         f.catch_method     AS catchMethod,
         f.is_legendary     AS isLegendary,
         f.location_note    AS location,
         f.time_note        AS time,
         f.weather          AS weather,
         f.weather_note     AS weatherNote,
         f.season_note      AS seasonNote,
         f.difficulty       AS difficulty,
         sp.page_title      AS sourceTitle,
         sp.page_url        AS sourceUrl,
         sp.revision_id     AS sourceRevision
       FROM fish f
       JOIN items i         ON i.id = f.item_id
       JOIN source_pages sp ON sp.id = f.source_page_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY i.base_sell_price IS NULL, i.base_sell_price DESC, i.name`,
    )
    .all(params)
    .map((row) => ({ ...row, isLegendary: row.isLegendary === 1 }));

  if (!weatherName) return { fish: rows, unclearWeather: [] };

  // Crab pots catch in any weather, so they have no weather on the wiki.
  const fits = (row) => row.catchMethod === 'crab pot' || row.weather === 'Any' || row.weather === weatherName;
  return {
    fish: rows.filter((row) => row.weather !== null || row.catchMethod === 'crab pot').filter(fits),
    unclearWeather: rows.filter((row) => row.weather === null && row.catchMethod !== 'crab pot'),
  };
}

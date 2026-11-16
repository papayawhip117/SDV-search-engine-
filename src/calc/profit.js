// Crop profit calculations. These are done in our own code, never by the
// AI, so every number can be tested and explained.
//
// ASSUMPTIONS (also printed by `npm run profit`):
//   - every season has 28 days
//   - the crop is planted on `plantDay` (default 1) of the chosen season
//   - a crop planted on day P with G growth days is ready on day P + G
//   - one-time crops are replanted on the day they're harvested, and a new
//     seed is only bought if that planting will be ready in time
//   - regrowing crops are planted once and harvested every R days after the first harvest
//   - a crop that grows in the next season too (Corn: Summer → Fall) keeps going
//   - one item per harvest, base (normal) quality, no fertilizer, no profession bonuses
//   - profit per day = profit ÷ days from planting to the end of the last growing season

export const SEASON_ORDER = ['Spring', 'Summer', 'Fall', 'Winter'];
export const DAYS_PER_SEASON = 28;

/**
 * Days between planting and the end of the crop's growing period.
 *   Parsnip (Spring only), planted Spring 1  → 28 - 1 = 27
 *   Corn (Summer + Fall), planted Summer 1   → 56 - 1 = 55
 * Returns 0 if the crop doesn't grow in that season.
 */
export function daysAvailable(cropSeasons, startSeason, plantDay) {
  const startIndex = SEASON_ORDER.indexOf(startSeason);
  let seasonsInARow = 0;
  while (
    startIndex + seasonsInARow < SEASON_ORDER.length &&
    cropSeasons.includes(SEASON_ORDER[startIndex + seasonsInARow])
  ) {
    seasonsInARow++;
  }
  if (seasonsInARow === 0) return 0;
  return seasonsInARow * DAYS_PER_SEASON - plantDay;
}

/**
 * How many times the crop can be harvested, and how many seeds that takes.
 *   one-time crop:  floor(days / growth) harvests, one seed each
 *   regrowing crop: 1 + floor((days - growth) / regrowth) harvests, one seed in total
 */
export function countHarvests({ growthDays, regrows, regrowthDays }, days) {
  if (growthDays > days) return { harvests: 0, seedsNeeded: 0 };
  if (regrows) {
    return { harvests: 1 + Math.floor((days - growthDays) / regrowthDays), seedsNeeded: 1 };
  }
  const harvests = Math.floor(days / growthDays);
  return { harvests, seedsNeeded: harvests };
}

/**
 * Profit for one plant of a crop.
 *
 * @param crop       { growthDays, regrows, regrowthDays, sellPrice, seasons }
 * @param seedPrice  the price of one seed, or null if it can't be bought
 * @param options    { season, plantDay = 1 }
 *
 * Returns { ok: true, ...numbers } or { ok: false, reason } when data is
 * missing. A missing value is never replaced by a guess.
 */
export function calculateProfit(crop, seedPrice, { season, plantDay = 1 }) {
  if (!SEASON_ORDER.includes(season)) throw new Error(`Unknown season "${season}"`);
  if (!Number.isInteger(plantDay) || plantDay < 1 || plantDay > DAYS_PER_SEASON) {
    throw new Error(`Planting day must be a whole number from 1 to ${DAYS_PER_SEASON}`);
  }

  const missing = [];
  if (crop.growthDays === null) missing.push('growth days');
  if (crop.sellPrice === null) missing.push('sell price');
  if (crop.regrows === null) missing.push('whether it regrows');
  if (crop.regrows && crop.regrowthDays === null) missing.push('regrowth days');
  if (seedPrice === null) missing.push('a shop price for its seed');
  if (missing.length) return { ok: false, reason: `missing ${missing.join(', ')}` };

  const days = daysAvailable(crop.seasons, season, plantDay);
  if (days === 0) return { ok: false, reason: `does not grow in ${season}` };

  const { harvests, seedsNeeded } = countHarvests(crop, days);
  if (harvests === 0) return { ok: false, reason: `needs ${crop.growthDays} days but only ${days} are left` };

  const revenue = harvests * crop.sellPrice;
  const seedCost = seedsNeeded * seedPrice;
  const profit = revenue - seedCost;

  return {
    ok: true,
    daysAvailable: days,
    harvests,
    seedsNeeded,
    revenue,
    seedCost,
    profit,
    profitPerDay: profit / days,
  };
}

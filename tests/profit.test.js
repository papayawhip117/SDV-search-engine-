// Profit calculations, checked against numbers worked out by hand.
// Crop facts below are the real values from the wiki pages.

import { describe, expect, it } from 'vitest';
import { calculateProfit, countHarvests, daysAvailable, rankCropsByProfit } from '../src/calc/profit.js';

const parsnip = { growthDays: 4, regrows: false, regrowthDays: null, sellPrice: 35, seasons: ['Spring'] };
const strawberry = { growthDays: 8, regrows: true, regrowthDays: 4, sellPrice: 120, seasons: ['Spring'] };
const corn = { growthDays: 14, regrows: true, regrowthDays: 4, sellPrice: 50, seasons: ['Summer', 'Fall'] };

describe('daysAvailable', () => {
  it('counts from the planting day to the end of the season', () => {
    expect(daysAvailable(['Spring'], 'Spring', 1)).toBe(27);
    expect(daysAvailable(['Spring'], 'Spring', 28)).toBe(0);
  });

  it('continues into the next season when the crop grows there too', () => {
    expect(daysAvailable(['Summer', 'Fall'], 'Summer', 1)).toBe(55);
    expect(daysAvailable(['Summer', 'Fall'], 'Fall', 1)).toBe(27); // Winter isn't one of Corn's seasons
  });

  it('is 0 when the crop does not grow in that season', () => {
    expect(daysAvailable(['Spring'], 'Summer', 1)).toBe(0);
  });
});

describe('countHarvests', () => {
  it('one-time crop: replanted after each harvest', () => {
    // Parsnip planted Spring 1: ready on days 5, 9, 13, 17, 21, 25 → 6 harvests (day 29 is too late)
    expect(countHarvests(parsnip, 27)).toEqual({ harvests: 6, seedsNeeded: 6 });
  });

  it('regrowing crop: planted once', () => {
    // Strawberry planted Spring 1: ready day 9, then 13, 17, 21, 25 → 5 harvests
    expect(countHarvests(strawberry, 27)).toEqual({ harvests: 5, seedsNeeded: 1 });
  });

  it('nothing when there is not enough time', () => {
    expect(countHarvests(strawberry, 7)).toEqual({ harvests: 0, seedsNeeded: 0 });
  });
});

describe('calculateProfit', () => {
  it('Parsnip, Spring 1, seeds at 20g', () => {
    // 6 × 35 = 210 revenue, 6 × 20 = 120 seeds, 90 profit over 27 days
    const result = calculateProfit(parsnip, 20, { season: 'Spring' });
    expect(result).toMatchObject({ ok: true, harvests: 6, revenue: 210, seedCost: 120, profit: 90 });
    expect(result.profitPerDay).toBeCloseTo(90 / 27);
  });

  it('Corn, Summer 1, keeps producing through Fall', () => {
    // ready day 15, then every 4 days up to day 55 → 11 harvests; 550 - 150 = 400
    expect(calculateProfit(corn, 150, { season: 'Summer' })).toMatchObject({ ok: true, harvests: 11, profit: 400 });
  });

  it('planting later in the season means fewer harvests', () => {
    // Strawberry planted Spring 13 (Egg Festival): 15 days left → ready day 21, then 25 → 2 harvests
    expect(calculateProfit(strawberry, 100, { season: 'Spring', plantDay: 13 })).toMatchObject({ harvests: 2, profit: 140 });
  });

  it('refuses to calculate with missing data, and says what is missing', () => {
    expect(calculateProfit(parsnip, null, { season: 'Spring' })).toEqual({
      ok: false,
      reason: 'missing a shop price for its seed',
    });
    expect(calculateProfit({ ...parsnip, sellPrice: null }, 20, { season: 'Spring' }).reason).toMatch(/sell price/);
  });

  it('explains when a crop cannot be grown in time or in that season', () => {
    expect(calculateProfit(strawberry, 100, { season: 'Spring', plantDay: 25 }).reason).toMatch(/needs 8 days but only 3/);
    expect(calculateProfit(parsnip, 20, { season: 'Fall' }).reason).toMatch(/does not grow in Fall/);
  });

  it('rejects impossible planting days', () => {
    expect(() => calculateProfit(parsnip, 20, { season: 'Spring', plantDay: 29 })).toThrow(/1 to 28/);
  });
});

describe('rankCropsByProfit', () => {
  const crop = (name, extra) => ({
    name, growthDays: 4, regrows: false, regrowthDays: null, sellPrice: 35, seasons: ['Spring'],
    seedPrice: 20, seedShop: "Pierre's General Store", seedPriceNote: null, growthNote: null, ...extra,
  });

  it('puts the best profit per day first and lists what it could not work out', () => {
    const { ranked, notCalculated, footnotes } = rankCropsByProfit(
      [crop('Parsnip'), crop('Strawberry', { growthDays: 8, regrows: true, regrowthDays: 4, sellPrice: 120, seedPrice: 100, seedShop: 'Egg Festival' }), crop('Mystery', { seedPrice: null })],
      { season: 'Spring', plantDay: 1 },
    );
    expect(ranked.map((row) => row.crop.name)).toEqual(['Strawberry', 'Parsnip']);
    expect(notCalculated).toEqual([{ crop: expect.objectContaining({ name: 'Mystery' }), reason: 'missing a shop price for its seed' }]);
    expect(footnotes).toEqual(['Strawberry: its seed is only sold at Egg Festival, so check you can buy it by the planting day.']);
  });
});

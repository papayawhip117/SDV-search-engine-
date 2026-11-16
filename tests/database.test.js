// Tests the whole pipeline after download: real pages → extractor →
// database → search. Uses an in-memory database, so no files are created.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { getCropsBySeason } from '../src/queries/cropQueries.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/crop-pages.json', import.meta.url)));
const RETRIEVED_AT = '2026-11-16T00:18:00.000Z';

let db;
let report;

beforeEach(() => {
  db = openDatabase(':memory:');
  report = buildFromRawData(db, { retrievedAt: RETRIEVED_AT, pages: fixture.query.pages });
});

describe('building the database', () => {
  it('saves all three crops without warnings', () => {
    expect(report.saved).toEqual(['Parsnip', 'Strawberry', 'Corn']);
    expect(report.skipped).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('links each crop to its seed, which has no price yet', () => {
    const row = db
      .prepare(
        `SELECT seed.name AS seedName, seed.item_type AS type, seed.base_sell_price AS price
         FROM crops c JOIN items i ON i.id = c.item_id JOIN items seed ON seed.id = c.seed_item_id
         WHERE i.name = 'Parsnip'`,
      )
      .get();
    expect(row).toEqual({ seedName: 'Parsnip Seeds', type: 'seed', price: null });
  });

  it('stores growth stages in order', () => {
    const stages = db
      .prepare(
        `SELECT days FROM crop_growth_stages s JOIN items i ON i.id = s.crop_item_id
         WHERE i.name = 'Corn' ORDER BY stage_number`,
      )
      .all()
      .map((row) => row.days);
    expect(stages).toEqual([2, 3, 3, 3, 3]);
  });

  it('can be run twice without creating duplicates', () => {
    buildFromRawData(db, { retrievedAt: '2026-11-17T00:00:00.000Z', pages: fixture.query.pages });
    expect(db.prepare('SELECT COUNT(*) AS n FROM crops').get().n).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_pages').get().n).toBe(3);
    // the same revision downloaded again just gets the newer download date
    expect(db.prepare("SELECT retrieved_at FROM source_pages WHERE page_title = 'Corn'").get().retrieved_at)
      .toBe('2026-11-17T00:00:00.000Z');
  });
});

describe('getCropsBySeason', () => {
  it('returns Summer crops with full source attribution', () => {
    expect(getCropsBySeason(db, 'Summer')).toEqual([
      {
        name: 'Corn',
        sellPrice: 50,
        growthDays: 14,
        regrows: true,
        regrowthDays: 4,
        seedName: 'Corn Seeds',
        sourceTitle: 'Corn',
        sourceUrl: 'https://stardewvalleywiki.com/Corn',
        sourceRevision: 192088,
        retrievedAt: RETRIEVED_AT,
      },
    ]);
  });

  it('sorts Spring crops by sell price, highest first', () => {
    expect(getCropsBySeason(db, 'Spring').map((crop) => [crop.name, crop.sellPrice])).toEqual([
      ['Strawberry', 120],
      ['Parsnip', 35],
    ]);
  });

  it('finds multi-season crops in every season they grow in', () => {
    expect(getCropsBySeason(db, 'fall').map((crop) => crop.name)).toEqual(['Corn']);
  });

  it('returns nothing for Winter instead of making something up', () => {
    expect(getCropsBySeason(db, 'Winter')).toEqual([]);
  });

  it('refuses unknown sort columns', () => {
    expect(() => getCropsBySeason(db, 'Spring', { sortBy: 'price; DROP TABLE crops' })).toThrow(/Can't sort/);
  });
});

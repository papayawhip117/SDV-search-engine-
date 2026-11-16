// Real fish pages → database → fish queries and search. In-memory database.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { getFish } from '../src/queries/fishQueries.js';
import { getItemDetails, searchItems } from '../src/queries/search.js';
import { parseFishArguments } from '../src/cli/fish.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/fish-pages.json', import.meta.url)));
const names = (list) => list.map((fish) => fish.name);

let db;
let report;

beforeEach(() => {
  db = openDatabase(':memory:');
  report = buildFromRawData(db, { retrievedAt: '2026-11-16T04:47:00.000Z', pages: fixture.query.pages });
});

describe('building fish into the database', () => {
  it('saves all ten fish without warnings', () => {
    expect(report.savedFish).toHaveLength(10);
    expect(report.saved).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('can be run twice without duplicates', () => {
    buildFromRawData(db, { retrievedAt: '2026-11-17T00:00:00.000Z', pages: fixture.query.pages });
    expect(db.prepare('SELECT COUNT(*) AS n FROM fish').get().n).toBe(10);
    expect(db.prepare('SELECT COUNT(*) AS n FROM fish_seasons WHERE fish_item_id = (SELECT id FROM items WHERE name = ?)').get('Tuna').n).toBe(2);
  });
});

describe('getFish', () => {
  it('lists a season by sell price, without legendary fish unless asked', () => {
    const { fish } = getFish(db, { season: 'Summer' });
    expect(names(fish)).toEqual(['Lava Eel', 'Stingray', 'Crab', 'Tuna', 'Rainbow Trout']);
    expect(fish[0].sourceUrl).toBe('https://stardewvalleywiki.com/Lava_Eel');
    expect(names(getFish(db, { season: 'Spring', includeLegendary: true }).fish)).toContain('Legend');
  });

  it('filters by weather: "Any" fish and crab pots fit, unclear rules are listed apart', () => {
    const { fish, unclearWeather } = getFish(db, { season: 'Summer', weather: 'rain' });
    expect(names(fish)).toEqual(['Lava Eel', 'Stingray', 'Crab', 'Tuna']);
    expect(names(unclearWeather)).toEqual(['Rainbow Trout']);
  });

  it('filters by area', () => {
    expect(names(getFish(db, { area: 'ocean' }).fish)).toEqual(['Crab', 'Tuna', 'Albacore']);
  });

  it('rejects unknown filter values', () => {
    expect(() => getFish(db, { weather: 'snow' })).toThrow(/Unknown weather/);
    expect(() => getFish(db, { area: 'Moon' })).toThrow(/Unknown area/);
  });
});

describe('fish in the general search and item details', () => {
  it('finds fish by type and season', () => {
    const { results } = searchItems(db, { type: 'fish', season: 'Winter', sortBy: 'sell' });
    expect(results.map((r) => r.name)).toEqual(['Lava Eel', 'Stingray', 'Crab', 'Midnight Squid', 'Tuna', 'Albacore']);
  });

  it('shows fish details with their source', () => {
    const item = getItemDetails(db, 'walleye');
    expect(item.type).toBe('fish');
    expect(item.seasons).toEqual(['Fall']);
    expect(item.fish).toMatchObject({ weather: 'Rain', seasonNote: 'Fall • Winter with Rain Totem', areas: ['Lake', 'Pond', 'River'] });
    expect(item.source.url).toBe('https://stardewvalleywiki.com/Walleye');
    expect(item.summary).toMatch(/^The Walleye is a fish/);
  });
});

describe('parseFishArguments', () => {
  it('reads a season and options', () => {
    expect(parseFishArguments(['Fall', '--weather', 'rain', '--area', 'Secret Woods', '--legendary'])).toEqual({
      season: 'Fall',
      weather: 'rain',
      area: 'Secret Woods',
      includeLegendary: true,
    });
    expect(() => parseFishArguments(['Fall', 'Winter'])).toThrow(/Unexpected/);
    expect(() => parseFishArguments(['--weather'])).toThrow(/needs a value/);
  });
});

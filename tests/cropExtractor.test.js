// Runs the crop extractor on three REAL wiki pages (tests/fixtures/crop-pages.json).
// Each expected value below was read by hand from that page, so a passing
// test means the extractor reads the wiki the way a person would.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractCrop, parseSeasons, parseStagesTable } from '../src/extract/cropExtractor.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/crop-pages.json', import.meta.url)));
const pageNamed = (title) => fixture.query.pages.find((page) => page.title === title);

describe('extractCrop on real wiki pages', () => {
  it('Parsnip: simple single-harvest crop', () => {
    const result = extractCrop(pageNamed('Parsnip'));
    expect(result.ok).toBe(true);
    expect(result.crop).toEqual({
      name: 'Parsnip',
      seedName: 'Parsnip Seeds',
      growthDays: 4,
      seasons: ['Spring'],
      sellPrice: 35,
      regrows: false,
      regrowthDays: null,
      stageDays: [1, 1, 1, 1],
      growthNote: null,
      isTrellis: null, // this fixture has no category data
    });
    expect(result.warnings).toEqual([]);
  });

  it('Strawberry: regrows every 4 days', () => {
    const result = extractCrop(pageNamed('Strawberry'));
    expect(result.ok).toBe(true);
    expect(result.crop).toEqual({
      name: 'Strawberry',
      seedName: 'Strawberry Seeds',
      growthDays: 8,
      seasons: ['Spring'],
      sellPrice: 120,
      regrows: true,
      regrowthDays: 4,
      stageDays: [1, 1, 2, 2, 2],
      growthNote: null,
      isTrellis: null,
    });
    expect(result.warnings).toEqual([]);
  });

  it('Corn: two seasons written with {{Season}} templates, and regrowth', () => {
    const result = extractCrop(pageNamed('Corn'));
    expect(result.ok).toBe(true);
    expect(result.crop).toEqual({
      name: 'Corn',
      seedName: 'Corn Seeds',
      growthDays: 14,
      seasons: ['Summer', 'Fall'],
      sellPrice: 50,
      regrows: true,
      regrowthDays: 4,
      stageDays: [2, 3, 3, 3, 3],
      growthNote: null,
      isTrellis: null,
    });
    expect(result.warnings).toEqual([]);
  });
});

describe('extractCrop on pages that are not crops', () => {
  const fakePage = (content) => ({ title: 'Test', revisions: [{ slots: { main: { content } } }] });

  it('skips a page without an infobox', () => {
    const result = extractCrop(fakePage('The Crops page is an overview.'));
    expect(result).toEqual({ ok: false, reason: 'no {{Infobox}} on the page' });
  });

  it('skips an infobox without a growth time (for example an artisan good)', () => {
    const result = extractCrop(fakePage('{{Infobox\n|eng = Wine\n|sellprice = 400\n}}'));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/growth/);
  });

  it('stores missing values as null with a warning instead of guessing', () => {
    const result = extractCrop(fakePage('{{Infobox\n|eng = Mystery\n|growth = 6 days\n|season = Spring\n}}'));
    expect(result.ok).toBe(true);
    expect(result.crop.sellPrice).toBeNull();
    expect(result.crop.regrows).toBeNull(); // no Stages table, so we don't know
    expect(result.warnings).toContain('could not read sell price');
  });
});

describe('parseSeasons', () => {
  it('reads plain text and template forms', () => {
    expect(parseSeasons('Spring').seasons).toEqual(['Spring']);
    expect(parseSeasons('[[Summer]]').seasons).toEqual(['Summer']);
    expect(parseSeasons('{{Season|Summer}} • {{Season|Fall}}').seasons).toEqual(['Summer', 'Fall']);
  });

  it('reports values that are not seasons instead of dropping them silently', () => {
    expect(parseSeasons('Spring • Ginger Island')).toEqual({ seasons: ['Spring'], unknown: ['Ginger Island'] });
  });
});

describe('parseStagesTable', () => {
  it('finds the stage days, total and regrowth in the Corn table', () => {
    const corn = pageNamed('Corn').revisions[0].slots.main.content;
    expect(parseStagesTable(corn)).toEqual({ stageDays: [2, 3, 3, 3, 3], totalDays: 14, regrowthDays: 4 });
  });
});

// Four real pages that broke the simple assumptions (tests/fixtures/edge-case-pages.json).
describe('extractCrop on tricky real pages', () => {
  const edgeCases = JSON.parse(readFileSync(new URL('./fixtures/edge-case-pages.json', import.meta.url)));
  const edgePage = (title) => edgeCases.query.pages.find((page) => page.title === title);

  it('Grape: two ways to grow it, so it picks the one the Stages table describes', () => {
    // Infobox: "7 days (Summer Seeds)<br />10 days (Grape Starter)". The Stages table adds up to 10.
    const result = extractCrop(edgePage('Grape'));
    expect(result.crop).toMatchObject({
      seedName: 'Grape Starter',
      growthDays: 10,
      growthNote: null,
      seasons: ['Fall'],
      sellPrice: 80,
      regrows: true,
      regrowthDays: 3,
      isTrellis: true,
    });
    expect(result.warnings).toEqual([]);
    expect(result.notes[0]).toMatch(/Grape Starter/);
  });

  it('Unmilled Rice: keeps the irrigation note instead of dropping it', () => {
    // Infobox: "8 days (6 when irrigated)"
    const result = extractCrop(edgePage('Unmilled Rice'));
    expect(result.crop).toMatchObject({ seedName: 'Rice Shoot', growthDays: 8, growthNote: '(6 when irrigated)', seasons: ['Spring'] });
    expect(result.warnings).toEqual([]);
  });

  it('Coffee Bean: the crop is its own seed', () => {
    const result = extractCrop(edgePage('Coffee Bean'));
    expect(result.crop).toMatchObject({ name: 'Coffee Bean', seedName: 'Coffee Bean', seasons: ['Spring', 'Summer'], regrowthDays: 2 });
  });

  it('Ancient Fruit: three seasons', () => {
    const result = extractCrop(edgePage('Ancient Fruit'));
    expect(result.crop).toMatchObject({ seasons: ['Spring', 'Summer', 'Fall'], growthDays: 28, regrowthDays: 7, isTrellis: false });
  });

  it('gives up on the variant fields when no variant matches the Stages table', () => {
    const grape = edgePage('Grape');
    const content = grape.revisions[0].slots.main.content.replace('Total: 10 Days', 'Total: 9 Days');
    const result = extractCrop({ ...grape, revisions: [{ slots: { main: { content } } }] });
    expect(result.crop.growthDays).toBeNull();
    expect(result.crop.seedName).toBeNull();
    expect(result.crop.seasons).toEqual([]);
    expect(result.warnings[0]).toMatch(/several ways to grow/);
  });
});

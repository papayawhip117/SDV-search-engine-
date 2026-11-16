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

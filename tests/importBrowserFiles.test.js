import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { browserUrlForCategory, combineSavedResponses } from '../src/collect/importBrowserFiles.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/crop-pages.json', import.meta.url)));
const [parsnip, strawberry, corn] = fixture.query.pages;
const withCategories = (page, ...names) => ({ ...page, categories: names.map((n) => ({ ns: 14, title: `Category:${n}` })) });

describe('browserUrlForCategory', () => {
  it('asks for every page in the category, with content, in one request', () => {
    const url = new URL(browserUrlForCategory('Summer crops'));
    expect(url.searchParams.get('generator')).toBe('categorymembers');
    expect(url.searchParams.get('gcmtitle')).toBe('Category:Summer crops');
    expect(url.searchParams.get('rvprop')).toBe('ids|timestamp|content');
    expect(url.searchParams.has('maxlag')).toBe(false);
  });
});

describe('combineSavedResponses', () => {
  const spring = { query: { pages: [withCategories(parsnip, 'Spring crops', 'Vegetables'), withCategories(strawberry, 'Spring crops')] } };
  const summer = { query: { pages: [withCategories(corn, 'Summer crops', 'Fall crops')] } };
  const fall = { query: { pages: [withCategories(corn, 'Summer crops', 'Fall crops')] } };

  it('merges files, removes duplicates and keeps categories', () => {
    const { rawData, problems } = combineSavedResponses([
      { name: 'spring.json', json: spring, savedAt: '2026-11-16T02:00:00.000Z' },
      { name: 'summer.json', json: summer, savedAt: '2026-11-16T01:59:00.000Z' },
      { name: 'fall.json', json: fall, savedAt: '2026-11-16T02:01:00.000Z' },
    ]);
    expect(problems).toEqual([]);
    expect(rawData.pages.map((p) => [p.title, p.foundInCategory])).toEqual([
      ['Parsnip', 'Spring crops'],
      ['Strawberry', 'Spring crops'],
      ['Corn', 'Summer crops'],
    ]);
    expect(rawData.retrievedAt).toBe('2026-11-16T01:59:00.000Z'); // the oldest file
  });

  it('warns about incomplete or wrong files instead of silently using them', () => {
    const { problems } = combineSavedResponses([
      { name: 'partial.json', json: { ...spring, continue: { gcmcontinue: 'x' } } },
      { name: 'wrong.json', json: { query: { general: {} } } },
      { name: 'error.json', json: { error: { code: 'badvalue', info: 'Bad value' } } },
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/partial\.json.*continue/);
    expect(problems[1]).toMatch(/wrong\.json/);
    expect(problems[2]).toMatch(/Bad value/);
  });
});

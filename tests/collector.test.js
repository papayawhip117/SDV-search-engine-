// Tests for the wiki API client and the crop collector.
// None of these tests use the internet: where a test needs the wiki to
// "answer", we replace the built-in fetch() with a fake one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApiUrl, pageUrl } from '../src/wiki/apiClient.js';
import { listCategoryMembers, mergeCategoryLists } from '../src/collect/collectCrops.js';

describe('buildApiUrl', () => {
  it('adds the polite defaults to every request', () => {
    const url = buildApiUrl({ action: 'query', list: 'search', srsearch: 'Parsnip' });
    expect(url.origin + url.pathname).toBe('https://stardewvalleywiki.com/mediawiki/api.php');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('formatversion')).toBe('2');
    expect(url.searchParams.get('maxlag')).toBe('5');
    expect(url.searchParams.get('srsearch')).toBe('Parsnip');
  });
});

describe('pageUrl', () => {
  it('turns a page title into its wiki address', () => {
    expect(pageUrl('Parsnip')).toBe('https://stardewvalleywiki.com/Parsnip');
    expect(pageUrl('Parsnip Seeds')).toBe('https://stardewvalleywiki.com/Parsnip_Seeds');
    expect(pageUrl("Pierre's General Store")).toBe("https://stardewvalleywiki.com/Pierre's_General_Store");
  });
});

describe('mergeCategoryLists', () => {
  it('removes pages that appear in more than one category', () => {
    const merged = mergeCategoryLists({
      'Summer crops': [{ pageid: 1857, title: 'Corn' }, { pageid: 2, title: 'Melon' }],
      'Fall crops': [{ pageid: 1857, title: 'Corn' }, { pageid: 3, title: 'Pumpkin' }],
    });
    expect(merged.map((page) => page.title)).toEqual(['Corn', 'Melon', 'Pumpkin']);
    // Corn keeps the first category it was found in
    expect(merged[0].foundInCategory).toBe('Summer crops');
  });
});

describe('listCategoryMembers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows "continue" until every page of results is read', async () => {
    const fakeResponses = [
      { continue: { cmcontinue: 'page|2', continue: '-||' }, query: { categorymembers: [{ pageid: 1, title: 'Parsnip' }] } },
      { query: { categorymembers: [{ pageid: 2, title: 'Potato' }] } },
    ];
    const fakeFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => fakeResponses.shift() }));
    vi.stubGlobal('fetch', fakeFetch);

    const members = await listCategoryMembers('Spring crops');

    expect(members.map((m) => m.title)).toEqual(['Parsnip', 'Potato']);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    // The second request must send back the continue values
    const secondUrl = fakeFetch.mock.calls[1][0];
    expect(secondUrl.searchParams.get('cmcontinue')).toBe('page|2');
    // ...and every request identifies us
    expect(fakeFetch.mock.calls[0][1].headers['User-Agent']).toMatch(/^SDVSearchEngine/);
  });
});

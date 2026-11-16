// Runs the fish extractor on REAL fish pages (tests/fixtures/fish-pages.json).
// Expected values were read by hand from each page's {{Infobox fish}} and categories.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractFish, isFishPage, parsePlainSeasonList, parseSize, plainValue } from '../src/extract/fishExtractor.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/fish-pages.json', import.meta.url)));
const fishPage = (title) => fixture.query.pages.find((page) => page.title === title);

describe('small helpers', () => {
  it('turns infobox values into one readable line', () => {
    expect(plainValue('6am – 11am<br />6pm – 2am')).toBe('6am – 11am; 6pm – 2am');
    expect(plainValue('<ul><li>Sun</li><li>Any during [[Trout Derby]]</li></ul>')).toBe('Sun; Any during Trout Derby');
    expect(plainValue('12pm – 2am <!--a hidden editor comment-->')).toBe('12pm – 2am');
    expect(plainValue('{{Season|Summer}} • {{Season|Fall}} •<br />{{Season|Winter}} with [[Rain Totem]]'))
      .toBe('Summer • Fall • Winter with Rain Totem');
    expect(plainValue('')).toBeNull();
  });

  it('only accepts a season value that is a plain list', () => {
    expect(parsePlainSeasonList('{{Season|Summer}} • {{Season|Winter}}')).toEqual(['Summer', 'Winter']);
    expect(parsePlainSeasonList('{{Season|fall}} • {{Season|spring}}')).toEqual(['Spring', 'Fall']);
    expect(parsePlainSeasonList('All')).toEqual(['Spring', 'Summer', 'Fall', 'Winter']);
    expect(parsePlainSeasonList('Winter')).toEqual(['Winter']);
    expect(parsePlainSeasonList('{{Season|Fall}} • {{Season|Winter}} with [[Rain Totem]]')).toBeNull();
  });

  it('reads sizes', () => {
    expect(parseSize('12-61')).toEqual({ min: 12, max: 61 });
    expect(parseSize('big')).toBeNull();
  });
});

describe('extractFish on real pages', () => {
  it('recognises fish pages', () => {
    expect(fixture.query.pages.every(isFishPage)).toBe(true);
  });

  it('reads Tuna, keeping the Ginger Island condition as a note', () => {
    const { fish, warnings, notes } = extractFish(fishPage('Tuna'));
    expect(fish).toEqual({
      name: 'Tuna',
      sellPrice: 100,
      seasons: ['Summer', 'Winter'],
      seasonNote: 'Summer • Winter; Ginger Island (except Island North): All',
      areas: ['Ocean', 'Ginger Island'],
      locationNote: 'Ocean • Ginger Island',
      timeNote: '6am – 7pm',
      weather: 'Any',
      weatherNote: null,
      difficulty: 70,
      behavior: 'Smooth',
      sizeMin: 12,
      sizeMax: 61,
      fishingLevel: null,
      fishingLevelNote: null,
      isLegendary: false,
      catchMethod: 'fishing rod',
    });
    expect(warnings).toEqual([]);
    expect(notes).toHaveLength(1);
  });

  it('does not count a Rain Totem season as a normal season (Walleye)', () => {
    const { fish } = extractFish(fishPage('Walleye'));
    expect(fish.seasons).toEqual(['Fall']);
    expect(fish.seasonNote).toBe('Fall • Winter with Rain Totem');
    expect(fish.weather).toBe('Rain');
  });

  it('keeps the Catfish season rules readable', () => {
    const { fish } = extractFish(fishPage('Catfish'));
    expect(fish.seasons).toEqual(['Spring', 'Fall']);
    expect(fish.seasonNote).toBe(
      "Spring • Fall; Secret Woods/Witch's Swamp: Spring • Summer • Fall; Only with Rain Totem: Winter",
    );
  });

  it('reads two time windows (Albacore)', () => {
    expect(extractFish(fishPage('Albacore')).fish.timeNote).toBe('6am – 11am; 6pm – 2am');
  });

  it('leaves weather unknown when it is more than one word (Rainbow Trout)', () => {
    const { fish } = extractFish(fishPage('Rainbow Trout'));
    expect(fish.weather).toBeNull();
    expect(fish.weatherNote).toBe('Sun; Any during Trout Derby');
  });

  it('reads a crab pot fish, which has no time, weather or difficulty (Crab)', () => {
    const { fish, warnings } = extractFish(fishPage('Crab'));
    expect(fish.catchMethod).toBe('crab pot');
    expect(fish.seasons).toEqual(['Spring', 'Summer', 'Fall', 'Winter']);
    expect(fish.locationNote).toBe('Crab Pot: Saltwater; Monster Drops: Rock Crab • Lava Crab; Turtle');
    expect([fish.timeNote, fish.weather, fish.difficulty, fish.behavior]).toEqual([null, null, null, null]);
    expect(warnings).toEqual([]);
  });

  it('reads legendary fish and the fishing level they need', () => {
    const legend = extractFish(fishPage('Legend')).fish;
    expect([legend.isLegendary, legend.fishingLevel, legend.sellPrice, legend.weather]).toEqual([true, 10, 5000, 'Rain']);
    const lavaEel = extractFish(fishPage('Lava Eel')).fish;
    expect([lavaEel.isLegendary, lavaEel.fishingLevel, lavaEel.fishingLevelNote]).toEqual([false, 7, '(Forge)']);
  });

  it('uses the infobox seasons when the page has no season categories (Stingray)', () => {
    const { fish, warnings } = extractFish(fishPage('Stingray'));
    expect(fish.seasons).toEqual(['Spring', 'Summer', 'Fall', 'Winter']);
    expect(fish.areas).toEqual(['Ginger Island']);
    expect(warnings).toEqual([]);
  });

  it('reads a Night Market fish', () => {
    const { fish } = extractFish(fishPage('Midnight Squid'));
    expect(fish.seasons).toEqual(['Winter']);
    expect(fish.locationNote).toBe('Submarine at Night Market');
    expect(fish.timeNote).toBe('Anytime during Night Market (5pm - 2am)');
  });

  it('warns instead of guessing when seasons disagree or are missing', () => {
    const page = structuredClone(fishPage('Tuna'));
    page.revisions[0].slots.main.content = '{{Infobox fish\n|eng = Test\n|season = {{Season|Spring}}\n|price = ?\n}}';
    const { fish, warnings } = extractFish(page);
    expect(fish.sellPrice).toBeNull();
    expect(warnings.join(' ')).toMatch(/could not read the price/);
    expect(warnings.join(' ')).toMatch(/differ from the season categories/);
  });

  it('skips pages without the fish infobox', () => {
    expect(extractFish({ title: 'X', revisions: [{ slots: { main: { content: 'no infobox' } } }] }).ok).toBe(false);
  });
});

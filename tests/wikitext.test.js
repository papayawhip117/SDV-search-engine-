import { describe, expect, it } from 'vitest';
import {
  findTemplateCall,
  firstTemplateArgument,
  getSection,
  parseFirstTable,
  parseLeadingInteger,
  parseTemplateParams,
  splitTopLevel,
  stripLinks,
  toPlainText,
} from '../src/extract/wikitext.js';

describe('findTemplateCall', () => {
  it('returns the whole call, including nested templates', () => {
    const text = 'Intro {{Infobox\n|seed = {{Name|Parsnip Seeds}}\n|growth = 4 days\n}} after';
    expect(findTemplateCall(text, 'Infobox')).toBe('Infobox\n|seed = {{Name|Parsnip Seeds}}\n|growth = 4 days\n');
  });

  it('ignores the case of the first letter, like MediaWiki does', () => {
    expect(findTemplateCall('{{infobox|a=1}}', 'Infobox')).toBe('infobox|a=1');
  });

  it('does not match a template whose name only starts the same way', () => {
    expect(findTemplateCall('{{InfoboxFish|a=1}}', 'Infobox')).toBeNull();
  });

  it('returns null when the template is missing', () => {
    expect(findTemplateCall('no templates here', 'Infobox')).toBeNull();
  });
});

describe('splitTopLevel', () => {
  it('ignores separators inside templates and links', () => {
    expect(splitTopLevel('a|{{b|c}}|[[d|e]]', '|')).toEqual(['a', '{{b|c}}', '[[d|e]]']);
  });
});

describe('parseTemplateParams', () => {
  it('reads named parameters by name, in any order', () => {
    const result = parseTemplateParams('Infobox\n|sellprice = 50\n|eng = Corn\n|seed = {{Name|Corn Seeds}}');
    expect(result.name).toBe('Infobox');
    expect(result.named).toEqual({ sellprice: '50', eng: 'Corn', seed: '{{Name|Corn Seeds}}' });
  });

  it('keeps unnamed parameters in order', () => {
    expect(parseTemplateParams('Season|Summer').positional).toEqual(['Summer']);
  });
});

describe('small cleaners', () => {
  it('stripLinks keeps the visible text of links', () => {
    expect(stripLinks('8 [[Farming#Experience Points|Farming XP]] in [[Spring]]')).toBe('8 Farming XP in Spring');
  });

  it('firstTemplateArgument reads {{Name|...}}', () => {
    expect(firstTemplateArgument('{{Name|Parsnip Seeds}}', 'Name')).toBe('Parsnip Seeds');
    expect(firstTemplateArgument('Parsnip Seeds', 'Name')).toBeNull();
  });

  it('toPlainText keeps the words inside Name, Season and Weather templates', () => {
    expect(toPlainText('{{Season|Summer}} • {{Weather inline|Sun}} at {{Name|Crab Pot|class=inline}}')).toBe('Summer • Sun at Crab Pot');
    expect(toPlainText('at the Traveling Cart for {{tprice|100}}.')).toBe('at the Traveling Cart for a random price.');
  });

  it('parseLeadingInteger reads the number at the start', () => {
    expect(parseLeadingInteger('4 days')).toBe(4);
    expect(parseLeadingInteger('8 [[Farming|Farming XP]]')).toBe(8);
    expect(parseLeadingInteger('1,500')).toBe(1500);
    expect(parseLeadingInteger('varies')).toBeNull();
    expect(parseLeadingInteger(undefined)).toBeNull();
  });
});

describe('getSection', () => {
  it('returns the text under a heading, up to the next heading', () => {
    const text = 'top\n==Stages==\nstage text\n==Gifting==\ngift text';
    expect(getSection(text, 'Stages').trim()).toBe('stage text');
    expect(getSection(text, 'Missing')).toBeNull();
  });
});

describe('parseFirstTable', () => {
  it('reads rows of cells', () => {
    const table = '{| class="wikitable"\n!A\n!B\n|-\n|1 Day\n|style="x"|Total: 1 Day\n|-\n|a||b\n|}';
    expect(parseFirstTable(table)).toEqual([['A', 'B'], ['1 Day', 'Total: 1 Day'], ['a', 'b']]);
  });
});

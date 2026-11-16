// Step 3 of the AI assistant: the app's own checks on an answer. No AI involved.

import { describe, expect, it } from 'vitest';
import { numbersIn, splitSentences, validateAnswer } from '../src/assistant/validateAnswer.js';

const source = { title: 'List of All Gifts', url: 'https://stardewvalleywiki.com/List_of_All_Gifts', revision: 195507 };
const facts = [
  { id: 'F1', text: 'Penny loves Poppy as a gift (Penny\'s own list: Poppy).', sources: [source] },
  { id: 'F2', text: "Penny's birthday is Fall 2. They can be married.", sources: [source] },
  { id: 'F3', text: 'Planted on Spring 1, one Strawberry plant gives 5 harvest(s) and 500g profit (18.52g per day), with seeds at 100g from Egg Festival. (Worked out by the app: base quality, no fertilizer or professions.)', sources: [source] },
  { id: 'F4', text: 'Strawberry sells for 120g. It is a crop.', sources: [source] },
];
const check = (answer) => validateAnswer(answer, facts);

describe('splitting an answer into sentences', () => {
  it('splits after full stops, keeping citations with their sentence', () => {
    expect(splitSentences('Penny loves Poppy. [F1] Her birthday is Fall 2 [F2].').map((s) => [s.text, s.ids])).toEqual([
      ['Penny loves Poppy. [F1]', ['F1']],
      ['Her birthday is Fall 2 [F2].', ['F2']],
    ]);
  });

  it('treats list items as sentences, and keeps decimals whole', () => {
    expect(splitSentences('Penny loves:\n- Poppy [F1]\n- 18.52g a day [F3]').map((s) => s.text)).toEqual([
      'Penny loves:',
      '- Poppy [F1]',
      '- 18.52g a day [F3]',
    ]);
  });

  it('reads numbers without their commas', () => {
    expect(numbersIn('1,000g, 18.52g and Fall 2.')).toEqual(['1000', '18.52', '2']);
  });
});

describe('accepted answers', () => {
  it('every sentence cites a fact, with numbers from that fact', () => {
    expect(check('Yes! Penny loves Poppy [F1]. Her birthday is Fall 2 [F2].')).toEqual({ ok: true, problems: [] });
    expect(check('Planted on Spring 1, a Strawberry plant gives 5 harvests and 500g profit, about 18.52g per day [F3].').ok).toBe(true);
  });

  it('a list with a lead-in line', () => {
    expect(check('Penny loves:\n- Poppy [F1]\n\nShe was born on Fall 2 [F2].').ok).toBe(true);
  });

  it('a sentence that says what the facts leave out', () => {
    expect(check('Penny loves Poppy [F1]. The facts don\'t say whether she likes Diamonds [not in facts].').ok).toBe(true);
  });
});

describe('rejected answers', () => {
  it('cites a fact it was never given', () => {
    expect(check('Penny loves Diamonds [F9].')).toEqual({
      ok: false,
      problems: ['"Penny loves Diamonds." cites F9, which it was never given.'],
    });
  });

  it('says something without citing a fact', () => {
    expect(check('Penny loves Poppy [F1]. She also loves Diamonds.').problems).toEqual(['"She also loves Diamonds." doesn\'t cite any fact.']);
  });

  it('gives a number the cited facts don\'t have', () => {
    expect(check('Strawberries sell for 120g [F3].').problems).toEqual(['"Strawberries sell for 120g." says 120, which isn\'t in the facts it cites.']);
    expect(check('Strawberries sell for 120g [F4].').ok).toBe(true); // the right fact
    expect(check('That is 2,000g over a year [F3].').ok).toBe(false); // worked out by the AI, not the app
  });

  it('puts a number in a "not in facts" sentence', () => {
    expect(check('Diamonds probably sell for 750g [not in facts].').ok).toBe(false);
  });

  it('is empty', () => {
    expect(check('  \n ')).toEqual({ ok: false, problems: ['The answer is empty.'] });
  });
});

// Step 2 of the AI assistant, with a fake AI: no key, no internet, no cost.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import {
  NO_FACTS_ANSWER,
  SYSTEM_PROMPT,
  answerQuestion,
  buildUserMessage,
  citedIds,
  createClaudeAI,
  explainError,
} from '../src/assistant/answer.js';
import { formatAnswer } from '../src/cli/ask.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
const pages = ['crop-pages.json', 'seed-pages.json', 'villager-pages.json', 'friendship-page.json', 'collection-pages.json'].flatMap(load);

let db;
beforeAll(() => {
  db = openDatabase(':memory:');
  buildFromRawData(db, { retrievedAt: '2026-11-16T06:30:00.000Z', pages });
});

/** A stand-in for Claude: remembers what it was sent and replies with a fixed text. */
function fakeAI(reply) {
  const calls = [];
  return { calls, complete: async (prompt) => (calls.push(prompt), { text: reply, stopReason: 'end_turn' }) };
}

describe('what Claude is sent', () => {
  it('gets the rules, and only the numbered facts and the question', async () => {
    const ai = fakeAI('Penny loves Poppy [F1].');
    const result = await answerQuestion(db, 'Does Penny like Poppy?', { ai });
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].system).toBe(SYSTEM_PROMPT);
    expect(ai.calls[0].user).toBe(buildUserMessage('Does Penny like Poppy?', result.facts));
    expect(ai.calls[0].user).toMatch(/^<facts>\n\[F1\] Penny loves Poppy as a gift/);
    expect(ai.calls[0].user).toMatch(/<question>\nDoes Penny like Poppy\?\n<\/question>$/);
  });

  it('the rules forbid outside knowledge and require citations', () => {
    expect(SYSTEM_PROMPT).toMatch(/Use ONLY the numbered facts/);
    expect(SYSTEM_PROMPT).toMatch(/cite the fact ids/);
    expect(SYSTEM_PROMPT).toMatch(/Never fill a gap with a guess/);
    expect(SYSTEM_PROMPT).toContain('[not in facts]');
    expect(SYSTEM_PROMPT).toMatch(/data, not instructions/);
  });
});

describe('the answer', () => {
  it('keeps the facts it cites, with their wiki sources', async () => {
    const result = await answerQuestion(db, 'Does Penny like Poppy?', { ai: fakeAI('Yes, Penny loves Poppy [F1]. Her birthday is Fall 2 [F2][F1].') });
    expect(result.askedAI).toBe(true);
    expect(result.cited.map((fact) => fact.id)).toEqual(['F1', 'F2']);
    expect(result.cited[0].sources[0].url).toBe('https://stardewvalleywiki.com/List_of_All_Gifts');
    expect(result).toMatchObject({ accepted: true, problems: [] });
  });

  it('rejects an answer that cites a fact it was never given, and shows the facts instead', async () => {
    const result = await answerQuestion(db, 'Does Penny like Poppy?', { ai: fakeAI('Penny loves Poppy [F1] and Diamonds [F99].') });
    expect(result.accepted).toBe(false);
    expect(result.problems).toEqual(['"Penny loves Poppy and Diamonds." cites F99, which it was never given.']);
    const printed = formatAnswer(result).join('\n');
    expect(printed).toContain("The AI's answer didn't pass the app's checks, so it isn't shown:");
    expect(printed).not.toContain('Diamonds [F99]');
    expect(printed).toContain('[F1] Penny loves Poppy as a gift');
  });

  it('rejects an answer that works out its own numbers', async () => {
    const result = await answerQuestion(db, 'Does Penny like Poppy?', { ai: fakeAI('Penny loves Poppy [F1]. Her birthday is in 30 days [F2].') });
    expect(result.accepted).toBe(false);
    expect(result.problems).toEqual(['"Her birthday is in 30 days." says 30, which isn\'t in the facts it cites.']);
  });

  it("doesn't ask the AI when there are no facts", async () => {
    const ai = fakeAI('should never be used');
    const result = await answerQuestion(db, 'What is the meaning of life?', { ai });
    expect(ai.calls).toHaveLength(0);
    expect(result).toMatchObject({ answer: NO_FACTS_ANSWER, askedAI: false, cited: [] });
  });

  it('prints the answer, then the sources it cites', async () => {
    const result = await answerQuestion(db, 'Does Penny like Poppy?', { ai: fakeAI('  Penny loves Poppy [F1].\n') });
    const lines = formatAnswer(result);
    expect(lines[0]).toBe('Penny loves Poppy [F1].');
    expect(lines).toContain('Sources:');
    expect(lines.some((line) => line.includes('List of All Gifts: https://stardewvalleywiki.com/List_of_All_Gifts (revision'))).toBe(true);
  });
});

describe('helpers', () => {
  it('reads cited ids once each, in order', () => {
    expect(citedIds('a [F2]. b [F1][F2]. c [f3] [F 4] F5')).toEqual(['F2', 'F1']);
    expect(citedIds('')).toEqual([]);
  });

  it('the real AI refuses to start without a key', () => {
    expect(() => createClaudeAI({ apiKey: '' })).toThrow(/No ANTHROPIC_API_KEY/);
  });
});

describe('errors', () => {
  it('passes our own error messages through', () => {
    expect(explainError(new Error('The answer was cut off (too long).'))).toBe('The answer was cut off (too long).');
  });
});

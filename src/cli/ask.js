// Ask the assistant a question.
//
//   npm run ask -- "What does Abigail love?"
//   npm run ask -- "best crops to plant in summer"
//   npm run ask -- --facts "best crops to plant in summer"   only the facts, no AI
//
// The app finds the facts (step 1), then Claude writes an answer from those
// facts only, citing them like [F2] (step 2). Without an API key in .env, or
// with --facts, it shows the facts and doesn't call Claude.

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { findFacts } from '../assistant/findFacts.js';
import { answerQuestion, createClaudeAI, explainError } from '../assistant/answer.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

/** The result of findFacts → printable lines. Exported for tests. */
export function formatFacts({ understood, facts, usedSearch }) {
  const lines = [];
  const parts = [
    understood.villagers.length && `villagers ${understood.villagers.join(', ')}`,
    understood.items.length && `items ${understood.items.join(', ')}`,
    understood.seasons.length && `seasons ${understood.seasons.join(', ')}`,
    understood.topics.length && `topics ${understood.topics.join(', ')}`,
  ].filter(Boolean);
  lines.push(`Understood: ${parts.length ? parts.join('; ') : 'no names or topics I know'}`);
  if (usedSearch) lines.push('(No names recognised, so these facts are about the closest search results.)');
  lines.push('');
  if (facts.length === 0) {
    lines.push('No facts found in the database for this question.');
    return lines;
  }
  for (const fact of facts) {
    lines.push(`[${fact.id}] ${fact.text}`);
    for (const source of fact.sources) lines.push(`      ${source.title}: ${source.url} (revision ${source.revision})`);
  }
  return lines;
}

/** An answer from answerQuestion → printable lines: the answer, then the sources it cites. Exported for tests. */
export function formatAnswer({ answer, cited, uncitedIds }) {
  const lines = [answer, ''];
  if (cited.length > 0) {
    lines.push('Sources:');
    for (const fact of cited) {
      lines.push(`[${fact.id}] ${fact.text}`);
      for (const source of fact.sources) lines.push(`      ${source.title}: ${source.url} (revision ${source.revision})`);
    }
  }
  if (uncitedIds.length > 0) lines.push(`Warning: the answer cites ${uncitedIds.join(', ')}, which we never gave it.`);
  return lines;
}

/** Load .env (where the API key lives) if there is one. Node 20.12+ can do this itself. */
function loadEnvFile() {
  if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
}

async function main() {
  const args = process.argv.slice(2);
  const factsOnly = args.includes('--facts');
  const question = args.filter((arg) => arg !== '--facts').join(' ').trim();
  if (!question) {
    console.error('Usage: npm run ask -- "What does Abigail love?"   (add --facts to skip the AI)');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }
  loadEnvFile();
  const db = openDatabase(DATABASE_PATH);
  try {
    if (factsOnly || !process.env.ANTHROPIC_API_KEY) {
      console.log(formatFacts(findFacts(db, question)).join('\n'));
      if (!factsOnly) console.log('\n(No ANTHROPIC_API_KEY in .env, so no AI answer. These are the facts it would get.)');
    } else {
      const result = await answerQuestion(db, question, { ai: createClaudeAI() });
      console.log(formatAnswer(result).join('\n'));
    }
    console.log('\nData from the Stardew Valley Wiki (CC BY-NC-SA).');
  } catch (error) {
    console.error(`Could not get an answer: ${explainError(error)}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (isRunDirectly(import.meta.url)) main();

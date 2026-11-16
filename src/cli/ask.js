// Ask a question and see the facts the assistant would get.
//
//   npm run ask -- "What does Abigail love?"
//   npm run ask -- "best crops to plant in summer"
//
// This is step 1 of the AI assistant: no AI yet. It shows what the app
// understood and every fact it found, each with its wiki source. Step 2
// will hand exactly these facts to Claude to write the answer.

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { findFacts } from '../assistant/findFacts.js';
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

function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('Usage: npm run ask -- "What does Abigail love?"');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }
  const db = openDatabase(DATABASE_PATH);
  const result = findFacts(db, question);
  db.close();
  console.log(formatFacts(result).join('\n'));
  console.log('\nThese are the only facts the AI assistant will be allowed to use (step 2).');
  console.log('Data from the Stardew Valley Wiki (CC BY-NC-SA).');
}

if (isRunDirectly(import.meta.url)) main();

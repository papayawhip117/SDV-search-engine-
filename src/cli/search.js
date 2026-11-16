// Command-line search.
//
//   npm run search -- berry
//   npm run search -- trellis --season fall
//   npm run search -- --type seed --sort buy
//   npm run search -- melon --sort sell --limit 5
//
// Options: --season <Spring|Summer|Fall|Winter>  --type <crop|seed|fish>
//          --sort <relevance|name|sell|buy>  --reverse  --limit <number>

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { defaultSortFor, searchItems, sortsDescendingByDefault } from '../queries/search.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

const VALUE_OPTIONS = ['season', 'type', 'sort', 'limit'];

/** Split command-line words into search text and --options. */
export function parseSearchArguments(args) {
  const words = [];
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--reverse') {
      options.reverse = true;
    } else if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!VALUE_OPTIONS.includes(name)) throw new Error(`Unknown option ${arg}`);
      if (args[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      options[name] = args[++i];
    } else {
      words.push(arg);
    }
  }
  return { text: words.join(' '), ...options };
}

function formatPrice(value) {
  return value === null ? '-' : `${value}g`;
}

function main() {
  let args;
  try {
    args = parseSearchArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (!args.text && !args.season && !args.type && !args.sort) {
    console.error('Usage: npm run search -- <words> [--season fall] [--type crop|seed|fish] [--sort relevance|name|sell|buy] [--reverse] [--limit 20]');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(DATABASE_PATH);
  let found;
  try {
    const sortBy = args.sort ?? defaultSortFor(args.text);
    found = searchItems(db, {
      text: args.text,
      season: args.season,
      type: args.type,
      sortBy,
      limit: args.limit === undefined ? 50 : Number(args.limit),
      // --reverse flips the sort's usual direction (sell normally runs high → low)
      descending: args.reverse ? !sortsDescendingByDefault(sortBy) : undefined,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  } finally {
    db.close();
  }

  if (found.ignoredWords.length) {
    console.log(`(Skipped ${found.ignoredWords.map((w) => `"${w}"`).join(', ')}: search words need at least 3 letters.)`);
  }
  if (found.results.length === 0) {
    console.log('No matching items in the local database.');
    return;
  }
  console.table(
    found.results.map((item) => ({
      Name: item.name,
      Type: item.type,
      Seasons: item.seasons.join(', ') || '-',
      Sell: formatPrice(item.sellPrice),
      'Buy from': formatPrice(item.buyPrice),
      Source: item.sourceUrl,
    })),
  );
  console.log(`\n${found.results.length} result(s). Details: npm run item -- "<name>"`);
  console.log('Data from the Stardew Valley Wiki (CC BY-NC-SA).');
}

if (isRunDirectly(import.meta.url)) main();

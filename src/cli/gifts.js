// Villagers and gifts on the command line.
//
//   npm run gifts -- Alex               Alex's birthday and gift lists
//   npm run gifts -- --item Tuna        how every villager feels about Tuna
//   npm run gifts -- --birthday summer  whose birthday is in Summer
//   npm run gifts                       every villager's name

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { getBirthdays, getVillager, getVillagerNames, whoLikes } from '../queries/giftQueries.js';
import { TASTES } from '../extract/villagerExtractor.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

/** ["--item", "Fish", "Taco"] → { item: 'Fish Taco' }; ["Alex"] → { villager: 'Alex' } */
export function parseGiftArguments(args) {
  const options = {};
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--item' || args[i] === '--birthday') {
      const key = args[i].slice(2);
      const value = [];
      while (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) value.push(args[++i]);
      if (value.length === 0) throw new Error(`${args[i]} needs a value, e.g. ${key === 'item' ? '--item Tuna' : '--birthday summer'}`);
      options[key] = value.join(' ');
    } else if (args[i].startsWith('--')) {
      throw new Error(`Unknown option ${args[i]}`);
    } else {
      words.push(args[i]);
    }
  }
  if (words.length) options.villager = words.join(' ');
  return options;
}

const TASTE_LABELS = { love: 'Loves', like: 'Likes', neutral: 'Neutral', dislike: 'Dislikes', hate: 'Hates' };

/** One villager → printable lines. Exported for tests. */
export function formatVillager(villager) {
  const lines = [villager.name, ''];
  lines.push(`Birthday:    ${villager.birthday ? `${villager.birthday.season} ${villager.birthday.day}` : 'unknown'}`);
  if (villager.marriageable !== null) lines.push(`Marriage:    ${villager.marriageable ? 'can be married' : 'not a marriage candidate'}`);
  for (const taste of TASTES) {
    const label = `${TASTE_LABELS[taste]}:`.padEnd(13);
    lines.push(`${label}${villager.tastes[taste].join(', ') || '-'}`);
  }
  lines.push('', 'Everyone also has the universal tastes, unless their own list says otherwise.');
  lines.push(`Source:      ${villager.source.url} (revision ${villager.source.revision})`);
  return lines;
}

function main() {
  let options;
  try {
    options = parseGiftArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }
  const db = openDatabase(DATABASE_PATH);
  try {
    if (options.item) {
      const tastes = whoLikes(db, options.item);
      console.log(`How villagers feel about ${options.item}:\n`);
      for (const taste of [...TASTES, 'unknown']) {
        if (tastes[taste].length === 0) continue;
        const label = taste === 'unknown' ? 'Not listed:' : `${TASTE_LABELS[taste]}:`;
        console.log(`${label.padEnd(13)}${tastes[taste].join(', ')}`);
      }
      console.log('\nWhy for one villager: npm run gifts -- <villager>');
    } else if (options.birthday) {
      const birthdays = getBirthdays(db, options.birthday);
      if (birthdays.length === 0) console.log(`No birthdays found in "${options.birthday}". Try spring, summer, fall or winter.`);
      else console.table(birthdays.map(({ name, season, day }) => ({ Day: `${season} ${day}`, Villager: name })));
    } else if (options.villager) {
      const villager = getVillager(db, options.villager);
      if (!villager) {
        console.log(`No villager called "${options.villager}". Villagers: ${getVillagerNames(db).join(', ')}`);
        process.exitCode = 1;
      } else {
        console.log(formatVillager(villager).join('\n'));
      }
    } else {
      const names = getVillagerNames(db);
      if (names.length === 0) console.log('No villagers in the database yet. Import the gift pages and run "npm run build-db".');
      else console.log(`Villagers: ${names.join(', ')}\n\nTry: npm run gifts -- Abigail, or npm run gifts -- --item Amethyst`);
    }
  } finally {
    db.close();
  }
  console.log('Data from the Stardew Valley Wiki (CC BY-NC-SA).');
}

if (isRunDirectly(import.meta.url)) main();

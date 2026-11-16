// Command-line fish list, highest sell price first.
//
//   npm run fish -- Summer
//   npm run fish -- Fall --weather rain
//   npm run fish -- Winter --area ocean --legendary
//
// Options: --weather <sun|rain>  --area <Ocean|River|Lake|...>  --legendary (include legendary fish)

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { AREAS, WEATHERS, getFish } from '../queries/fishQueries.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

/** Split command-line words into a season and --options. */
export function parseFishArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--legendary') {
      options.includeLegendary = true;
    } else if (arg === '--weather' || arg === '--area') {
      if (args[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = args[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}`);
    } else if (options.season === undefined) {
      options.season = arg;
    } else {
      throw new Error(`Unexpected "${arg}". Put area names with spaces in quotes: --area "Secret Woods"`);
    }
  }
  return options;
}

/** Only the first part of a long location ("Crab Pot: Saltwater; Turtle" → "Crab Pot: Saltwater …"). */
function shorten(location) {
  if (!location) return '-';
  const [first, ...rest] = location.split('; ');
  return rest.length ? `${first} …` : first;
}

function main() {
  let options;
  try {
    options = parseFishArguments(process.argv.slice(2));
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
  let found;
  try {
    found = getFish(db, options);
  } catch (error) {
    console.error(error.message);
    console.error(`Usage: npm run fish -- [season] [--weather ${WEATHERS.join('|').toLowerCase()}] [--area "${AREAS.join('|')}"] [--legendary]`);
    process.exitCode = 1;
    return;
  } finally {
    db.close();
  }

  if (found.fish.length === 0) {
    console.log('No fish match.');
  } else {
    console.table(
      found.fish.map((fish) => ({
        Fish: fish.name + (fish.isLegendary ? ' (legendary)' : ''),
        'Sell price': fish.sellPrice ?? 'unknown',
        Where: shorten(fish.location),
        Time: fish.time ?? '-',
        Weather: fish.weather ?? fish.weatherNote ?? '-',
        Source: fish.sourceUrl,
      })),
    );
  }

  const conditional = found.fish.filter((fish) => fish.seasonNote);
  if (options.season && conditional.length) {
    console.log('\nSeasons with conditions on the wiki (check the page):');
    for (const fish of conditional) console.log(`  - ${fish.name}: ${fish.seasonNote}`);
  }
  if (found.unclearWeather.length) {
    console.log('\nLeft out because their weather rule is more than one word:');
    for (const fish of found.unclearWeather) console.log(`  - ${fish.name}: ${fish.weatherNote}`);
  }
  console.log('\nSell prices are base quality. Full details: npm run item -- <fish name>');
  console.log('Data from the Stardew Valley Wiki (CC BY-NC-SA).');
}

if (isRunDirectly(import.meta.url)) main();

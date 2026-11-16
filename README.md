# SDV Search Engine

A Stardew Valley search engine built from the [Stardew Valley Wiki](https://stardewvalleywiki.com/). Every fact in the database records which wiki page it came from, which revision of that page, and when it was downloaded.

An AI assistant will come later. It will only answer from this verified local database and will cite the wiki page behind every fact.

> **Status:** Phase 9. Crops, seed prices, profit per day, a search engine, fish, artisan goods with the machines that make them, cooking and crafting recipes, and villagers with their birthdays and gift tastes.

## How it works

```
 Stardew Valley Wiki        your computer
 (MediaWiki API)
        │
        │  1. npm run collect      polite, one request at a time
        ▼
 data/raw/crops-<date>.json      raw API responses, saved as-is
        │
        │  2. npm run build-db     extract facts from the wikitext
        ▼
 data/sdv.db  (SQLite)           crops, seeds, seasons, stages, sources
        │
        │  3. npm run crops -- Summer
        ▼
 a table of Summer crops sorted by sell price, each with its wiki link
```

The app never looks things up on the wiki while you search. It only reads the local database. The wiki is contacted once per collection run.

More detail: [docs/how-it-works.md](docs/how-it-works.md). The original research is in [docs/phase-1-research.md](docs/phase-1-research.md).

## Setup

You need [Node.js](https://nodejs.org/) version 20 or newer. Check with:

```
node --version
```

Install the project's dependencies (this creates the `node_modules/` folder):

```
npm install
```

## Usage

Run these one at a time:

| Command | What it does |
|---|---|
| `npm test` | Runs the automated tests. No internet needed. |
| `npm run collect` | Downloads the crop pages from the wiki into `data/raw/`. **Currently refused** (HTTP 403): the wiki's firewall blocks Node.js. Use `npm run import` instead. |
| `npm run import` | Prints the wiki URLs to save from your browser into `data/browser/` (crops, seeds, fish, artisan goods, fruits, cooking, crafting, villagers and gifts). Then `npm run import -- data/browser/*.json` turns them into `data/raw/`. |
| `npm run build-db` | Reads the newest file in `data/raw/` (from `collect` or `import`), extracts crops, seeds, fish, artisan goods, dishes, crafting recipes, villagers and gift tastes, and saves them to `data/sdv.db`. |
| `npm run crops -- Summer` | Lists Summer crops by sell price, with wiki links. Try `Spring` or `Fall` too. |
| `npm run search -- berry` | Searches names, wiki categories, shops and page summaries. Options: `--season fall`, `--type crop`, `seed`, `fish`, `artisan`, `machine`, `dish` or `crafted`, `--sort relevance`/`name`/`sell`/`buy`, `--reverse`, `--limit 10`. |
| `npm run item -- "Parsnip Seeds"` | Shows one item with everything connected to it: seasons, growth, seed, shop prices, what a seed grows into, categories, and its wiki source and revision. |
| `npm run fish -- Summer` | Lists Summer fish by sell price, with where, when and in what weather to catch them. Options: `--weather rain` or `sun`, `--area Ocean` (or River, Lake, Pond, ...), `--legendary` to include legendary fish. |
| `npm run artisan -- Starfruit` | What an item can be turned into (Wine, Jelly, Dried Fruit...), which machine, how long it takes and what it's worth, best value first. Try `Corn`, `Tuna` or `Grape`. |
| `npm run cook -- Tomato` | Lists the dishes that use Tomato, with sell price, ingredients, what the raw ingredients are worth, buffs and how to get the recipe. Names with spaces work without quotes (`npm run cook -- Wheat Flour`). Add `--buff Fishing` for dishes with that buff, or give no ingredient to list every dish. |
| `npm run craft -- Iron Bar` | Lists the crafting recipes that use Iron Bar, with all their ingredients and how you get each recipe. Use `--section Rings` (or Fertilizer, Sprinklers...) for one section of the Crafting page, or no arguments to list the sections. |
| `npm run gifts -- Abigail` | A villager's birthday, whether they can be married, and what they love, like, are neutral about, dislike and hate. `--item Diamond` shows how every villager feels about one item; `--birthday summer` lists birthdays by day. Item pages (`npm run item`) also show who loves, likes, dislikes and hates that item. |
| `npm run profit -- Spring` | Ranks Spring crops by profit per day, using seed prices from the wiki. Add a day to plant later: `npm run profit -- Spring 10`. |

## Project layout

```
src/
  wiki/apiClient.js        talks to the wiki API (rate limiting, retries)
  collect/collectCrops.js  finds every crop page and saves the raw data
  collect/importBrowserFiles.js  turns API responses saved in a browser into raw data
  collect/fishPages.js     the list of fish pages to download
  collect/artisanPages.js  the list of artisan goods and machine pages to download
  collect/cookingPages.js  the list of dish pages to download
  extract/wikitext.js      general tools for reading wiki markup
  extract/cropExtractor.js turns one crop page into clean crop facts
  extract/seedExtractor.js reads shop prices from one seed page
  extract/fishExtractor.js turns one fish page into clean fish facts
  extract/artisanExtractor.js reads machine product tables, artisan goods pages and the Fruits list
  extract/cookingExtractor.js turns one dish page into a dish with its ingredients
  extract/craftingExtractor.js reads every recipe table on the Crafting page
  extract/villagerExtractor.js reads villagers, birthdays and gift tastes
  calc/profit.js           harvests, costs and profit per day (no AI involved)
  db/schema.sql            the database tables
  db/database.js           opens the database and saves crops, seeds, fish, artisan goods, dishes and crafting recipes
  db/buildDatabase.js      raw data → extractor → database
  db/searchIndex.js        fills the full-text search index after each build
  queries/cropQueries.js   reusable database searches
  queries/search.js        the search engine: text search, filters, sorting, item details
  queries/fishQueries.js   fish by season, weather and area
  queries/artisanQueries.js  what an item can be made into, and how goods are made
  queries/cookingQueries.js  dishes, their ingredients, and which dishes use an item
  queries/craftingQueries.js crafting recipes, and which recipes use an item
  queries/giftQueries.js   villagers, birthdays, and what a villager thinks of an item
  cli/listCrops.js         the command-line search
  cli/profit.js            the command-line profit table
  cli/search.js, item.js   the command-line search and item details
  cli/fish.js              the command-line fish list
  cli/artisan.js           the command-line "what can I make from this" table
  cli/cook.js              the command-line "what can I cook with this" table
  cli/craft.js             the command-line "what can I craft with this" table
  cli/gifts.js             the command-line villager and gift lookup
tests/
  fixtures/                real wiki pages saved for tests
  *.test.js                Vitest tests
docs/                      design notes and research
```

## Data source and license

All game data comes from the [Stardew Valley Wiki](https://stardewvalleywiki.com/). Its text is licensed under [Creative Commons Attribution-NonCommercial-ShareAlike](https://creativecommons.org/licenses/by-nc-sa/3.0/) (the exact version still has to be confirmed on the wiki's copyright page). This means:

- every fact links back to its wiki page (the database stores the title, URL, revision id and download date)
- this project and its data may not be used commercially
- any shared copy of the extracted data must use the same license

Game images are © ConcernedApe and are not copied into this project.

The license of this project's own source code has not been chosen yet.

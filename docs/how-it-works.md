# How it works

This explains the crops proof of concept piece by piece, in the order data flows through it.

## 1. Collecting: `src/wiki/apiClient.js` and `src/collect/collectCrops.js`

The wiki runs MediaWiki, which has an **API**: a URL that returns data as JSON instead of a web page. Every request goes through `callWikiApi()`, which:

- waits at least 1 second after the previous request, so we never send a burst
- sends a `User-Agent` header naming the project, so the wiki's admins know who we are
- adds `maxlag=5`, which lets the wiki turn us away when it's busy
- retries on network errors, "busy" answers and server errors, waiting longer each time (5 s, 10 s, 15 s)

Long lists come back in pieces. Each piece includes a `continue` value that we send back to get the next one. `callWikiApiWithContinue()` does this in a loop.

`collectCrops.js` lists `Category:Spring crops`, `Summer crops` and `Fall crops` (the main `Category:Crops` only contains overview pages). It removes duplicates (Corn is in two seasons), downloads the pages 50 at a time, and saves the responses **unchanged** to `data/raw/crops-<date>.json`.

Saving raw data first means we can improve the extractor and rebuild the database as often as we like without contacting the wiki again.

## 2. Extracting: `src/extract/`

Wiki pages are written in **wikitext**. The top of a crop page looks like this:

```
{{Infobox
|eng         = Corn
|seed        = {{Name|Corn Seeds}}
|growth      = 14 days
|season      = {{Season|Summer}} • {{Season|Fall}}
|sellprice   = 50
}}
```

`wikitext.js` holds general tools that work on any page:

| Function | Job |
|---|---|
| `findTemplateCall` | finds `{{Infobox ...}}`, counting `{{` and `}}` so nested templates don't confuse it |
| `splitTopLevel` | splits on `|` but ignores any `|` inside `{{ }}` or `[[ ]]` |
| `parseTemplateParams` | turns the template into `{ eng: 'Corn', growth: '14 days', ... }` |
| `getSection` / `parseFirstTable` | read the "Stages" section and its table |

`cropExtractor.js` uses those tools to build one clean crop object:

```js
{ name: 'Corn', seedName: 'Corn Seeds', growthDays: 14, seasons: ['Summer', 'Fall'],
  sellPrice: 50, regrows: true, regrowthDays: 4, stageDays: [2, 3, 3, 3, 3] }
```

Regrowth isn't in the infobox. It comes from the `Regrowth: 4 Days` cell of the Stages table. The extractor also checks the facts against each other (the infobox growth days against the table total, and the stage days against the total), and compares regrowth with the "continues to produce every N days" sentence. Any disagreement becomes a **warning**.

The rule throughout: **if we can't read a value, it becomes `null` with a warning. We never guess.**

Real pages that needed special handling (found on the first full run, 40 crops):

- **Grape** lists two ways to grow it on separate lines: `7 days (Summer Seeds)<br />10 days (Grape Starter)`, with matching seasons and seeds. The Stages table only describes one of them (it adds up to 10 days), so the extractor picks the variant whose growth time matches the table, here Grape Starter in Fall, and prints a **note**. If no variant (or more than one) matched, it would store those fields as `null` with a warning.
- **Unmilled Rice** says `8 days (6 when irrigated)`. We store 8 as the growth days and keep `(6 when irrigated)` in `growth_note`, so the information isn't lost.
- **Coffee Bean** is its own seed, so its `seed_item_id` points at its own item.
- **Trellis crops** come from the wiki's `Category:Trellis Crops`.

## 3. Storing: `src/db/`

`schema.sql` creates the tables. The reasons for each table are in [phase-1-research.md](phase-1-research.md), section 5. The key idea is that every fact points to a row in `source_pages`, which records the wiki page title, URL, revision id, edit time and download date.

`database.js` → `saveCrop()` writes one crop inside a **transaction**: either every row for that crop is saved or none is, so a crash can't leave half a crop behind. It uses "upserts" (insert, or update if the row already exists), so running `npm run build-db` twice doesn't create duplicates.

`buildDatabase.js` connects the steps: newest raw file → extractor → database, then prints which pages were skipped, the notes and the warnings. It deletes and rebuilds `data/sdv.db` each time, because the database is made entirely from the raw files, and this means a change to `schema.sql` never clashes with an old database file.

## 4. Searching: `src/queries/cropQueries.js` and `src/cli/listCrops.js`

`getCropsBySeason()` joins crops to their items, seasons, seeds and source pages. Sorting only accepts column names from a fixed list. That protects against **SQL injection**, where someone types SQL commands into a search box.

The command line, the future web app and the future AI assistant will all call these same query functions, so they always agree.

## 5. Seed prices: `src/extract/seedExtractor.js`

Seed pages use a different template, `{{Infobox seed}}`, with one field per shop:

```
|gPrice    = {{Price|20}}           Pierre's General Store
|jPrice    = {{Price|25}}           JojaMart
|oPrice    = {{Price|100}}          Oasis
|tPrice    = {{Tprice|10}}          Traveling Cart (random price, so NOT stored)
|otherprice = [[Egg Festival]]: {{Price|100}}
```

Which field means which shop was checked against each page's own text ("can be purchased at Pierre's General Store, at JojaMart..."). `Not Sold` means no row. A note like `(Year 2+)` is kept in `shop_prices.availability_note`. Seeds nobody sells (Carrot, Ancient Seeds) simply have no price, so their profit isn't calculated.

To get them: save the seed-pages URL from your browser as `data/browser/seeds.json`, then run the same `npm run import -- data/browser/*.json` and `npm run build-db`. The build sends `{{Infobox seed}}` pages to the seed extractor and everything else to the crop extractor.

## 6. Profit: `src/calc/profit.js` and `src/cli/profit.js`

Calculations live in plain functions with tests, never in the AI:

| Function | Example |
|---|---|
| `daysAvailable` | Corn planted Summer 1 → 55 days, because it keeps growing through Fall |
| `countHarvests` | one-time crop: `floor(days ÷ growth)` harvests, one seed each. Regrowing: `1 + floor((days − growth) ÷ regrowth)`, one seed |
| `calculateProfit` | revenue − seed cost, and profit ÷ days. If anything is missing, it returns the reason instead of a number |

`npm run profit -- Spring 10` ranks the season's crops by profit per day for one plant planted on Spring 10, lists what couldn't be calculated and why, and prints every assumption. It also flags data the numbers ignore, like rice's "(6 when irrigated)" or seeds only sold at a festival.

## 7. Tests: `tests/`

| File | Checks |
|---|---|
| `collector.test.js` | URL building, duplicate removal, following `continue` (with a fake `fetch`, so no internet) |
| `wikitext.test.js` | each wikitext helper on small examples |
| `cropExtractor.test.js` | the real Parsnip, Strawberry and Corn pages give exactly the values a person reads off the page |
| `database.test.js` | the full pipeline into an in-memory database, attribution on every result, no duplicates on a rebuild, cheapest seed price |
| `seedExtractor.test.js` | real seed pages: Pierre/JojaMart/Oasis prices, Year 2+ notes, festival prices, seeds no shop sells |
| `profit.test.js` | harvest counts and profit worked out by hand for Parsnip, Strawberry and Corn |

Run them with `npm test`.

## If the wiki refuses the collector

If `npm run collect` stops with **HTTP 403**, the site refused the program on purpose. The error message prints the `server` and `cf-mitigated` headers and the start of the page that came back, which shows who refused it (for example a Cloudflare bot check).

This happened on the first real run (November 2026). Testing showed the wiki accepts `curl` with our name tag but refuses Node.js with the same name tag and URL, so the firewall is judging the *program*, not what it asks for. Swapping to another program just because it isn't recognised yet would be slipping past a rule, so we don't.

We **don't** get around a refusal by pretending to be a web browser. The wiki decides who may use it automatically. Instead:

1. Save the API responses from your browser, which the wiki does allow, and build the database from those files. `npm run import` prints the 3 URLs to save (one per season). Each uses a **generator**, which tells the API "take the members of this category and give me their page content", so one URL returns every crop in that season. `npm run import -- data/browser/*.json` then merges the files into the same `data/raw/` format that `collect` makes. It uses each file's save time as the download date, and warns if a file is incomplete.
2. If we need regular automated access later, ask the wiki's administrators.

## Known limitations (so far)

- Only crops in the Spring, Summer and Fall categories. Fruit trees, forage and special crops come later.
- Profit doesn't model when a shop is open (Strawberry Seeds are only sold at the Egg Festival) or fertilizer, quality and professions.
- Traveling Cart prices are random, so seeds only sold there have no price.
- Harvest yield ("1, with a 2% chance for more") is only written as a sentence on the wiki, so it isn't stored yet.
- Sell price is base quality only. Quality and profession bonuses will be calculated in code later, with their formulas documented.
- The exact license version still needs confirming on the wiki's copyright page.

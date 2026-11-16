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

## 3. Storing: `src/db/`

`schema.sql` creates the tables. The reasons for each table are in [phase-1-research.md](phase-1-research.md), section 5. The key idea is that every fact points to a row in `source_pages`, which records the wiki page title, URL, revision id, edit time and download date.

`database.js` → `saveCrop()` writes one crop inside a **transaction**: either every row for that crop is saved or none is, so a crash can't leave half a crop behind. It uses "upserts" (insert, or update if the row already exists), so running `npm run build-db` twice doesn't create duplicates.

`buildDatabase.js` connects the steps: newest raw file → extractor → database, then prints which pages were skipped and why.

## 4. Searching: `src/queries/cropQueries.js` and `src/cli/listCrops.js`

`getCropsBySeason()` joins crops to their items, seasons, seeds and source pages. Sorting only accepts column names from a fixed list. That protects against **SQL injection**, where someone types SQL commands into a search box.

The command line, the future web app and the future AI assistant will all call these same query functions, so they always agree.

## 5. Tests: `tests/`

| File | Checks |
|---|---|
| `collector.test.js` | URL building, duplicate removal, following `continue` (with a fake `fetch`, so no internet) |
| `wikitext.test.js` | each wikitext helper on small examples |
| `cropExtractor.test.js` | the real Parsnip, Strawberry and Corn pages give exactly the values a person reads off the page |
| `database.test.js` | the full pipeline into an in-memory database, attribution on every result, no duplicates on a rebuild |

Run them with `npm test`.

## Known limitations (so far)

- Only crops in the Spring, Summer and Fall categories. Fruit trees, forage and special crops come later.
- No seed buy prices yet, because they're on seed and shop pages, not crop pages. So no profit calculation yet.
- Harvest yield ("1, with a 2% chance for more") is only written as a sentence on the wiki, so it isn't stored yet.
- Sell price is base quality only. Quality and profession bonuses will be calculated in code later, with their formulas documented.
- The exact license version still needs confirming on the wiki's copyright page.

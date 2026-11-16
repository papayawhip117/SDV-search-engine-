# Phase 1: Wiki data acquisition research

Status: proposal, waiting for Cody's approval. No code has been written.
Date: 2026-11-16 (updated the same day with real API results Cody fetched, see section 3b)

## 0. Read this first: what was verified and what wasn't

I tried to query the wiki's API directly, and it didn't work from my side. Two things happened:

1. My cloud environment's network blocks stardewvalleywiki.com, and my web fetch tool got an error on every `api.php` request.
2. I could read the wiki's `robots.txt` (the file where a site tells automated programs what they may visit). It contains:

   ```
   User-Agent: ClaudeBot
   Disallow: /
   ...
   User-agent: *
   #Disallow: /mediawiki/
   Disallow: /Help:
   Disallow: /MediaWiki:
   ```

   This means the wiki asks Anthropic's crawler not to visit any page at all, while ordinary bots (`*`) are allowed to use `/mediawiki/` (where `api.php` lives). I am not going to try to get around that. It also matters for your design (see section 5).

So in this document:

- **Verified** means someone saw it today: robots.txt (me), and the Category:Crops listing plus the Parsnip, Strawberry and Corn pages (Cody ran checks 2 and 3 from section 7 and shared the results). Section 3b has those findings.
- **Standard MediaWiki** means it is how every MediaWiki site works, documented at mediawiki.org. I'm confident in these.
- **To verify** means it's my expectation about this specific wiki, which you will check in section 7 by running a few commands yourself. Your own computer is an ordinary client, so the `*` rules apply to it.

I'd rather hand you a short checklist than present guesses as facts, since "no fabricated data" is a core rule of the project.

## 1. How the MediaWiki API works (plain-language version)

The wiki runs on **MediaWiki**, the same software as Wikipedia. Besides the web pages people read, MediaWiki has a built-in **API** (Application Programming Interface): a URL your program can call that returns data as **JSON** (a text format JavaScript can read directly into objects) instead of a web page.

The endpoint (the single URL you send requests to) is:

```
https://stardewvalleywiki.com/mediawiki/api.php
```

You tell it what you want with **query parameters** (the `?key=value&key=value` part of a URL). The most important one is `action`:

| `action` | What it does | Example use for us |
|---|---|---|
| `query` | Read data about pages: content, revisions, categories, search | Almost everything |
| `parse` | Turn wikitext into HTML, or list a page's templates, sections, links | Reading rendered tables when templates are too messy |
| `expandtemplates` | Show what a template turns into | Debugging price templates |

Inside `action=query` you choose sub-modules:

- `list=search&srsearch=blueberry` searches the wiki (full text).
- `list=categorymembers&cmtitle=Category:Crops` lists every page in a category. This is how we get "all crops" without guessing names.
- `prop=revisions&rvprop=ids|timestamp|content&rvslots=main` returns a page's **wikitext** (the raw markup editors type) plus its **revision id** (a number that changes every time someone edits the page).
- `prop=categories` lists which categories a page is in.
- `prop=info` returns the page's last revision id and URL cheaply, without the content.

Useful extra parameters:

- `format=json&formatversion=2` gives cleaner JSON.
- `titles=Parsnip|Potato|Kale` asks about up to 50 pages in one request. Batching like this is the polite and fast way to work.
- `continue`: when a list is long, the response includes a `continue` object. You send its values back to get the next page of results. Your code must loop on this.
- `maxlag=5` tells the server "skip my request if you're overloaded". Polite bots always send it.

### Revisions are how we keep data fresh

Every record we store keeps the page's `revid`. Later, an update job can ask `prop=info` for all our pages (50 at a time) and only re-download pages whose `lastrevid` changed. That's cheap, avoids hammering the wiki, and gives you the "revision or verification information" the brief asks for.

## 2. What can be retrieved directly

| Data | How | Clean? |
|---|---|---|
| Page title, page id, URL | `prop=info` | Yes |
| Revision id and timestamp | `prop=revisions` | Yes |
| Categories a page belongs to | `prop=categories` | Yes |
| All pages in a category (Crops, Fish, Villagers...) | `list=categorymembers` | Yes, with `continue` |
| Search results | `list=search` | Yes, but we'll use our own local search |
| Page content as wikitext | `prop=revisions&rvprop=content` | Raw text, needs extraction |
| Rendered HTML of a page | `action=parse&prop=text` | HTML, needs extraction |
| Structured data (Cargo / Semantic MediaWiki tables) | `meta=siteinfo&siprop=extensions` | **To verify.** I don't expect this wiki to have them, so plan for no clean JSON, as the brief warns |

The honest summary: the API gives clean **metadata** (titles, revisions, categories). The **game facts** (prices, seasons, growth days) are inside wikitext and need extraction code that we write and test.

## 3. How crop and item data can be extracted

### Infoboxes (one page = one item)

Most item pages start with an **infobox**: the summary box on the right side of the page. In wikitext it's a **template call**, which looks like this (my first guess, written before we had real data; the verified version is in section 3b):

```
{{Infobox
|name        = Parsnip
|season      = Spring
|growth      = 4 days
|seed        = Parsnip Seeds
|sellprice   = 35
...
}}
```

A template call is basically a function call: `{{Name |param=value |param=value}}`. Extracting it means finding the template, splitting it into `param = value` pairs, and cleaning each value. That's a well-understood job, and there's a small, focused npm library called `wikiparser-node` (or we write a ~50-line parser ourselves, which is good practice). I'll recommend one when we start Phase 2.

### What makes it messy (expected, to verify on real pages)

- **Values often contain more markup.** A price might be `{{Price|35}}`, a season might be `[[Spring]]` (a link), or there may be several values separated by `•` or `<br>`. We need a "cleaning" step per field.
- **Quality prices** (silver, gold, iridium) and profession bonuses are often calculated by templates or Lua modules (small programs on the wiki, called with `{{#invoke:...}}`). The raw wikitext may only hold the base price. That's actually fine: the brief says calculations belong in our code, so we store the base price and compute the rest, documenting the formula and which wiki page it came from.
- **Templates differ by category.** Crops, fish, and villagers may use different infobox parameters. Each category gets its own small extractor with its own tests.
- **Some pages in Category:Crops aren't crops** (for example overview pages). The extractor must skip pages without the expected infobox and log them, not guess.
- **Big summary tables** (like the main "Crops" page) are wiki tables built from templates. These are harder to parse than infoboxes. Plan: use per-page infoboxes as the main source and only use summary tables to cross-check.

### Fallback if wikitext is too messy

`action=parse` returns the rendered HTML, where templates are already expanded into final numbers. We can read the infobox's HTML table instead. It's more fragile when the wiki changes its look, so it's a fallback, not the plan.

## 3b. Verified findings from real pages (Cody's results)

Pages checked: Parsnip (revision 191123, edited 2026-02-13), Strawberry (192732, 2026-04-28), Corn (192088, 2026-04-01), and the member list of Category:Crops.

**1. Category:Crops does not list the crops.** It holds 5 overview articles (Crop Growth Calendars, Crops, Flowers, Fruits, Vegetables) and 11 subcategories: Spring crops, Summer crops, Fall crops, Multi-Seasonal crops, Multiple harvest crops, Giant Crops, Trellis Crops, Fruit, Vegetables, Seeds, Trees. Parsnip itself sits in `Category:Spring crops` and `Category:Vegetables`.
**What changes:** the collector lists the members of `Category:Spring crops`, `Summer crops` and `Fall crops`, merges them, and removes duplicates by page id (Corn will appear twice). A page counts as a crop only if its infobox has a `growth` field. Everything else is logged and skipped. Trees (fruit trees) behave differently and wait for a later phase.

**2. The infobox is a generic `{{Infobox}}`, with fields in varying order.** The real Parsnip infobox:

```
{{Infobox
|eng         = Parsnip
|seed        = {{Name|Parsnip Seeds}}
|growth      = 4 days
|season      = Spring
|xp          = 8 [[Farming#Experience Points|Farming XP]]
|sellprice   = 35
|edibility   = 10
|color       = Yellow
}}
```

Corn puts `sellprice` before `xp`, so the parser must read fields **by name, never by position**. Field by field:

| Field | Raw form seen | Cleaning needed |
|---|---|---|
| `eng` | `Parsnip` | none, this is the English name |
| `seed` | `{{Name|Parsnip Seeds}}` | take the first template argument |
| `growth` | `4 days` | take the number |
| `season` | `Spring` **or** `{{Season|Summer}} • {{Season|Fall}}` | handle both forms and split multiple seasons |
| `sellprice` | `35` | plain number, the base (normal quality) price |
| `xp` | `8 [[Farming#...|Farming XP]]` | take the number |
| `edibility` | `10` | plain number (energy and health are formulas, later) |

**3. Regrowth is not in the infobox.** It shows up in two places:
- a cell in the "Stages" wiki table: `|Regrowth: 4 Days` (Strawberry and Corn; Parsnip has no such cell)
- the prose: "continues to produce every 4 days after maturity"

**Plan:** read the `Regrowth: N Days` cell as the source of truth (it's the more structured of the two). If the cell is missing, store "does not regrow". Use the prose sentence only as a cross-check in tests, and log any page where the two disagree.

**4. Growth is also broken into stages.** The same table lists the days per stage (Corn: 2, 3, 3, 3, 3 = 14). The PoC doesn't need these, but fertilizer speed boosts (Speed-Gro) act on stages, so they'll matter for profit calculations later. We can extract them from the same table at almost no extra cost.

**5. Harvest yield is only in prose.** Example: "each Strawberry plant gives 1 Strawberry every 4 days, with a 2% chance for more Strawberries." That's too loose to parse reliably for the PoC, so `harvest_yield` stays NULL for now and gets a dedicated extractor and tests later.

**6. Seed buy prices are not on crop pages.** The crop page names the seed (`{{Name|Parsnip Seeds}}`) but not what it costs. Buy prices will come from the seed pages or shop pages in a later step. So the PoC can show sell prices but not profit yet.

**7. Processing data exists as tables on crop pages.** Corn's "Artisan Goods" section has a wiki table showing Oil, made in the Oil Maker, selling for `{{Price|100}}`. This is a good source for the future `processing_recipes` table.

**8. Ignore these parts of the page:** `{{#lst:Crop Growth Calendars|...}}` (pulls in content from another page), `{{GiftsByItem}}`, the bundle and recipe sections (useful later), and the language links at the bottom (`[[de:Pastinake]]`).

### Key rule

Every extracted value is either parsed from the wiki page we cite, or calculated by our documented code. If a field can't be parsed, it is stored as **missing** (`NULL`), never filled in from memory or another site.

## 4. Limitations and data collection issues

1. **Rate limits.** MediaWiki doesn't publish a hard number for this wiki. Safe practice: one request at a time (never in parallel), a short pause between requests (~1 second), batch 50 titles per request, send `maxlag=5`, and handle errors by waiting and retrying a few times. A full crop download is only a handful of requests.
2. **Identify yourself.** Send a `User-Agent` header like `SDVSearchEngine/0.1 (learning project; contact: <your GitHub URL>)`. Wikis block anonymous scripts more readily than polite named ones.
3. **Cache locally.** Save every raw API response to disk (`data/raw/`) with its date. Then you can re-run and debug your extractor a hundred times without touching the wiki again.
4. **Templates change.** Editors rename parameters. Tests that run the extractor against saved real pages will catch this.
5. **Game versions.** The wiki tracks the latest game version (1.6.x). We store the retrieval date and revision so it's always clear which version of a page a fact came from.
6. **robots.txt** asks ClaudeBot not to crawl anything (section 0). Your collector runs on your machine under the `*` rules, which allow the API. But the AI assistant must **never** fetch the wiki live. It only reads your local database. That's already the brief's rule, and robots.txt gives a second reason for it.

### Licensing

The wiki's text is, to my knowledge, licensed **CC BY-NC-SA** (Creative Commons Attribution, NonCommercial, ShareAlike). **To verify** the exact version on the wiki's copyright page (step 7.5). What it means for us:

- **BY (attribution):** show the source page title and link (which we store anyway), plus a site-wide credit like "Data from the Stardew Valley Wiki, licensed CC BY-NC-SA".
- **NC (noncommercial):** the app can't be sold or monetized with this data.
- **SA (share-alike):** if you publish the extracted dataset, it must use the same license. Your own code can use any license (MIT is common), but put a note in the README that the data is separately licensed.
- **Images** (sprites) come from the game and are copyrighted by ConcernedApe. Don't download or redistribute them. Link to the wiki page instead.

## 5. Proposed initial database schema (SQLite)

Design goals from the brief: no duplication, records connected across categories, every fact traceable to its wiki source.

The core idea: **everything is an item** (a parsnip, a parsnip seed, a jar of pickles, a fish). Category-specific details live in separate tables that point back to the item. Sources live in one table that everything points to.

```sql
-- Where a fact came from. One row per wiki page download.
CREATE TABLE source_pages (
  id            INTEGER PRIMARY KEY,
  page_title    TEXT NOT NULL,
  page_url      TEXT NOT NULL,
  wiki_page_id  INTEGER,
  revision_id   INTEGER NOT NULL,
  revision_time TEXT,              -- when the page was last edited on the wiki
  retrieved_at  TEXT NOT NULL,     -- when WE downloaded it
  category      TEXT,              -- the category we collected it from, e.g. 'Spring crops'
  raw_wikitext  TEXT,              -- kept so we can re-extract without re-downloading
  UNIQUE (page_title, revision_id)
);

-- Every wiki category a page belongs to (Parsnip: 'Spring crops', 'Vegetables').
-- Gives "search by category" for free, straight from the wiki's own labels.
CREATE TABLE page_categories (
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id),
  category       TEXT NOT NULL,
  PRIMARY KEY (source_page_id, category)
);

-- Every thing in the game you can hold, buy, or sell.
CREATE TABLE items (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  item_type       TEXT NOT NULL,   -- 'crop', 'seed', 'fish', 'artisan_good', ...
  base_sell_price INTEGER,         -- NULL when the wiki doesn't state it
  source_page_id  INTEGER NOT NULL REFERENCES source_pages(id)
);

-- Lookup table: Spring, Summer, Fall, Winter.
CREATE TABLE seasons (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Crop-specific growing facts. One row per crop.
CREATE TABLE crops (
  item_id         INTEGER PRIMARY KEY REFERENCES items(id),  -- the harvested item
  seed_item_id    INTEGER REFERENCES items(id),               -- the seed you plant
  growth_days     INTEGER,          -- infobox `growth`
  regrows         INTEGER NOT NULL, -- 0/1: was a "Regrowth: N Days" cell found in the Stages table?
  regrowth_days   INTEGER,          -- from that cell; NULL when regrows = 0
  harvest_yield   TEXT,             -- prose only on the wiki, so NULL in the PoC
  is_trellis      INTEGER,          -- 0/1, from Category:Trellis Crops (later)
  source_page_id  INTEGER NOT NULL REFERENCES source_pages(id)
);

-- Days per growth stage, from the Stages table (Corn: 2,3,3,3,3).
-- Needed later for fertilizer (Speed-Gro) calculations.
CREATE TABLE crop_growth_stages (
  crop_item_id INTEGER NOT NULL REFERENCES crops(item_id),
  stage_number INTEGER NOT NULL,
  days         INTEGER NOT NULL,
  PRIMARY KEY (crop_item_id, stage_number)
);

-- Which seasons a crop grows in (many-to-many, see note below).
CREATE TABLE crop_seasons (
  crop_item_id INTEGER NOT NULL REFERENCES crops(item_id),
  season_id    INTEGER NOT NULL REFERENCES seasons(id),
  PRIMARY KEY (crop_item_id, season_id)
);

-- Shops and what they charge (added in PoC only for seeds).
CREATE TABLE shops (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,      -- "Pierre's General Store"
  source_page_id INTEGER REFERENCES source_pages(id)
);

CREATE TABLE shop_prices (
  shop_id        INTEGER NOT NULL REFERENCES shops(id),
  item_id        INTEGER NOT NULL REFERENCES items(id),
  buy_price      INTEGER NOT NULL,
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id),
  PRIMARY KEY (shop_id, item_id)
);
```

### Why each table exists

- **source_pages**: the attribution backbone. Every fact row points here, so the app (and later the AI) can always answer "where did this come from?" with title, URL, revision and date. Keeping `raw_wikitext` lets us re-run a better extractor without asking the wiki again.
- **items**: one place for names and sell prices, so a parsnip's price isn't copied into five tables (that's what "avoid duplication" means). Search by name or type is a query on this one table.
- **seasons**: a tiny lookup table so "Summer" is spelled one way everywhere and season filters are exact.
- **page_categories**: the wiki already labels pages (Vegetables, Fruits, Trellis Crops...). Storing those labels gives category search and filters without us inventing our own labels.
- **crops**: facts only crops have. Its primary key *is* the item id (a "one-to-one" relationship: each crop is exactly one item). `regrows` is stored separately from `regrowth_days` so that "doesn't regrow" (a fact we found) is never confused with "we couldn't read it" (missing data).
- **crop_growth_stages**: the per-stage days from the Stages table. One row per stage, because the number of stages differs between crops (Parsnip has 4, Corn has 5).
- **Seed items in the PoC:** the crop page names the seed (`{{Name|Parsnip Seeds}}`), so we create a "Parsnip Seeds" item whose source is the crop page that names it. Its buy price stays NULL until we collect seed or shop pages.
- **crop_seasons**: a **join table**. Some crops grow in several seasons (Corn: Summer and Fall), and each season has many crops. That's a "many-to-many" relationship, and the standard way to store it is a table of pairs. "Crops for Summer" becomes a simple join.
- **shops / shop_prices**: buy prices depend on the shop (the same seed can cost different amounts at Pierre's vs JojaMart), so price can't live on the item itself.

### Planned later (not in the PoC)

`fish` (+ `fish_seasons`, `fish_weather`, `locations`), `machines` and `processing_recipes` (input item → machine → output item, e.g. Blueberry → Keg → Blueberry Wine), `villagers`, `crafting_recipes` + `recipe_ingredients`. Artisan prices like wine are often formulas based on the input price. We'd store the formula's source page and compute it in code.

We'll also add a SQLite **FTS5** table (Full-Text Search, built into SQLite) later for fast fuzzy name search. Not needed for the PoC.

## 6. Smallest useful proof of concept

**Goal:** prove the whole pipeline works for one category, crops, from wiki to database to a query, with full attribution.

Steps (each is one small task we'd do together):

1. **Fetch:** a Node script calls `list=categorymembers` for `Category:Spring crops`, `Summer crops` and `Fall crops`, merges the lists, removes duplicates by page id, and saves the result to `data/raw/`.
2. **Download:** fetch wikitext, revision ids and categories (`prop=revisions|categories`) for those titles, 50 per request, one request at a time, and save the raw JSON.
3. **Extract:** parse each page into `{ name, seedName, growthDays, seasons, sellPrice, regrows, regrowthDays, stageDays }`, using the infobox plus the Stages table. Pages without an infobox `growth` field are skipped and logged. Unparseable fields become `null`.
4. **Store:** create the SQLite tables above and insert `source_pages`, `page_categories`, `items` (crops and their seeds), `crops`, `crop_seasons`, `crop_growth_stages`.
5. **Query:** one command-line query, such as "list Summer crops sorted by sell price, with wiki URL". If that output is right and every row has a source link, the PoC is done.
6. **Test:** Vitest tests for the extractor using the 3 real pages Cody already downloaded. These are the "fixtures" (saved sample inputs that tests run against). Expected values come straight from those pages:
   - Parsnip: 4 days, Spring, sells for 35, no regrowth, seed "Parsnip Seeds"
   - Strawberry: 8 days, Spring, sells for 120, regrows every 4 days
   - Corn: 14 days, Summer + Fall (the `{{Season}}` form), sells for 50, regrows every 4 days, stages 2/3/3/3/3

**Stack for the PoC:** Node.js + plain JavaScript, `better-sqlite3` (a simple, synchronous SQLite library, easy for beginners), Vitest, and Node's built-in `fetch`. No React, no TypeScript yet, no AI. I'd suggest moving to TypeScript once the data shapes have settled, because types will then catch real mistakes. I'll explain that trade-off when we get there.

Out of scope for the PoC: shop prices, fish, processing, profit calculations, search UI, AI.

## 7. Verification steps for you (about 10 minutes, no code)

Done so far: checks 2 and 3 (results in section 3b). Still open: 1 (extensions and license), 4 (templates) and 5 (license). Check 4 is optional now that we've seen real wikitext. Check 1 matters, because it confirms the exact license.

These are just URLs you paste into your browser. Each one checks an assumption above. Tell me what you see, or paste the result, and I'll update this doc and the schema before we write any code.

1. **Is there structured data?** Look for "Cargo" or "Semantic" in the extensions list:
   `https://stardewvalleywiki.com/mediawiki/api.php?action=query&meta=siteinfo&siprop=general|extensions|rightsinfo&format=json&formatversion=2`
2. **What does a crop infobox really look like?** Look at the first ~30 lines of the content:
   `https://stardewvalleywiki.com/mediawiki/api.php?action=query&prop=revisions&titles=Parsnip|Strawberry|Corn&rvprop=ids|timestamp|content&rvslots=main&format=json&formatversion=2`
3. **How many crop pages, and are they all crops?**
   `https://stardewvalleywiki.com/mediawiki/api.php?action=query&list=categorymembers&cmtitle=Category:Crops&cmlimit=500&format=json&formatversion=2`
4. **Which templates does a page use?**
   `https://stardewvalleywiki.com/mediawiki/api.php?action=parse&page=Parsnip&prop=templates|categories&format=json&formatversion=2`
5. **Exact license:** the `rightsinfo` part of result 1, or the "Copyrights" link at the bottom of any wiki page.

Tip: Firefox and Chrome both show JSON in a readable, collapsible view.

## 8. Decisions I need from you

1. Approve (or change) the schema and the crops-only proof of concept.
2. Run check 1 in section 7 (license and extensions), or let me treat it as a first small task in Phase 2.
3. Confirm plain JavaScript for the PoC, with TypeScript later.

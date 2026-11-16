# How it works

This explains the project piece by piece, in the order data flows through it.

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

Which field means which shop was checked against each page's own text ("can be purchased at Pierre's General Store, at JojaMart..."). `Not Sold` means no row. A note like `(Year 2+)` is kept in `shop_prices.availability_note`. When a page lists several sell prices (Sunflower Seeds: `20 (harvested)` or `100 (purchased from JojaMart)`), the lowest is stored in `base_sell_price` so estimates never assume the better case, and all of them are kept in `items.sell_price_note`. Seeds nobody sells (Carrot, Ancient Seeds) simply have no price, so their profit isn't calculated.

To get them: save the seed-pages URL from your browser as `data/browser/seeds.json`, then run the same `npm run import -- data/browser/*.json` and `npm run build-db`. The build sends `{{Infobox seed}}` pages to the seed extractor and everything else to the crop extractor.

## 6. Profit: `src/calc/profit.js` and `src/cli/profit.js`

Calculations live in plain functions with tests, never in the AI:

| Function | Example |
|---|---|
| `daysAvailable` | Corn planted Summer 1 → 55 days, because it keeps growing through Fall |
| `countHarvests` | one-time crop: `floor(days ÷ growth)` harvests, one seed each. Regrowing: `1 + floor((days − growth) ÷ regrowth)`, one seed |
| `calculateProfit` | revenue − seed cost, and profit ÷ days. If anything is missing, it returns the reason instead of a number |

`npm run profit -- Spring 10` ranks the season's crops by profit per day for one plant planted on Spring 10, lists what couldn't be calculated and why, and prints every assumption. It also flags data the numbers ignore, like rice's "(6 when irrigated)" or seeds only sold at a festival.

## 7. Searching: `src/db/searchIndex.js` and `src/queries/search.js`

Search reads only the local database. It never contacts the wiki or uses AI.

**The index.** SQLite has a built-in full-text search feature called **FTS5**. A full-text index is like the index at the back of a book: it lists which items contain which text, so searches don't have to read every row. `rebuildSearchIndex()` runs at the end of every `build-db` and stores four pieces of text per item:

| Column | Example (Blueberry Seeds) | Why |
|---|---|---|
| `name` | Blueberry Seeds | the main thing people type |
| `categories` | Summer seeds | the wiki's own labels: "vegetables", "trellis" |
| `shops` | Pierre's General Store | "oasis" finds what the Oasis sells |
| `summary` | Blueberry Seeds are a type of seed. Mature plants yield Blueberries. | the page's opening sentences, as plain text |

That's where "related terms" come from. Every one of them comes from the wiki, not from a list we made up. Categories and summary are only used when the page really is the item's own page: a seed we only know from its crop page (like Grape Starter before its seed page is downloaded) doesn't borrow the crop's categories.

We use the **trigram** tokenizer, which indexes every 3-letter piece of every word. That's why "berry" finds Strawberry and "blueb" finds Blueberry. The trade-off is that search words need at least 3 letters, and the command says so when it skips one.

**Ranking.** With search words, results are ordered by **bm25**, the standard relevance formula for text search. A match in the name counts 10×, in categories or shops 3×, and in the summary 1×, so searching "corn" puts Corn and Corn Seeds above pages that only mention corn.

**Safety.** What the user types is never pasted into SQL. Words are pulled out with a pattern (letters, digits and apostrophes only), each one is quoted for FTS5, and everything is passed to the database as a **parameter** (a value the database treats strictly as data). The sort column comes from a fixed list. A test searches for `"; DROP TABLE items; --` and checks the table is still there.

**Filters and sorting.** `--season` keeps items that grow in that season. Seeds count through the crop they grow into, so `--season fall --type seed` lists Fall seeds. `--sort buy` uses the cheapest shop price, and items nobody sells go last.

**Related records.** `getItemDetails()` gathers everything connected to one item: a crop's growth, stages, regrowth and its seed with every shop price, or a seed's prices and what it grows into. It also returns the wiki categories, the summary, and the source page with its revision and download date. `npm run item` prints it all, and suggests names when the one you typed doesn't exist ("strawbery" → Strawberry).

## 8. Fish: `src/extract/fishExtractor.js` and `src/queries/fishQueries.js`

`Category:Fish` on the wiki only holds the overview page "Fish", so the 71 fish pages to download were read from the tables on that page and listed in `src/collect/fishPages.js` (48 rod fish, 3 Night Market fish, 10 legendary and 10 crab pot fish, in two groups because the API returns at most 50 pages at a time). Seaweed, algae and the jellies are left out because the Fish page says they don't count as fish.

Fish pages use `{{Infobox fish}}`:

```
|location   = [[The Beach|Ocean]] • [[Ginger Island]]
|time       = 6am – 7pm
|season     = {{Season|Summer}} • {{Season|Winter}}<br />'''[[Ginger Island]] (except Island North):''' {{Season|All}}
|weather    = Any
|difficulty = 70
|price      = 100
```

**Seasons.** The season field is often a sentence: Walleye says `Fall • Winter with Rain Totem`. Reading every word as a season would claim you can catch Walleye in any Winter, which isn't true. So when the field is a plain list (`Summer • Winter`, `All`) we use it and check it against the page's season categories (`Category:Summer fish`). When it's a sentence, we use the categories, which list the normal seasons, and keep the sentence in `fish.season_note`. The build prints a **note** for each of those 9 fish.

**Where.** The kinds of water (Ocean, River, Lake, Pond, The Mines, ...) come from the categories (`Category:Ocean fish`) into `fish_areas`. The infobox's exact wording ("River • Mountain Lake • Forest Pond") is kept in `location_note`. Crab pot fish have a `source` field ("Crab Pot: Saltwater") instead, so that's used.

**Weather.** `Any`, `Sun` or `Rain` goes in `fish.weather`. Anything longer (Rainbow Trout: "Sun; Any during Trout Derby") leaves `weather` empty and keeps the text in `weather_note`. A weather search (`npm run fish -- Summer --weather rain`) lists fish whose weather is Rain or Any, plus crab pot fish, and names the ones with longer rules separately so you can check them, rather than guessing.

**Time** is kept as text ("6am – 11am; 6pm – 2am"). Legendary fish also store the fishing level they need (`fl`).

## 9. Artisan goods: `src/extract/artisanExtractor.js` and `src/queries/artisanQueries.js`

Three kinds of page go in:

- **Machine pages** (Keg, Preserves Jar, Cheese Press, Bee House, Oil Maker, Dehydrator, Fish Smoker, Loom, Mayonnaise Machine, Cask, Tapper). Each has a products table: what goes in, what comes out, how long, and the price. These tables are the main source of recipes, because they list every product, even ones without their own page (Jelly, Pickles, Vinegar), and every ingredient separately (Oil from Corn takes 1000 minutes, from Sunflower 60).
- **Goods pages** (Wine, Cheese...) in `Category:Artisan Goods`. They give the item itself (with its own page as the source) and are checked against the machine tables: a different fixed price becomes a **warning**. They also add exceptions the table leaves out (Juice "other than Wheat, Hops & Tea Leaves"). Goods that no table lists (the Tapper's syrups) take their recipe from their own page, with a **note**.
- **The Fruits page.** The wiki has a `Category:Vegetables` but no fruit category, so "Any Fruit" is read from the table on the Fruits page (27 fruits with their base prices) into `item_groups`.

Machine tables use `rowspan` (one Oil row covering three ingredients) and `colspan`, so `parseTableWithSpans()` in `wikitext.js` lays the cells out on a grid and repeats a spanning cell in each row it covers.

**Prices that depend on the ingredient** are stored as a multiplier and a bonus, read from the wiki's own formula: Wine "3 × Fruit Base Price" → 3 and 0, Jelly "2 × Base Fruit Price + 50" → 2 and 50. `npm run artisan -- Starfruit` then works the value out in code: Wine 3 × 750 = 2250g, Jelly 2 × 750 + 50 = 1550g, Dried Fruit needs 5 Starfruit for 7.5 × 750 + 25 = 5650g, so 1130g per Starfruit. Values are shown exactly as the formula gives them (Juice from a 35g Parsnip is 78.75g); the wiki doesn't say how the game rounds that, so we don't round it.

**Time.** The machine tables give minutes. The game clock runs 1600 minutes a day (the Keg page explains: 1200 from 6am to 2am, then 400 from 2am to 6am), so 10000 minutes of Wine is 6.25 days. Times the wiki gives as days or nights ("1 day (ready the next morning)", "4 Nights") stay as text.

What "Any X" means:

| Group | Comes from |
|---|---|
| Fruits | the Fruits page |
| Vegetables | the item's own page is in `Category:Vegetables` |
| Fish | the item is in the fish table |
| Mushrooms, Forage, Roe | not collected yet (later phases), so nothing matches them yet |

## 10. Cooking: `src/extract/cookingExtractor.js` and `src/queries/cookingQueries.js`

The 81 dish pages come from the tables on the Cooking page (revision 195432), in two downloads of at most 50 pages. Each dish page wraps its infobox as `{{{{{1|Infobox cooking}}}`, so the same text can also be shown as a row of the Cooking page's table. On the dish's own page that means `{{Infobox cooking ...}}`, so the extractor turns the wrapper into a plain infobox call before reading it.

From each infobox we keep:

| Field | Example (Pizza) |
|---|---|
| sell price | 300 |
| edibility (can be negative) | 60 |
| ingredients, in order | Wheat Flour ×1, Tomato ×1, Cheese ×1 |
| buffs and how long they last | none for Pizza; Lobster Bisque gives "Fishing +3" |
| how you get the recipe | "The Queen of Sauce: 7 Spring, Year 2; Stardrop Saloon for 150g" |

**Ingredients** are stored as rows in `dish_ingredients`, one per ingredient, by name. "Any [[Fish]] (1)" (Sashimi, Maki Roll) is stored as the group Fish, using the same groups as artisan goods, so `npm run cook -- Tuna` finds Sashimi.

**What the ingredients are worth** is worked out in code: the sell prices of the ingredients we have, times the quantities. If any ingredient's price is unknown (an item we don't collect yet, or "any Fish"), the total is left empty rather than guessed. Fish Taco sells for 500g; its raw ingredients (Tuna, Tortilla, Red Cabbage, Mayonnaise) are worth 600g.

## 11. Crafting: `src/extract/craftingExtractor.js` and `src/queries/craftingQueries.js`

Every crafting recipe comes from one page: the Crafting page (revision 195392). It has a table per section (Bombs, Fences, Sprinklers, Artisan Equipment, Fertilizer, Seeds, Decor, Fishing, Rings, Edible Items, Consumables, Lighting, Refining Equipment, Furniture, Storage Equipment, Signs, Misc), 150 recipes in all. Each row gives the item, its ingredients and how you get the recipe. `Category:Crafting` holds only the Crafting page itself, so there was nothing else to download.

What we read from each row:

| Cell | Example | Stored as |
|---|---|---|
| Name | `[[Speed-Gro]] (5)` | Speed-Gro, and one craft makes 5 |
| Name with a second name | `Wild Seeds (Sp)<br />([[Spring Seeds]])` | Spring Seeds, also called "Wild Seeds (Sp)" |
| Ingredients | `{{Name|Sap|4}} Any [[Fish]] (1)` | Sap ×4, any Fish ×1 (rows in `crafting_ingredients`) |
| Recipe source | `[[File:...]] [[Farming]] Level 9` | "Farming Level 9" |
| Extra columns | Radius (bombs), Duration (fences), Energy and Health (edible items) | one line of text, e.g. "Energy: 45; Health: 18" |
| Sell price | only in the Bombs table | the item's sell price |

Some cells needed care:

- The Fences table has two header rows ("Duration" over "Days" and "Seasons"), so its columns become "Duration (days)" and "Duration (seasons)".
- The Crab Pot has a second, cheaper recipe for the Trapper profession on a new line. Only the first is stored as ingredients; the second is kept as a note.
- Tea Sapling takes "Wild Seeds (Any) (2)". The Seeds table marks the four wild seed packs with "Wild Seeds (Sp)" and so on, so those four become the group "Wild Seeds" in `item_groups`, and `npm run craft -- Spring Seeds` finds Tea Sapling.
- Links are turned into their text before reading `{{NPC|...}}`, because `{{NPC|Linus|[[Quests#Community Cleanup|Special Order]]}}` has a `|` inside the link. Qi Gem prices (`{{Price|20|Gem}}`) read "20 Qi Gems", not "20g".

**Which page an item cites.** Items that already have their own page (the Keg, Bee House and other machines) keep it as their source, and the crafting recipe cites the Crafting page separately; `npm run item -- Keg` shows both. The Crafting page is saved after every other page, so this works whatever order the pages come in. Items we only know from the Crafting page become type `crafted` and cite it. Their summary is left empty, because the Crafting page's opening is about crafting in general.

In search, each crafted item also gets its section ("Crafting: Rings") next to its categories, so `npm run search -- consumables` finds the Rain Totem and the Warp Totems.

## 12. Tests: `tests/`

| File | Checks |
|---|---|
| `collector.test.js` | URL building, duplicate removal, following `continue` (with a fake `fetch`, so no internet) |
| `wikitext.test.js` | each wikitext helper on small examples |
| `cropExtractor.test.js` | the real Parsnip, Strawberry and Corn pages give exactly the values a person reads off the page |
| `database.test.js` | the full pipeline into an in-memory database, attribution on every result, no duplicates on a rebuild, cheapest seed price |
| `seedExtractor.test.js` | real seed pages: Pierre/JojaMart/Oasis prices, Year 2+ notes, festival prices, seeds no shop sells |
| `profit.test.js` | harvest counts and profit worked out by hand for Parsnip, Strawberry and Corn |
| `fishExtractor.test.js` | real fish pages: plain vs. conditional seasons, two time windows, crab pot fish, legendary fish, Night Market fish, unclear weather |
| `fish.test.js` | fish into an in-memory database, the season/weather/area filters, fish in search and item details |
| `artisanExtractor.test.js` | real machine and goods pages: rowspan tables, price formulas, times, ingredient alternatives and exceptions, the Fruits list |
| `artisan.test.js` | crops + fish + artisan pages into one database, "what can I make from this" values worked out by hand, exclusions, machines in search |
| `cookingExtractor.test.js` | real dish pages: the infobox wrapper, "any Fish" ingredients, recipe sources (TV, shops, friendship mail), buffs and how long they last |
| `cooking.test.js` | dishes into one database with crops, fish and artisan goods, "what can I cook with this", ingredient values, dishes in search and item details |
| `craftingExtractor.test.js` | the real Crafting page: names with quantities and second names, "any Fish" and "Wild Seeds (Any)", the Crab Pot's second recipe, recipe sources, two header rows, all 150 recipes |
| `crafting.test.js` | the Crafting page with crop, fish and artisan pages: machines keep their own page, "what can I craft with this" through names and groups, sections, crafted items in search and item details |
| `search.test.js` | partial words, related terms, all-words matching, every filter and sort, hostile input, item details, typo suggestions |

Run them with `npm test`.

## If the wiki refuses the collector

If `npm run collect` stops with **HTTP 403**, the site refused the program on purpose. The error message prints the `server` and `cf-mitigated` headers and the start of the page that came back, which shows who refused it (for example a Cloudflare bot check).

This happened on the first real run (November 2026). Testing showed the wiki accepts `curl` with our name tag but refuses Node.js with the same name tag and URL, so the firewall is judging the *program*, not what it asks for. Swapping to another program just because it isn't recognised yet would be slipping past a rule, so we don't.

We **don't** get around a refusal by pretending to be a web browser. The wiki decides who may use it automatically. Instead:

1. Save the API responses from your browser, which the wiki does allow, and build the database from those files. `npm run import` prints the 3 URLs to save (one per season). Each uses a **generator**, which tells the API "take the members of this category and give me their page content", so one URL returns every crop in that season. `npm run import -- data/browser/*.json` then merges the files into the same `data/raw/` format that `collect` makes. It uses each file's save time as the download date, and warns if a file is incomplete.
2. If we need regular automated access later, ask the wiki's administrators.

## Known limitations (so far)

- Crops in the Spring, Summer and Fall categories, their seeds, 71 fish, the artisan goods, 81 dishes and 150 crafting recipes. Villagers, fruit trees, forage and more come in the next phases.
- Cask aging (silver to iridium quality) and the Heavy Tapper's own page aren't stored yet. Recipes that take mushrooms, forage or roe are stored, but those items aren't collected yet.
- Dish ingredients we don't collect yet (Egg, Milk, Wheat Flour, Sugar, Oil, Rice...) are shown by name without a price or wiki link until later phases add them.
- Crafted items have no sell price except bombs, because only the Bombs table on the Crafting page lists one. Their own pages would add it.
- "Transmute (Fe)" and "Transmute (Au)" are stored by their recipe names, as the Crafting page lists them; they make an Iron Bar and a Gold Bar.
- Crafting ingredients we don't collect yet (Wood, Stone, ores and bars...) are shown by name only, until later phases add them.
- Artisan values ignore the Artisan profession (+40%) and ingredient quality.
- Profit doesn't model when a shop is open (Strawberry Seeds are only sold at the Egg Festival) or fertilizer, quality and professions.
- Traveling Cart prices are random, so seeds only sold there have no price.
- Search covers only what's in the database, and search words need 3+ letters.
- Fish times are stored as text, so you can't yet ask "what can I catch at 8pm". The legendary fish of Mr. Qi's quest (Legend II and the others) show all seasons, because the wiki lists them as "Any", but they can only be caught while that quest is active.
- Harvest yield ("1, with a 2% chance for more") is only written as a sentence on the wiki, so it isn't stored yet.
- Sell price is base quality only. Quality and profession bonuses will be calculated in code later, with their formulas documented.
- The exact license version still needs confirming on the wiki's copyright page.

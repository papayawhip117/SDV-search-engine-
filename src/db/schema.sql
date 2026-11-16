-- Database tables for the SDV Search Engine.
-- The reasons behind each table are in docs/phase-1-research.md, section 5.
--
-- "IF NOT EXISTS" makes this file safe to run again on an existing database.

PRAGMA foreign_keys = ON;  -- make SQLite enforce the REFERENCES rules below

-- Where a fact came from. One row per downloaded revision of a wiki page.
CREATE TABLE IF NOT EXISTS source_pages (
  id            INTEGER PRIMARY KEY,
  page_title    TEXT    NOT NULL,
  page_url      TEXT    NOT NULL,
  wiki_page_id  INTEGER,
  revision_id   INTEGER NOT NULL,
  revision_time TEXT,              -- when the page was last edited on the wiki
  retrieved_at  TEXT    NOT NULL,  -- when WE downloaded it
  category      TEXT,              -- the category we collected it from, e.g. 'Spring crops'
  raw_wikitext  TEXT,              -- kept so we can re-extract without re-downloading
  UNIQUE (page_title, revision_id)
);

-- Every wiki category a page belongs to (Parsnip: 'Spring crops', 'Vegetables').
CREATE TABLE IF NOT EXISTS page_categories (
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id),
  category       TEXT    NOT NULL,
  PRIMARY KEY (source_page_id, category)
);

-- Everything in the game you can hold, buy or sell.
CREATE TABLE IF NOT EXISTS items (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE,
  item_type       TEXT    NOT NULL,   -- 'crop', 'seed', ...
  base_sell_price INTEGER,            -- NULL when the wiki doesn't state it
  sell_price_note TEXT,               -- all prices when the wiki lists several (Sunflower Seeds)
  source_page_id  INTEGER NOT NULL REFERENCES source_pages(id)
);

-- Lookup table: Spring, Summer, Fall, Winter.
CREATE TABLE IF NOT EXISTS seasons (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
INSERT OR IGNORE INTO seasons (id, name) VALUES (1, 'Spring'), (2, 'Summer'), (3, 'Fall'), (4, 'Winter');

-- Crop-specific growing facts. One row per crop; item_id is the harvested item.
CREATE TABLE IF NOT EXISTS crops (
  item_id        INTEGER PRIMARY KEY REFERENCES items(id),
  seed_item_id   INTEGER REFERENCES items(id),
  growth_days    INTEGER,
  growth_note    TEXT,      -- extra text after the days, e.g. '(6 when irrigated)'
  regrows        INTEGER,   -- 1 = yes, 0 = no, NULL = the page didn't tell us
  regrowth_days  INTEGER,   -- NULL when regrows is not 1
  harvest_yield  TEXT,      -- only in prose on the wiki, so NULL for now
  is_trellis     INTEGER,   -- 1/0 from Category:Trellis Crops, NULL if unknown
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id)
);

-- Which seasons a crop grows in (many-to-many: Corn → Summer and Fall).
CREATE TABLE IF NOT EXISTS crop_seasons (
  crop_item_id INTEGER NOT NULL REFERENCES crops(item_id),
  season_id    INTEGER NOT NULL REFERENCES seasons(id),
  PRIMARY KEY (crop_item_id, season_id)
);

-- Days per growth stage, from the Stages table (Corn: 2, 3, 3, 3, 3).
CREATE TABLE IF NOT EXISTS crop_growth_stages (
  crop_item_id INTEGER NOT NULL REFERENCES crops(item_id),
  stage_number INTEGER NOT NULL,
  days         INTEGER NOT NULL,
  PRIMARY KEY (crop_item_id, stage_number)
);

-- Shops and what they charge, filled from the seed pages' infoboxes.
-- Each shop row is created the first time a price mentions it.
CREATE TABLE IF NOT EXISTS shops (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  source_page_id INTEGER REFERENCES source_pages(id)
);

CREATE TABLE IF NOT EXISTS shop_prices (
  shop_id        INTEGER NOT NULL REFERENCES shops(id),
  item_id        INTEGER NOT NULL REFERENCES items(id),
  buy_price         INTEGER NOT NULL,
  availability_note TEXT,   -- e.g. '(Year 2+)', copied from the wiki
  source_page_id    INTEGER NOT NULL REFERENCES source_pages(id),
  PRIMARY KEY (shop_id, item_id)
);

-- Fish facts, from {{Infobox fish}}. One row per fish; item_id is the fish item.
-- The *_note columns keep the wiki's own wording where it says more than
-- the structured columns can hold ("Anytime during Night Market").
CREATE TABLE IF NOT EXISTS fish (
  item_id            INTEGER PRIMARY KEY REFERENCES items(id),
  catch_method       TEXT    NOT NULL,  -- 'fishing rod' or 'crab pot'
  is_legendary       INTEGER NOT NULL,  -- 1/0, from Category:Legendary fish
  location_note      TEXT,              -- e.g. 'River • Mountain Lake'
  time_note          TEXT,              -- e.g. '6am – 11am; 6pm – 2am', 'Any'
  season_note        TEXT,              -- the infobox text when it's more than a list of seasons
  weather            TEXT,              -- 'Any', 'Sun' or 'Rain'; NULL when it's more complicated
  weather_note       TEXT,              -- e.g. 'Sun; Any during Trout Derby'
  difficulty         INTEGER,           -- NULL for crab pot fish
  behavior           TEXT,              -- 'Mixed', 'Dart', 'Smooth', 'Sinker', 'Floater'
  size_min_inches    INTEGER,
  size_max_inches    INTEGER,
  fishing_level      INTEGER,           -- level needed (legendary fish), else NULL
  fishing_level_note TEXT,              -- e.g. '(Forge)'
  source_page_id     INTEGER NOT NULL REFERENCES source_pages(id)
);

-- Which seasons a fish can be caught in (see fishExtractor.js for where they come from).
CREATE TABLE IF NOT EXISTS fish_seasons (
  fish_item_id INTEGER NOT NULL REFERENCES fish(item_id),
  season_id    INTEGER NOT NULL REFERENCES seasons(id),
  PRIMARY KEY (fish_item_id, season_id)
);

-- Kinds of water a fish lives in, from the wiki's categories
-- (Category:Ocean fish → 'Ocean'). Exact spots are in fish.location_note.
CREATE TABLE IF NOT EXISTS fish_areas (
  fish_item_id INTEGER NOT NULL REFERENCES fish(item_id),
  area         TEXT    NOT NULL,
  PRIMARY KEY (fish_item_id, area)
);

-- Artisan equipment (Keg, Preserves Jar...). item_id is the machine as an item.
CREATE TABLE IF NOT EXISTS machines (
  item_id        INTEGER PRIMARY KEY REFERENCES items(id),
  recipe_source  TEXT,   -- how you get the recipe, e.g. 'Farming Level 8'
  ingredients    TEXT,   -- what it's crafted from, e.g. 'Wood ×30, Copper Bar ×1'
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id)
);

-- What each machine turns into what. One row per way of making a product:
-- Cheese from Milk and Cheese from Large Milk are two rows.
-- The input is either one item (input_name) or any item of a group
-- (input_group: 'Fruits', 'Vegetables', 'Fish'...), minus input_exclusions.
-- The price is either fixed (sell_price) or depends on the input:
--   price = price_multiplier × the input's base sell price + price_bonus
CREATE TABLE IF NOT EXISTS artisan_recipes (
  id                INTEGER PRIMARY KEY,
  machine_name      TEXT    NOT NULL,   -- 'Keg' ('Heavy Tapper' has no page of its own yet)
  product_item_id   INTEGER NOT NULL REFERENCES items(id),
  output_quantity   INTEGER NOT NULL,   -- Vinegar: 2 per Rice
  input_name        TEXT,               -- 'Wheat'
  input_group       TEXT,               -- 'Fruits'
  input_quantity    INTEGER,            -- NULL when nothing is used up (Bee House flowers, Tapper trees)
  input_exclusions  TEXT,               -- 'Grape' or 'Wheat | Hops | Tea Leaves'
  input_note        TEXT,               -- the wiki's own wording
  minutes           INTEGER,            -- NULL when the wiki gives days, not minutes
  time_note         TEXT,
  sell_price        INTEGER,
  price_multiplier  REAL,
  price_bonus       INTEGER,
  price_note        TEXT,               -- e.g. '3 × Base Fruit Price'
  source_page_id    INTEGER NOT NULL REFERENCES source_pages(id)
);

-- Lists of items the wiki keeps on a page instead of in a category.
-- So far: the Fruits page, which says what "Any Fruit" means.
CREATE TABLE IF NOT EXISTS item_groups (
  group_name     TEXT    NOT NULL,   -- 'Fruits'
  item_name      TEXT    NOT NULL,   -- 'Apple' (not every fruit is in items yet)
  base_price     INTEGER,            -- the base sell price listed on that page
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id),
  PRIMARY KEY (group_name, item_name)
);

-- Cooked dishes, from {{Infobox cooking}}. item_id is the dish as an item.
CREATE TABLE IF NOT EXISTS dishes (
  item_id        INTEGER PRIMARY KEY REFERENCES items(id),
  edibility      INTEGER,   -- the wiki's edibility number (energy and health come from it)
  buffs          TEXT,      -- e.g. 'Farming +2, Max Energy +50'
  buff_duration  TEXT,      -- e.g. '7m'
  recipe_source  TEXT,      -- e.g. 'The Queen of Sauce: 7 Spring, Year 2; Stardrop Saloon for 150g'
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id)
);

-- What goes into each dish, in the order the wiki lists it. Either one item
-- (ingredient_name, which may not be in items yet: Wheat Flour, Sugar...)
-- or any item of a group (ingredient_group 'Fish' for Sashimi).
CREATE TABLE IF NOT EXISTS dish_ingredients (
  dish_item_id     INTEGER NOT NULL REFERENCES dishes(item_id),
  position         INTEGER NOT NULL,
  ingredient_name  TEXT,
  ingredient_group TEXT,
  quantity         INTEGER NOT NULL,
  PRIMARY KEY (dish_item_id, position)
);

-- Crafting recipes, all read from the wiki's Crafting page. item_id is the
-- crafted item. Items that already exist (Keg, Spring Seeds...) keep their
-- own type and source; this table adds how to craft them.
CREATE TABLE IF NOT EXISTS crafting_recipes (
  item_id          INTEGER PRIMARY KEY REFERENCES items(id),
  position         INTEGER NOT NULL,  -- order on the Crafting page
  section          TEXT,      -- the Crafting page section: 'Sprinklers', 'Fertilizer'...
  output_quantity  INTEGER NOT NULL,  -- how many one craft makes (Speed-Gro: 5)
  name_note        TEXT,      -- another name on the page, e.g. 'Wild Seeds (Sp)'
  details          TEXT,      -- extra columns, e.g. 'Radius: 3' or 'Energy: 45; Health: 18'
  recipe_source    TEXT,      -- e.g. 'Farming Level 2' or 'Carpenter''s Shop for 100g'
  ingredients_note TEXT,      -- e.g. the Crab Pot's cheaper recipe with the Trapper profession
  source_page_id   INTEGER NOT NULL REFERENCES source_pages(id)
);

-- What goes into each crafting recipe, in the wiki's order. Like
-- dish_ingredients: one item by name, or any item of a group ('Fish').
CREATE TABLE IF NOT EXISTS crafting_ingredients (
  crafted_item_id  INTEGER NOT NULL REFERENCES crafting_recipes(item_id),
  position         INTEGER NOT NULL,
  ingredient_name  TEXT,
  ingredient_group TEXT,
  quantity         INTEGER NOT NULL,
  PRIMARY KEY (crafted_item_id, position)
);

-- Villagers who take gifts, from the List of All Gifts page (birthdays)
-- and the Villagers page (who can be married).
CREATE TABLE IF NOT EXISTS villagers (
  id                  INTEGER PRIMARY KEY,
  name                TEXT    NOT NULL UNIQUE,
  birthday_season     TEXT,      -- 'Summer'
  birthday_day        INTEGER,   -- 13
  marriageable        INTEGER,   -- 1/0 from the Villagers page, NULL if we don't have that page
  source_page_id      INTEGER NOT NULL REFERENCES source_pages(id),  -- the gift list
  villagers_page_id   INTEGER REFERENCES source_pages(id)            -- the Villagers page
);

-- Gift tastes, one row per line of the wiki's lists. villager_id NULL means
-- universal (everyone). Each row is one item (item_name) or a group
-- (group_name, e.g. 'Fruits') with exceptions; which items are in a group is
-- worked out when the database is asked (src/queries/giftQueries.js).
CREATE TABLE IF NOT EXISTS gift_tastes (
  id             INTEGER PRIMARY KEY,
  villager_id    INTEGER REFERENCES villagers(id),
  taste          TEXT    NOT NULL CHECK (taste IN ('love', 'like', 'neutral', 'dislike', 'hate')),
  item_name      TEXT,
  group_name     TEXT,
  exceptions     TEXT,      -- names separated by ' | ', e.g. 'Fruit Tree Fruit | Salmonberry'
  note           TEXT,      -- the wiki's wording, e.g. 'All Fruit (except Salmonberry)' or '+250'
  position       INTEGER NOT NULL,  -- order on the page
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id)
);

-- Full-text search index (SQLite's built-in FTS5). One row per item.
-- It's filled from the tables above by rebuildSearchIndex() after each build,
-- so it never holds facts of its own, only text to search through.
-- The "trigram" tokenizer matches any 3+ letters inside a word, so
-- "berry" finds Strawberry and Blueberry Seeds.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  name,
  categories,
  shops,
  summary,
  item_id UNINDEXED,
  tokenize = 'trigram remove_diacritics 1'
);

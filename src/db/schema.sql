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
  regrows        INTEGER,   -- 1 = yes, 0 = no, NULL = the page didn't tell us
  regrowth_days  INTEGER,   -- NULL when regrows is not 1
  harvest_yield  TEXT,      -- only in prose on the wiki, so NULL for now
  is_trellis     INTEGER,   -- filled in a later phase
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

-- Shops and what they charge. Created now so the design is complete;
-- filled in a later phase from seed and shop pages.
CREATE TABLE IF NOT EXISTS shops (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  source_page_id INTEGER REFERENCES source_pages(id)
);

CREATE TABLE IF NOT EXISTS shop_prices (
  shop_id        INTEGER NOT NULL REFERENCES shops(id),
  item_id        INTEGER NOT NULL REFERENCES items(id),
  buy_price      INTEGER NOT NULL,
  source_page_id INTEGER NOT NULL REFERENCES source_pages(id),
  PRIMARY KEY (shop_id, item_id)
);

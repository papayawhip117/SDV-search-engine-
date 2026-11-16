// The artisan pages to download.
//
// Read from the wiki's "Artisan Goods" page (revision 195351) and its
// category, saved 2026-11-16. The six "... Productivity" pages in the
// category are calculators, not items, so they're left out. The machines
// are the ones that page describes, plus the Tapper (Maple Syrup, Oak Resin...).
// The Fruits page lists every fruit, which the wiki has no category for.

import { MACHINE_PAGES } from '../extract/artisanExtractor.js';

export const ARTISAN_GOODS_PAGES = [
  'Aged Roe', 'Beer', 'Caviar', 'Cheese', 'Cloth', 'Coffee', 'Dinosaur Mayonnaise', 'Dried Fruit',
  'Dried Mushrooms', 'Duck Mayonnaise', 'Goat Cheese', 'Green Tea', 'Honey', 'Jellies and Pickles', 'Juice',
  'Maple Syrup', 'Mayonnaise', 'Mead', 'Mystic Syrup', 'Oak Resin', 'Oil', 'Pale Ale', 'Pine Tar', 'Raisins',
  'Smoked Fish', 'Truffle Oil', 'Void Mayonnaise', 'Wine',
];

/** One request: the 28 goods and 11 machines (the API allows 50 pages). */
export const ARTISAN_PAGES = [...ARTISAN_GOODS_PAGES, ...MACHINE_PAGES];

export const FRUIT_LIST_PAGE = 'Fruits';

// Fills the full-text search index from the database.
//
// For every item we index three pieces of text:
//   name        "Blueberry Seeds"
//   categories  the wiki's own categories for its page ("Summer seeds")
//   shops       the shops that sell it ("Pierre's General Store | JojaMart")
//   summary     the opening sentence(s) of its wiki page, as plain text
//
// Searching more than the name is what makes "related terms" work:
// "trellis" finds Grape through Category:Trellis Crops, and "oasis" finds
// the seeds sold at the Oasis.

import { extractSummary } from '../extract/wikitext.js';

export function rebuildSearchIndex(db) {
  const items = db
    .prepare(
      `SELECT i.id, i.name, sp.raw_wikitext AS wikitext,
              sp.page_title AS pageTitle,
              (SELECT group_concat(pc.category, ' | ') FROM page_categories pc WHERE pc.source_page_id = sp.id) AS categories,
              (SELECT group_concat(sh.name, ' | ') FROM shop_prices p JOIN shops sh ON sh.id = p.shop_id WHERE p.item_id = i.id) AS shops,
              (SELECT 'Crafting: ' || r.section FROM crafting_recipes r WHERE r.item_id = i.id) AS craftingSection,
              (SELECT group_concat(ci.page_title || ': ' || replace(ci.sections, ' | ', ', '), ' | ')
                 FROM collection_items ci WHERE ci.item_id = i.id) AS collectionSections
       FROM items i
       JOIN source_pages sp ON sp.id = i.source_page_id`,
    )
    .all();

  const insert = db.prepare('INSERT INTO search_index (name, categories, shops, summary, item_id) VALUES (?, ?, ?, ?, ?)');
  const rebuild = db.transaction(() => {
    db.prepare('DELETE FROM search_index').run();
    for (const item of items) {
      // A seed without a page of its own (Grape Starter) points at its crop's
      // page. That page's categories and summary describe the crop, not the
      // seed, so we only index them when the page really is this item's page.
      const ownPage = item.pageTitle.toLowerCase() === item.name.toLowerCase();
      const summary = ownPage ? extractSummary(item.wikitext) ?? '' : '';
      // Crafted items also get their Crafting page section ("Crafting: Rings"),
      // so "ring" or "fertilizer" finds every recipe in that section.
      // Items from an overview page get their table too ("Minerals: Gems", "Foraging: Spring, Fall").
      const categories = [ownPage ? item.categories : null, item.craftingSection, item.collectionSections]
        .filter(Boolean)
        .join(' | ');
      insert.run(item.name, categories, item.shops ?? '', summary, item.id);
    }
  });
  rebuild();
  return items.length;
}

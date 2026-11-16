// Crafting: what a recipe needs, and what you can craft with an item.
//
//   getCraftingRecipe(db, 'Sprinkler')            → Copper Bar ×1, Iron Bar ×1, from Farming Level 2
//   getCraftedUsing(db, 'Iron Bar')               → Sprinkler, Quality Sprinkler, Crab Pot...
//   getCraftingRecipes(db, { section: 'Rings' })  → every ring recipe
//
// All recipes come from the wiki's Crafting page, so each result cites that page.

import { groupsOf } from './artisanQueries.js';

/** The ingredients of one crafting recipe, in the wiki's order, with what we know about each. */
export function getCraftingIngredients(db, itemName) {
  return db
    .prepare(
      `SELECT ci.ingredient_name AS name, ci.ingredient_group AS "group", ci.quantity,
              i.base_sell_price AS sellPrice, sp.page_url AS sourceUrl
       FROM crafting_ingredients ci
       JOIN items c ON c.id = ci.crafted_item_id
       LEFT JOIN items i ON i.name = ci.ingredient_name
       LEFT JOIN source_pages sp ON sp.id = i.source_page_id
       WHERE c.name = ? COLLATE NOCASE
       ORDER BY ci.position`,
    )
    .all(itemName)
    .map((row) => ({ ...row, known: row.sourceUrl !== null }));
}

const RECIPE_COLUMNS = `
  c.name              AS name,
  r.section           AS section,
  r.output_quantity   AS outputQuantity,
  r.name_note         AS nameNote,
  r.details           AS details,
  r.recipe_source     AS recipeSource,
  r.ingredients_note  AS ingredientsNote,
  sp.page_url         AS sourceUrl,
  sp.revision_id      AS revisionId`;

function withIngredients(db, rows) {
  return rows.map((row) => ({ ...row, ingredients: getCraftingIngredients(db, row.name) }));
}

/** One crafting recipe by the crafted item's name, or null. */
export function getCraftingRecipe(db, itemName) {
  const row = db
    .prepare(
      `SELECT ${RECIPE_COLUMNS}
       FROM crafting_recipes r
       JOIN items c         ON c.id = r.item_id
       JOIN source_pages sp ON sp.id = r.source_page_id
       WHERE c.name = ? COLLATE NOCASE`,
    )
    .get(itemName);
  return row ? withIngredients(db, [row])[0] : null;
}

/**
 * Recipes that use an item, by name or through a group ("Any Fish",
 * "Wild Seeds (Any)"). In Crafting page order.
 */
export function getCraftedUsing(db, itemName) {
  const groups = groupsOf(db, itemName);
  const rows = db
    .prepare(
      `SELECT DISTINCT ${RECIPE_COLUMNS}
       FROM crafting_ingredients ci
       JOIN crafting_recipes r ON r.item_id = ci.crafted_item_id
       JOIN items c            ON c.id = r.item_id
       JOIN source_pages sp    ON sp.id = r.source_page_id
       WHERE ci.ingredient_name = :name COLLATE NOCASE
          OR ci.ingredient_group IN (SELECT value FROM json_each(:groups))
       ORDER BY r.position`,
    )
    .all({ name: itemName, groups: JSON.stringify(groups) });
  return withIngredients(db, rows);
}

/** All crafting recipes, optionally only one section ("rings", "Fertilizer"). Page order. */
export function getCraftingRecipes(db, { section } = {}) {
  const rows = db
    .prepare(
      `SELECT ${RECIPE_COLUMNS}
       FROM crafting_recipes r
       JOIN items c         ON c.id = r.item_id
       JOIN source_pages sp ON sp.id = r.source_page_id
       ${section ? 'WHERE r.section = :section COLLATE NOCASE' : ''}
       ORDER BY r.position`,
    )
    .all(section ? { section } : {});
  return withIngredients(db, rows);
}

/** The sections on the Crafting page, in page order. */
export function getCraftingSections(db) {
  return db
    .prepare('SELECT section FROM crafting_recipes GROUP BY section ORDER BY MIN(position)')
    .all()
    .map((row) => row.section);
}

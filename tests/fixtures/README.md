# Test fixtures

A fixture is a saved, real input that tests run against, so tests never need the internet.

`crop-pages.json` is an unmodified Stardew Valley Wiki API response for the pages
Parsnip (revision 191123), Strawberry (192732) and Corn (192088), downloaded
2026-11-16 with:

```
https://stardewvalleywiki.com/mediawiki/api.php?action=query&prop=revisions&titles=Parsnip|Strawberry|Corn&rvprop=ids|timestamp|content&rvslots=main&format=json&formatversion=2
```

The page text is from the [Stardew Valley Wiki](https://stardewvalleywiki.com/) and is
licensed CC BY-NC-SA. Sources:
[Parsnip](https://stardewvalleywiki.com/Parsnip),
[Strawberry](https://stardewvalleywiki.com/Strawberry),
[Corn](https://stardewvalleywiki.com/Corn).

`edge-case-pages.json` holds four pages that broke the simple assumptions, taken from
the Spring/Summer/Fall crop downloads saved on 2026-11-16 (via `npm run import`):

| Page | Revision | Why it's here |
|---|---|---|
| [Grape](https://stardewvalleywiki.com/Grape) | 192072 | infobox lists two ways to grow it (Summer Seeds, Grape Starter) |
| [Unmilled Rice](https://stardewvalleywiki.com/Unmilled_Rice) | 194130 | growth is "8 days (6 when irrigated)" |
| [Coffee Bean](https://stardewvalleywiki.com/Coffee_Bean) | 193175 | the crop is its own seed |
| [Ancient Fruit](https://stardewvalleywiki.com/Ancient_Fruit) | 192083 | grows in three seasons |

Same license as above (CC BY-NC-SA, Stardew Valley Wiki). The full downloads are
not committed: they're large, they go out of date, and `data/` is rebuilt from the
wiki rather than stored in Git.

`seed-pages.json` holds seven seed pages from the seed download saved 2026-11-16
(Carrot, Corn, Garlic, Parsnip, Rhubarb, Strawberry and Sunflower Seeds). Between
them they cover: Pierre + JojaMart, Year 2+ notes, Oasis only, festival only,
JojaMart cheaper than Pierre, a double sell price, and no shop at all.
Same license (CC BY-NC-SA, Stardew Valley Wiki). Source pages:
https://stardewvalleywiki.com/ + the page title with spaces as underscores.

`fish-pages.json` holds ten fish pages from the fish downloads saved 2026-11-16:
Tuna (195394), Catfish (194361), Walleye (193033), Albacore (193224), Rainbow Trout
(193322), Crab (194156), Legend (193653), Lava Eel (190296), Stingray (180872) and
Midnight Squid (192188). Between them they cover: plain and conditional seasons,
two time windows, weather that is more than one word, a crab pot fish, a legendary
fish, the fishing level a fish needs, an island-only fish with no season
categories, and a Night Market fish.
Same license (CC BY-NC-SA, Stardew Valley Wiki). Source pages:
https://stardewvalleywiki.com/ + the page title with spaces as underscores.

`artisan-pages.json` holds fourteen pages from the artisan download saved 2026-11-16:
the machines Keg (195253), Preserves Jar (195389), Oil Maker (190486), Bee House
(191201), Dehydrator (193436), Fish Smoker (194228), Cask (179542) and Tapper (193620),
and the goods Wine (192625), Juice (190319), Cheese (189929), Maple Syrup (190350),
Raisins (193433) and Jellies and Pickles (191929). Between them they cover: a table
with rowspans (Oil Maker), a two-column price header (Bee House), a list of
ingredients (Pickles), price formulas, exceptions only on the goods page (Juice),
a machine with no products table (Tapper), and a page with no infobox.

`fruits-page.json` is the Fruits page (revision 193430), saved 2026-11-16.

Same license (CC BY-NC-SA, Stardew Valley Wiki). Source pages:
https://stardewvalleywiki.com/ + the page title with spaces as underscores.

`cooking-pages.json` holds ten dish pages from the cooking downloads saved 2026-11-16:
Pizza (190608), Sashimi (177679), Maki Roll (190241), Lobster Bisque (193165),
Squid Ink Ravioli (192630), Banana Pudding (193712), Fried Egg (190238), Fish Taco
(193286), Tortilla (192712) and Miner's Treat (190495). Between them they cover:
"any Fish" ingredients, a recipe from TV and a shop, a recipe by friendship mail,
buffs with a duration, and a dish that is an ingredient of another (Tortilla in Fish Taco).

Same license (CC BY-NC-SA, Stardew Valley Wiki). Source pages:
https://stardewvalleywiki.com/ + the page title with spaces as underscores.

`crafting-page.json` is the Crafting page (revision 195392), saved 2026-11-16 with the
helper URL that also lists `Category:Crafting`. It is unmodified, so the category list
is still in it (the tests don't use that part). All 150 crafting recipes are read from it.

Same license (CC BY-NC-SA, Stardew Valley Wiki). Source page:
https://stardewvalleywiki.com/Crafting

`villager-pages.json` holds the Villagers page (revision 191346) and the List of All
Gifts page (revision 195507), and `friendship-page.json` holds the Friendship page
(revision 195512), all saved 2026-11-16. Both are unmodified API responses; the first
also has the (empty) `Category:Villagers` member list.

Same license (CC BY-NC-SA, Stardew Valley Wiki). Source pages:
https://stardewvalleywiki.com/Villagers, https://stardewvalleywiki.com/List_of_All_Gifts,
https://stardewvalleywiki.com/Friendship

`collection-pages.json` holds the Foraging (revision 195239), Minerals (195242),
Artifacts (186104), Flowers (171283) and Books (193598) pages, saved 2026-11-16. It is
an unmodified API response.

Same license (CC BY-NC-SA, Stardew Valley Wiki). Source pages:
https://stardewvalleywiki.com/ + the page title.

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

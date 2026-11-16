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

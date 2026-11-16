# 🌱 SDV Search Engine

A cozy little search engine for Stardew Valley: prices, items, recipes, fish, villagers and gift tastes, all in one place. It also has an assistant that only answers from facts it can back up with a wiki page.

## 💚 Why I made this

Hi, I'm **Papaya** (Aaliyah)! Stardew Valley is one of my favorite video games, and the [Stardew Valley Wiki](https://stardewvalleywiki.com/) is a resource I love and use all the time. I wanted a quick way to look things up and plan an efficient farm day, so I built one, and learned a lot of JavaScript along the way. 🐔

## 🧺 What's inside

- 🗄️ **A local SQLite database** built from the official wiki through its MediaWiki API. Every fact remembers where it came from: page title, URL, revision and retrieval date.
- 🏡 **A cozy local website** (`npm start`, then open http://localhost:3000): a big search bar, category shortcuts, item and villager pages, a profit planner, a Today on the farm page and Ask AI, with original pixel art.
- 🔎 **Search and item lookup**, with filters for season, type and price.
- 🧮 **Game math done in app code** (never guessed by AI): profit per day and regrowth for crops, plus fish, artisan goods, cooking and crafting.
- 🎁 **Villagers and gift tastes**: birthdays and who loves, likes or hates what.
- 🍄 **Forage, minerals, artifacts, flowers and books.**
- 🤖 **`npm run ask`**, an assistant that answers only from verified data and cites each fact. An optional Claude AI layer can write the answer (it needs your own API key and is off without one), and the app checks every AI answer before showing it.

## 🚜 Quick start

You need [Node.js](https://nodejs.org/) 20 or newer.

```
npm install
npm run import
```

`npm run import` prints the wiki URLs to save from your browser into `data/browser/`. Then:

```
npm run import -- data/browser/*.json
npm run build-db
```

Open the website:

```
npm start
```

then go to http://localhost:3000 in your browser (Ctrl+C in the terminal stops it). Or try a few commands:

```
npm run search -- berry
npm run profit -- Spring
npm run gifts -- Abigail
npm run ask -- "What does Abigail love?"
npm test
```

Every command and option: [docs/commands.md](docs/commands.md). How it all works inside: [docs/how-it-works.md](docs/how-it-works.md).

## 🔑 API keys

API keys live in a `.env` file on your own computer. `.env` is in `.gitignore`, so keys are never committed. Copy `.env.example` to start; setup steps are in [docs/commands.md](docs/commands.md#the-api-key-only-for-npm-run-ask).

## 📜 Credits and license

All game data comes from the [Stardew Valley Wiki](https://stardewvalleywiki.com/), whose content is licensed [CC BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/3.0/). Thank you to everyone who writes it! 💛

- Every fact links back to its wiki page.
- This is a non-commercial fan project, and any shared copy of the extracted data uses the same license.
- Not affiliated with ConcernedApe or the Stardew Valley Wiki. Stardew Valley and its images are © ConcernedApe, and no game images are included here.

The license for this project's own code hasn't been chosen yet.

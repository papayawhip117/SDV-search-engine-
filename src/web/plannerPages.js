// The planning pages: the profit planner (/profit) and Today on the farm
// (/today). Like pages.js, these only turn data into HTML; the server looks
// the data up, and every number is worked out in src/calc/profit.js.

import { DAYS_PER_SEASON, PROFIT_ASSUMPTIONS, SEASON_ORDER } from '../calc/profit.js';
import { gold, itemHref, layout, notice, pixelImage, seasonTag, select, sourceLink } from './components.js';
import { html, queryString } from './html.js';
import { nameLinks } from './pages.js';

/** "12.43g", or "-3.50g" for a loss. */
export function goldPerDay(value) {
  return `${value.toFixed(2)}g`;
}

/** The season, day (and weather) form both planning pages start with. */
function dayForm({ action, season, day, weather, button }) {
  return html`
    <form class="day-form" action="${action}" method="get">
      ${select({ name: 'season', label: 'Season', value: season, options: SEASON_ORDER.map((value) => ({ value, label: value })) })}
      <label class="field">
        <span class="field__label">Day</span>
        <input name="day" type="number" min="1" max="${DAYS_PER_SEASON}" value="${day}" inputmode="numeric">
      </label>
      ${weather !== undefined
        ? select({
            name: 'weather',
            label: 'Weather',
            value: weather,
            options: [{ value: '', label: 'Any' }, { value: 'Sun', label: 'Sunny' }, { value: 'Rain', label: 'Rainy' }],
          })
        : ''}
      <button class="button" type="submit">${button}</button>
    </form>`;
}

function seedCost(crop, result) {
  return `${result.seedsNeeded} × ${gold(crop.seedPrice)} at ${crop.seedShop}${crop.seedPriceNote ? ` ${crop.seedPriceNote}` : ''}`;
}

// ---- Profit planner -----------------------------------------------------------

/**
 * @param season, day  what the form shows
 * @param ranking      from rankCropsByProfit: { ranked, notCalculated, footnotes }
 * @param error        a message instead of results (a bad season or day)
 */
export function profitPage({ season, day, ranking = null, error = null }) {
  const ranked = ranking?.ranked ?? [];
  return layout({
    title: 'Profit planner',
    current: '/profit',
    wide: true,
    main: html`
      <h1 class="with-icon">${pixelImage('coin', { size: 32 })} Profit planner</h1>
      <p>Which crops earn the most gold per day if you plant them on a given day? Pick a season and a planting day.</p>
      ${dayForm({ action: '/profit', season, day, button: 'Show crops' })}
      ${error ? notice(error, { tone: 'error' }) : ''}
      ${ranking
        ? html`
          <section aria-labelledby="profit-heading">
            <h2 id="profit-heading">Planted on ${season} ${day}</h2>
            ${ranked.length === 0
              ? notice(`No crop planted on ${season} ${day} would be ready before the season ends.`)
              : html`
                <div class="table-wrap">
                  <table class="table">
                    <caption class="visually-hidden">Crops ranked by profit per day, one plant each</caption>
                    <thead>
                      <tr><th scope="col">Crop</th><th scope="col" class="num">Gold per day</th><th scope="col" class="num">Profit</th><th scope="col" class="num">Harvests</th><th scope="col">Seeds</th><th scope="col">Source</th></tr>
                    </thead>
                    <tbody>
                      ${ranked.map(
                        ({ crop, result }) => html`
                          <tr>
                            <th scope="row"><a href="${itemHref(crop.name)}">${crop.name}</a></th>
                            <td class="num"><strong>${goldPerDay(result.profitPerDay)}</strong></td>
                            <td class="num">${gold(result.profit)}</td>
                            <td class="num">${result.harvests}</td>
                            <td>${seedCost(crop, result)}</td>
                            <td>${sourceLink({ title: crop.name, url: crop.cropSourceUrl, revision: crop.cropSourceRevision })}</td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`}
            ${ranking.footnotes.length
              ? html`<h3>Check these</h3><ul>${ranking.footnotes.map((line) => html`<li>${line}</li>`)}</ul>`
              : ''}
            ${ranking.notCalculated.length
              ? html`<h3>Not in the table</h3><ul>${ranking.notCalculated.map(({ crop, reason }) => html`<li><a href="${itemHref(crop.name)}">${crop.name}</a>: ${reason}</li>`)}</ul>`
              : ''}
          </section>`
        : ''}
      <details class="assumptions">
        <summary>How these numbers are worked out</summary>
        <ul>${PROFIT_ASSUMPTIONS.map((line) => html`<li>${line}</li>`)}</ul>
        <p class="muted">The app does this math itself, from the sell and seed prices on the wiki. No AI is involved.</p>
      </details>`,
  });
}

// ---- Today on the farm --------------------------------------------------------

function birthdaySection({ birthdaysToday, upcoming, knownItems }) {
  return html`
    <section class="today-section" aria-labelledby="birthdays">
      <h2 id="birthdays">${pixelImage('gift', { size: 22 })} Birthdays</h2>
      ${birthdaysToday.length === 0 ? html`<p>No birthdays today.</p>` : ''}
      ${birthdaysToday.map(
        (villager) => html`
          <p><strong>It’s <a href="/gifts${queryString({ villager: villager.name })}">${villager.name}</a>’s birthday!</strong></p>
          ${villager.tastes.love.length ? html`<p>${villager.name} loves: ${nameLinks(villager.tastes.love, knownItems)}</p>` : ''}
          <p class="result__source">${sourceLink({ title: villager.name, url: villager.source.url, revision: villager.source.revision })}</p>`,
      )}
      ${upcoming.length
        ? html`<p>Coming up this week: ${upcoming.map(
            (birthday, i) => html`${i ? ', ' : ''}<a href="/gifts${queryString({ villager: birthday.name })}">${birthday.name}</a> (${birthday.season} ${birthday.day})`,
          )}</p>`
        : ''}
    </section>`;
}

function cropSection({ season, day, ranking }) {
  const top = ranking.ranked.filter(({ result }) => result.profit > 0).slice(0, 5);
  return html`
    <section class="today-section" aria-labelledby="planting">
      <h2 id="planting">${pixelImage('strawberry', { size: 22 })} Worth planting today</h2>
      ${top.length === 0
        ? html`<p>Nothing you plant today would make a profit before ${season} ends.</p>`
        : html`
          <ol class="mini-list">
            ${top.map(
              ({ crop, result }) => html`<li><a href="${itemHref(crop.name)}">${crop.name}</a>
                <span class="muted">${goldPerDay(result.profitPerDay)} a day, ${result.harvests} ${result.harvests === 1 ? 'harvest' : 'harvests'}</span></li>`,
            )}
          </ol>`}
      <p><a href="/profit${queryString({ season, day })}">See every crop in the profit planner →</a></p>
    </section>`;
}

function fishSection({ season, weather, fish, unclearWeather }) {
  const top = fish.slice(0, 8);
  return html`
    <section class="today-section" aria-labelledby="fishing">
      <h2 id="fishing">${pixelImage('fish', { size: 22 })} Fish to catch${weather ? ` on a ${weather === 'Rain' ? 'rainy' : 'sunny'} day` : ''}</h2>
      ${top.length === 0
        ? html`<p>No fish in the database for ${season}${weather ? ' in this weather' : ''}.</p>`
        : html`
          <ol class="mini-list">
            ${top.map(
              (row) => html`<li><a href="${itemHref(row.name)}">${row.name}</a> <span class="muted">${gold(row.sellPrice)}${row.location ? ` · ${row.location}` : ''}${row.time ? ` · ${row.time}` : ''}</span></li>`,
            )}
          </ol>`}
      ${unclearWeather.length
        ? html`<p class="muted">Check the weather for these on the wiki: ${nameLinks(unclearWeather.map((row) => row.name), new Set(unclearWeather.map((row) => row.name)))}</p>`
        : ''}
      <p><a href="/search${queryString({ type: 'fish', season })}">All ${season} fish →</a></p>
    </section>`;
}

function forageSection({ season, forage }) {
  return html`
    <section class="today-section" aria-labelledby="forage">
      <h2 id="forage">${pixelImage('leaf', { size: 22 })} Forage this season</h2>
      ${forage.length === 0
        ? html`<p>No forage in the database for ${season}.</p>`
        : html`<p>${forage.map((item, i) => html`${i ? ', ' : ''}<a href="${itemHref(item.name)}">${item.name}</a>`)}</p>`}
    </section>`;
}

/**
 * @param season, day, weather  what the form shows
 * @param plan  { birthdaysToday, upcoming, ranking, fish, unclearWeather, forage }, or null with an error
 */
export function todayPage({ season, day, weather = '', plan = null, error = null, knownItems = new Set() }) {
  return layout({
    title: 'Today on the farm',
    current: '/today',
    wide: true,
    main: html`
      <h1 class="with-icon">${pixelImage('calendar', { size: 32 })} Today on the farm</h1>
      <p>Pick the day in your game to see birthdays, the best crops to plant, fish to catch and forage to look for.</p>
      ${dayForm({ action: '/today', season, day, weather, button: 'Show my day' })}
      ${error ? notice(error, { tone: 'error' }) : ''}
      ${plan
        ? html`
          <p class="today-date">${seasonTag(season)} <strong>Day ${day}</strong>
            <span class="muted">· ${DAYS_PER_SEASON - day === 0 ? 'last day of the season' : `${DAYS_PER_SEASON - day} ${DAYS_PER_SEASON - day === 1 ? 'day' : 'days'} left in ${season}`}</span></p>
          <div class="today-grid">
            ${birthdaySection({ ...plan, knownItems })}
            ${cropSection({ season, day, ranking: plan.ranking })}
            ${fishSection({ season, weather, fish: plan.fish, unclearWeather: plan.unclearWeather })}
            ${forageSection({ season, forage: plan.forage })}
          </div>`
        : ''}`,
  });
}

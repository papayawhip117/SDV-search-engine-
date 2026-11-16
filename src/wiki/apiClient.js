// A small, polite client for the Stardew Valley Wiki's MediaWiki API.
//
// "Polite" means:
//   - only one request at a time, with a pause between requests
//   - a User-Agent header that says who we are
//   - `maxlag`, which tells the wiki to turn us away when it's busy
//   - retrying a few times, waiting longer each time, instead of hammering it

export const WIKI_BASE_URL = 'https://stardewvalleywiki.com';
export const API_URL = `${WIKI_BASE_URL}/mediawiki/api.php`;

// Identifies this program to the wiki's operators. If the wiki ever has a
// problem with our traffic, this tells them where to find us.
const USER_AGENT =
  'SDVSearchEngine/0.1 (personal learning project; https://github.com/papayawhip117/SDV-search-engine-)';

const DELAY_BETWEEN_REQUESTS_MS = 1000;
const MAX_ATTEMPTS = 4;

let lastRequestFinishedAt = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Wait until at least DELAY_BETWEEN_REQUESTS_MS has passed since the last request. */
async function waitForOurTurn() {
  const elapsed = Date.now() - lastRequestFinishedAt;
  if (elapsed < DELAY_BETWEEN_REQUESTS_MS) {
    await sleep(DELAY_BETWEEN_REQUESTS_MS - elapsed);
  }
}

/** Build the full request URL from an object of parameters. */
export function buildApiUrl(params) {
  const url = new URL(API_URL);
  const allParams = { format: 'json', formatversion: '2', maxlag: '5', ...params };
  for (const [key, value] of Object.entries(allParams)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

/**
 * Call the wiki API and return the parsed JSON.
 *
 * Example:
 *   const data = await callWikiApi({ action: 'query', list: 'search', srsearch: 'Parsnip' });
 */
export async function callWikiApi(params) {
  const url = buildApiUrl(params);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await waitForOurTurn();

    let response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (networkError) {
      // No internet, DNS failure, etc. Worth retrying.
      console.warn(`Network error (attempt ${attempt}/${MAX_ATTEMPTS}): ${networkError.message}`);
      lastRequestFinishedAt = Date.now();
      await sleep(5000 * attempt);
      continue;
    }
    lastRequestFinishedAt = Date.now();

    if (response.ok) {
      const data = await response.json();

      // The wiki is overloaded and asked us to come back later.
      if (data.error?.code === 'maxlag') {
        console.warn(`Wiki is busy (maxlag), waiting before retry ${attempt}/${MAX_ATTEMPTS}...`);
        await sleep(5000 * attempt);
        continue;
      }
      // Any other API error is a mistake in our request, so retrying won't help.
      if (data.error) {
        throw new Error(`Wiki API error "${data.error.code}": ${data.error.info}`);
      }
      return data;
    }

    // 429 = "too many requests", 5xx = server trouble. Both are worth a retry.
    if (response.status === 429 || response.status >= 500) {
      console.warn(`HTTP ${response.status} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying...`);
      await sleep(5000 * attempt);
      continue;
    }

    throw new Error(`Wiki API request failed with HTTP ${response.status}: ${url}`);
  }

  throw new Error(`Wiki API request failed after ${MAX_ATTEMPTS} attempts: ${url}`);
}

/**
 * Many API lists are split into pages of results. The response then contains
 * a `continue` object, and we send its values back to get the next page.
 * This helper keeps asking until there's nothing left, and hands each
 * response to `onResponse`.
 */
export async function callWikiApiWithContinue(params, onResponse) {
  let continueParams = {};
  while (continueParams) {
    const data = await callWikiApi({ ...params, ...continueParams });
    onResponse(data);
    continueParams = data.continue ?? null;
  }
}

/** The public URL of a wiki page, e.g. "Parsnip Seeds" → https://stardewvalleywiki.com/Parsnip_Seeds */
export function pageUrl(title) {
  return `${WIKI_BASE_URL}/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
}

// Step 3 of the AI assistant: check Claude's answer in code before showing it.
//
// The instructions ask Claude to use only our facts and cite them, but asking
// isn't proof. So the app checks every answer, with plain rules and no AI:
//
//   1. Every cited id ([F2]) must be one we gave it.
//   2. Every sentence that says something must cite at least one fact,
//      or be marked [not in facts] (Claude saying what the facts don't cover).
//   3. Every number in a sentence must appear in a fact that sentence cites,
//      so a price or day can't be made up or worked out by the AI.
//
// One problem is enough to reject the whole answer. Then the user sees the
// facts themselves instead, which are always backed by the wiki.

/** The tag Claude puts on a sentence that says what the facts don't cover. */
export const GAP_TAG = '[not in facts]';

const CITATION = /\[(F\d+)\]/g;
const GAP = /\[not in facts\]/gi;

/**
 * An answer → its sentences, each with the ids it cites.
 * A line is split after ". ", "! " or "? ". Citations written just after the
 * full stop ("... Poppy. [F1]") belong to the sentence before them.
 * List items ("- Diamond [F3]") are sentences of their own.
 */
export function splitSentences(answer) {
  const sentences = [];
  for (const line of (answer ?? '').split('\n')) {
    const parts = [];
    for (let part of line.split(/(?<=[.!?])\s+/)) {
      // "[F1] Her birthday..." → the [F1] goes back to the sentence before.
      const leading = /^(?:\s*\[(?:F\d+|not in facts)\])+/i.exec(part);
      if (leading && parts.length > 0) {
        parts[parts.length - 1] += ` ${leading[0].trim()}`;
        part = part.slice(leading[0].length);
      }
      if (part.trim()) parts.push(part.trim());
    }
    for (const text of parts) {
      sentences.push({
        text,
        ids: [...text.matchAll(CITATION)].map((match) => match[1]),
        gap: /\[not in facts\]/i.test(text),
      });
    }
  }
  return sentences;
}

/** The sentence without citations, list markers or tags: what it actually claims. */
function claimOf(text) {
  return text
    .replace(CITATION, '')
    .replace(GAP, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '') // "- " or "1. " at the start of a list item
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1') // "Poppy [F1]." → "Poppy."
    .trim();
}

/** "1,000g", "18.52" → ["1000", "18.52"]. */
export function numbersIn(text) {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => match[0].replace(/,/g, '').replace(/\.$/, ''));
}

/**
 * Sentences that need no citation: a lead-in to a list ("Abigail loves:"),
 * or a word or three with no numbers ("Yes!", "Good news:").
 */
function needsNoCitation(claim) {
  if (claim.endsWith(':')) return true;
  return numbersIn(claim).length === 0 && claim.split(/\s+/).length <= 3;
}

/**
 * Check an answer against the facts it was given.
 * Returns { ok, problems }, where each problem is a sentence a person can read.
 */
export function validateAnswer(answer, facts) {
  const problems = [];
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const sentences = splitSentences(answer);
  if (sentences.length === 0) return { ok: false, problems: ['The answer is empty.'] };

  for (const sentence of sentences) {
    const claim = claimOf(sentence.text);
    if (!claim) continue; // only citations on this line

    const unknown = sentence.ids.filter((id) => !byId.has(id));
    for (const id of new Set(unknown)) problems.push(`"${claim}" cites ${id}, which it was never given.`);

    if (sentence.ids.length === 0) {
      if (!sentence.gap && !needsNoCitation(claim)) problems.push(`"${claim}" doesn't cite any fact.`);
      if (sentence.gap && numbersIn(claim).length > 0) problems.push(`"${claim}" gives a number without a fact for it.`);
      continue;
    }

    // Numbers must come from the facts this sentence cites. (Fact numbers like "F2" aren't in the claim.)
    const citedText = sentence.ids
      .filter((id) => byId.has(id))
      .map((id) => byId.get(id).text)
      .join(' ');
    const allowed = new Set(numbersIn(citedText));
    for (const number of numbersIn(claim)) {
      if (!allowed.has(number)) problems.push(`"${claim}" says ${number}, which isn't in the facts it cites.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

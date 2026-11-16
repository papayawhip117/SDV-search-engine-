// General tools for reading wiki markup ("wikitext").
//
// A quick wikitext refresher:
//   {{Name|a|b|key=value}}   a template call, like a function call
//   [[Page]]                 a link to "Page"
//   [[Page|text]]            a link to "Page" that displays "text"
//   {| ... |}                a table
//
// Templates can be nested ({{Infobox |seed = {{Name|Parsnip Seeds}} }}),
// so we can't split on "|" naively. These helpers keep track of how deep
// inside {{ }} and [[ ]] we are.

/**
 * Find the first call of a template and return the text between its outer
 * braces, e.g. findTemplateCall(text, 'Infobox') → "Infobox\n|eng = Parsnip ...".
 * Returns null if the template isn't used.
 */
export function findTemplateCall(wikitext, templateName) {
  // MediaWiki ignores the case of the first letter of a template name.
  const first = templateName[0];
  const rest = templateName.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\{\\{\\s*[${first.toUpperCase()}${first.toLowerCase()}]${rest}\\s*(\\||\\}\\})`);
  const match = pattern.exec(wikitext);
  if (!match) return null;

  // Walk forward from the opening {{ until the braces balance again.
  let depth = 0;
  for (let i = match.index; i < wikitext.length - 1; i++) {
    const pair = wikitext.slice(i, i + 2);
    if (pair === '{{') {
      depth++;
      i++;
    } else if (pair === '}}') {
      depth--;
      i++;
      if (depth === 0) return wikitext.slice(match.index + 2, i - 1);
    }
  }
  return null; // unbalanced braces: broken markup
}

/**
 * Split text on a separator, ignoring separators that are inside
 * {{templates}} or [[links]].
 *   splitTopLevel('a|{{b|c}}|[[d|e]]', '|') → ['a', '{{b|c}}', '[[d|e]]']
 */
export function splitTopLevel(text, separator) {
  const parts = [];
  let current = '';
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') { braceDepth++; current += pair; i++; continue; }
    if (pair === '}}') { braceDepth--; current += pair; i++; continue; }
    if (pair === '[[') { bracketDepth++; current += pair; i++; continue; }
    if (pair === ']]') { bracketDepth--; current += pair; i++; continue; }

    if (braceDepth === 0 && bracketDepth === 0 && text.startsWith(separator, i)) {
      parts.push(current);
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += text[i];
  }
  parts.push(current);
  return parts;
}

/**
 * Turn the inside of a template call into an object.
 *   parseTemplateParams('Infobox\n|eng = Parsnip\n|growth = 4 days')
 *   → { name: 'Infobox', named: { eng: 'Parsnip', growth: '4 days' }, positional: [] }
 * Named parameters are read by NAME, so their order on the page doesn't matter.
 */
export function parseTemplateParams(templateInner) {
  const [rawName, ...rawParams] = splitTopLevel(templateInner, '|');
  const named = {};
  const positional = [];

  for (const rawParam of rawParams) {
    // Only an "=" outside nested templates/links makes this a named parameter.
    const [key, ...valueParts] = splitTopLevel(rawParam, '=');
    if (valueParts.length > 0) {
      named[key.trim()] = valueParts.join('=').trim();
    } else {
      positional.push(rawParam.trim());
    }
  }
  return { name: rawName.trim(), named, positional };
}

/** "[[Farming#XP|Farming XP]]" → "Farming XP", "[[Spring]]" → "Spring" */
export function stripLinks(text) {
  return text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
}

/**
 * Return the first argument of a template call inside a value.
 *   firstTemplateArgument('{{Name|Parsnip Seeds}}', 'Name') → 'Parsnip Seeds'
 */
export function firstTemplateArgument(value, templateName) {
  const inner = findTemplateCall(value, templateName);
  if (inner === null) return null;
  const { positional } = parseTemplateParams(inner);
  return positional[0] ?? null;
}

/**
 * Read the whole number at the start of a value, or null if there isn't one.
 *   '4 days' → 4,  '8 [[Farming|Farming XP]]' → 8,  '1,500' → 1500,  'varies' → null
 */
export function parseLeadingInteger(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d[\d,]*)/.exec(value);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

/**
 * Return the text of a "==Heading==" section, up to the next heading of the
 * same or higher level. Returns null if there's no such section.
 */
export function getSection(wikitext, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp(`^(=+)\\s*${escaped}\\s*\\1\\s*$`, 'm').exec(wikitext);
  if (!start) return null;
  const level = start[1].length;
  const afterHeading = wikitext.slice(start.index + start[0].length);
  const next = new RegExp(`^={1,${level}}[^=].*={1,${level}}\\s*$`, 'm').exec(afterHeading);
  return next ? afterHeading.slice(0, next.index) : afterHeading;
}

/**
 * Read the first {| table |} in some wikitext as rows of cell strings.
 * Header cells (!) and data cells (|) are both included; cells written on
 * one line ("|a||b") are split.
 */
export function parseFirstTable(wikitext) {
  const start = wikitext.indexOf('{|');
  if (start === -1) return null;
  const end = wikitext.indexOf('\n|}', start);
  const tableText = wikitext.slice(start, end === -1 ? undefined : end);

  const rows = [];
  let currentRow = [];
  for (const line of tableText.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|-')) {
      if (currentRow.length) rows.push(currentRow);
      currentRow = [];
    } else if (trimmed.startsWith('|') || trimmed.startsWith('!')) {
      const separator = trimmed.startsWith('!') ? '!!' : '||';
      for (let cell of splitTopLevel(trimmed.slice(1), separator)) {
        // "style="..." | content": keep only the content after the attributes
        const pieces = splitTopLevel(cell, '|');
        cell = pieces[pieces.length - 1];
        currentRow.push(cell.trim());
      }
    }
  }
  if (currentRow.length) rows.push(currentRow);
  return rows;
}

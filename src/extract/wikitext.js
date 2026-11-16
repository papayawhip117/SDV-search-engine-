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

/**
 * Turn a short piece of wikitext into plain readable text:
 *   "'''Parsnip Seeds''' are a type of [[seed]]. {{Price|20}}"  →  "Parsnip Seeds are a type of seed. 20g"
 * {{Name|X}}, {{Season|X}} and {{Weather inline|X}} become X, {{Price|N}}
 * becomes Ng, {{Tprice|N}} (Traveling Cart) becomes "a random price",
 * {{Bundle|X}} becomes "X Bundle", and other templates are dropped.
 */
export function toPlainText(wikitext) {
  let text = wikitext;
  // Replace templates from the innermost outwards, so nested ones work too.
  for (let pass = 0; pass < 10 && text.includes('{{'); pass++) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
      const [name, ...args] = inner.split('|').map((part) => part.trim());
      if (/^(name|season|weather inline)$/i.test(name)) return args[0] ?? '';
      if (/^price$/i.test(name)) return args[0] ? `${args[0]}g` : '';
      if (/^tprice$/i.test(name)) return 'a random price'; // Traveling Cart prices vary
      if (/^bundle$/i.test(name)) return args[0] ? `${args[0]} Bundle` : '';
      return '';
    });
  }
  return stripLinks(text)
    .replace(/'{2,}/g, '') // '''bold''' and ''italic''
    .replace(/<[^>]+>/g, '') // HTML tags like <ref> or <br />
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The opening paragraph of a page (after its infobox), as plain text,
 * cut to at most `maxLength` characters at the end of a sentence.
 * Used for search and for showing what an item is.
 */
export function extractSummary(wikitext, maxLength = 300) {
  if (!wikitext) return null;
  let body = wikitext;
  const infobox =
    findTemplateCall(wikitext, 'Infobox seed') ??
    findTemplateCall(wikitext, 'Infobox fish') ??
    findTemplateCall(wikitext, 'Infobox');
  if (infobox !== null) body = wikitext.slice(wikitext.indexOf(infobox) + infobox.length + 2);

  const paragraph = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^(\{\{|\{\||\||!|==|\[\[(File|Category):|<|\*|#|__|:|;)/i.test(line));
  if (!paragraph) return null;

  const plain = toPlainText(paragraph);
  if (plain.length <= maxLength) return plain || null;
  const cut = plain.slice(0, maxLength);
  const lastSentenceEnd = cut.lastIndexOf('. ');
  return lastSentenceEnd > 0 ? cut.slice(0, lastSentenceEnd + 1) : `${cut.trimEnd()}…`;
}

/** Read rowspan="N" / colspan="N" from a cell's attribute text. */
function spanOf(attributes, name) {
  const match = new RegExp(`${name}\\s*=\\s*"?(\\d+)`, 'i').exec(attributes);
  return match ? Number(match[1]) : 1;
}

/**
 * Read the first {| table |} in some wikitext as a grid of cell strings,
 * like parseFirstTable, but also:
 *   - a cell that spans several rows (rowspan="3") is repeated in each row
 *   - a cell that spans several columns (colspan="2") fills each column
 *   - a cell that continues on the next lines (a list) keeps those lines
 * The first row is usually the header row.
 */
export function parseTableWithSpans(wikitext) {
  const start = wikitext.indexOf('{|');
  if (start === -1) return null;
  const end = wikitext.indexOf('\n|}', start);
  const lines = wikitext.slice(start, end === -1 ? undefined : end).split('\n').slice(1);

  // 1. Group the lines into rows of raw cells: { attributes, content }.
  const rawRows = [];
  let row = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|-')) {
      if (row.length) rawRows.push(row);
      row = [];
    } else if (trimmed.startsWith('|') || trimmed.startsWith('!')) {
      const separator = trimmed.startsWith('!') ? '!!' : '||';
      for (const cell of splitTopLevel(trimmed.slice(1), separator)) {
        const pieces = splitTopLevel(cell, '|');
        // "rowspan="3" | content": the part before the first | is attributes
        // when it looks like attributes (or is empty, as in "||content").
        const hasAttributes = pieces.length > 1 && (/^\s*$/.test(pieces[0]) || /^[^[{]*=/.test(pieces[0]));
        row.push({
          attributes: hasAttributes ? pieces[0] : '',
          content: (hasAttributes ? pieces.slice(1).join('|') : cell).trim(),
        });
      }
    } else if (row.length && trimmed) {
      row[row.length - 1].content += `\n${trimmed}`; // e.g. "* item" lines of a list
    }
  }
  if (row.length) rawRows.push(row);

  // 2. Lay the cells out on a grid, carrying rowspans down.
  const carried = []; // column index → { content, rowsLeft }
  return rawRows.map((cells) => {
    const output = [];
    const takeCarried = () => {
      while (carried[output.length]?.rowsLeft > 0) {
        const carry = carried[output.length];
        carry.rowsLeft--;
        output.push(carry.content);
      }
    };
    for (const { attributes, content } of cells) {
      takeCarried();
      const rowspan = spanOf(attributes, 'rowspan');
      for (let i = 0; i < spanOf(attributes, 'colspan'); i++) {
        if (rowspan > 1) carried[output.length] = { content, rowsLeft: rowspan - 1 };
        output.push(content);
      }
    }
    takeCarried();
    return output;
  });
}

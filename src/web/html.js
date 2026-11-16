// A tiny, safe way to build HTML from JavaScript template strings.
//
//   html`<p>Hello ${name}</p>`
//
// Every ${value} is escaped, so a search like <script>alert(1)</script> is
// shown as text instead of running as code (this attack is called XSS).
// Only HTML we built ourselves with html`...` (or marked with raw()) is
// inserted as-is. Arrays are joined, and null, undefined and false print
// nothing, so `${cond && html`...`}` works.

class SafeHtml {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Make text safe to put inside HTML (and inside "quoted" attributes). */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** Mark a string as already-safe HTML. Only use it for HTML this app wrote itself. */
export function raw(text) {
  return new SafeHtml(text);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/** The template tag. Returns SafeHtml, so html`` pieces can be nested. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

/** Build a link's ?query=string from an object, leaving out empty values. */
export function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

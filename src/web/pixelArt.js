// Our own little pixel-art drawings, made for this project (no game images
// are copied). Each drawing is a grid of letters, one letter per pixel, and
// pixelSvg() turns the grid into an SVG image. SVG stays sharp at any size,
// and `shape-rendering="crispEdges"` keeps the pixels square.
//
// To change a drawing, edit its letters. A '.' is an empty (see-through) pixel.

/** Which colour each letter paints. */
export const PALETTE = {
  K: '#5b3a29', // outline, dark brown
  R: '#e06c6c', // strawberry red
  Y: '#f8e3a3', // strawberry seeds
  G: '#86b06a', // leaf green
  g: '#5a8a45', // dark green
  W: '#c58a58', // wood
  w: '#94603a', // dark wood
  P: '#d77c6a', // roof
  p: '#b8604f', // roof shadow
  B: '#a9cbe8', // window glass
  S: '#f2c14e', // sunflower yellow
  o: '#8a5a32', // sunflower centre
  F: '#8fb6d8', // fish
  f: '#5f87ad', // fish belly shadow
  X: '#eaa3ae', // gift pink
  x: '#c97884', // ribbon
  T: '#e3b07a', // pot
  V: '#bba4e3', // gem
  v: '#8d74c4', // gem shadow
  L: '#ffffff', // cloud
  l: '#cdbfb2', // cloud outline, steam
  H: '#cfe0c0', // far hills
  M: '#a8c896', // near hills
  C: '#fffbf3', // paper
  D: '#d9a23a', // coin shadow
};

/**
 * Turn layers of letter grids into an SVG string.
 *
 *   pixelSvg({ width: 12, height: 12, layers: [{ x: 0, y: 0, map: ['..KK..', ...] }] })
 *
 * Later layers are painted on top of earlier ones. Pixels outside the
 * width/height are cut off. Runs of the same colour in a row become one
 * rectangle, which keeps the file small.
 */
export function pixelSvg({ width, height, layers }) {
  const rects = [];
  for (const { x = 0, y = 0, map } of layers) {
    map.forEach((row, rowIndex) => {
      let col = 0;
      while (col < row.length) {
        const letter = row[col];
        let end = col + 1;
        while (end < row.length && row[end] === letter) end++;
        if (letter !== '.' && letter !== ' ') {
          const colour = PALETTE[letter];
          if (!colour) throw new Error(`Unknown pixel letter "${letter}"`);
          rects.push(`<rect x="${x + col}" y="${y + rowIndex}" width="${end - col}" height="1" fill="${colour}"/>`);
        }
        col = end;
      }
    });
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * 4}" height="${height * 4}" ` +
    `shape-rendering="crispEdges">${rects.join('')}</svg>`
  );
}

// ---- Small icons (12 × 12) -------------------------------------------------

const STRAWBERRY = [
  '...g..g..g..',
  '..gGgGGgGg..',
  '.KRgGGGGgRK.',
  'KRRRRRRRRRRK',
  'KRYRRRYRRRRK',
  'KRRRRRRRRYRK',
  '.KRRYRRRRRK.',
  '.KRRRRRYRRK.',
  '..KRRRRRRK..',
  '...KRYRRK...',
  '....KRRK....',
  '.....KK.....',
];

const FISH = [
  '............',
  '.....KKKKK..',
  'K...KFFFFFK.',
  'KK.KFFFFFFFK',
  'KFKFFFFFFKFK',
  'KFKfFFFFFFFK',
  'KK.KffffffK.',
  'K...KKKKKK..',
];

const GIFT = [
  '..xx....xx..',
  '.x..x..x..x.',
  '..xx.xx.xx..',
  'KKKKKKKKKKKK',
  'KXXXXxxXXXXK',
  'KKKKKKKKKKKK',
  '.KXXXxxXXXK.',
  '.KXXXxxXXXK.',
  '.KXXXxxXXXK.',
  '.KXXXxxXXXK.',
  '.KKKKKKKKKK.',
];

const POT = [
  '...l...l....',
  '....l...l...',
  '...l...l....',
  '............',
  'KKKKKKKKKKKK',
  'KTTTTTTTTTTK',
  '.KTTTTTTTTK.',
  '.KTTTTTTTTK.',
  '..KTTTTTTK..',
  '...KKKKKK...',
];

const LEAF = [
  '........KK..',
  '......KKGGK.',
  '....KKGGGGK.',
  '...KGGGGGgK.',
  '..KGGGGGgGK.',
  '..KGGGGgGGK.',
  '.KGGGgGGGK..',
  '.KGGgGGGK...',
  '.KGgGGKK....',
  '.KgKKK......',
  'Kg..........',
  'K...........',
];

const GEM = [
  '...KKKKKK...',
  '..KVVvVVvK..',
  '.KVVvVVVVvK.',
  'KKKKKKKKKKKK',
  '.KVVVvVVVVK.',
  '..KVVvVVVK..',
  '...KVvVVK...',
  '....KVVK....',
  '.....KK.....',
];

const COIN = [
  '....KKKK....',
  '..KKSSSSKK..',
  '.KSSSSSSSSK.',
  '.KSSDDDDSSK.',
  'KSSSDSSSSSDK',
  'KSSSDDDSSSDK',
  'KSSSSSSDSSDK',
  'KSSSDDDDSSDK',
  '.KSSSSSSSDK.',
  '.KDSSSSSDDK.',
  '..KKDDDDKK..',
  '....KKKK....',
];

const CALENDAR = [
  '..K......K..',
  'KKKKKKKKKKKK',
  'KRRRRRRRRRRK',
  'KRRRRRRRRRRK',
  'KKKKKKKKKKKK',
  'KCCCCCCCCCCK',
  'KCKCCKCCKCCK',
  'KCCCCCCCCCCK',
  'KCKCCKCCRRCK',
  'KCCCCCCCRRCK',
  'KCCCCCCCCCCK',
  'KKKKKKKKKKKK',
];

const SPARKLE = ['.S.', 'SSS', '.S.'];

const HEART = [
  '.KK..KK.',
  'KRRKKRRK',
  'KRRRRRRK',
  '.KRRRRK.',
  '..KRRK..',
  '...KK...',
];

// ---- The farm on the homepage (72 × 34) -------------------------------------

const CLOUD = [
  '....llll......',
  '..llLLLLll....',
  '.lLLLLLLLLlll.',
  'lLLLLLLLLLLLLl',
  '.llllllllllll.',
];

const TREE = [
  '....KKKKKK....',
  '..KKGGGGGGKK..',
  '.KGGGgGGGGGGK.',
  'KGGGGGGGgGGGGK',
  'KGgGGGGGGGGgGK',
  'KGGGGGgGGGGGGK',
  'KGGGGGGGGGgGGK',
  'KGGgGGGGGGGGGK',
  '.KGGGGGgGGGGK.',
  '..KKGGGGGGKK..',
  '....KKwwKK....',
  '.....KwwK.....',
  '.....KwwK.....',
  '.....KwwK.....',
  '.....KwwK.....',
  '.....KwwK.....',
  '....KwwwwK....',
];

// The roof is a triangle: each row is 2 pixels wider than the one above.
const ROOF = Array.from({ length: 10 }, (_, row) => {
  const inside = row * 2;
  const fill = Array.from({ length: inside }, (_, i) => (row % 2 === 1 && i % 3 === 1 ? 'p' : 'P')).join('');
  const pad = '.'.repeat(11 - row);
  return `${pad}K${fill}K${pad}`;
}).concat(['.' + 'K'.repeat(22) + '.']);

const WALL = Array.from({ length: 11 }, () => '..K' + 'WWw'.repeat(6) + 'K..');
const WINDOW = ['KKKK', 'KBBK', 'KBBK', 'KKKK'];
const DOOR = ['KKKK', 'KwwK', 'KwwK', 'KwWK', 'KwwK', 'KwwK', 'KwwK'];

const FENCE = [
  'KK...KK...KK',
  'WWKKKWWKKKWW',
  'WWWWWWWWWWWW',
  'WWKKKWWKKKWW',
  'WW...WW...WW',
  'WWKKKWWKKKWW',
  'WWWWWWWWWWWW',
  'WWKKKWWKKKWW',
  'WW...WW...WW',
];

const SUNFLOWER = [
  '..S.S..',
  '.SSSSS.',
  'SSoooSS',
  '.SoooS.',
  'SSoooSS',
  '.SSSSS.',
  '..S.S..',
  '...g...',
  '.GGg...',
  '..Gg...',
  '...gGG.',
  '...gG..',
  '...g...',
];

const GROUND = ['G'.repeat(72), 'gGGgGGGgGGgGGGgG'.repeat(5).slice(0, 72)];

const FARM = {
  width: 72,
  height: 34,
  layers: [
    { x: 4, y: 3, map: CLOUD },
    { x: 52, y: 2, map: CLOUD },
    { x: 13, y: 24, map: FENCE },
    { x: 45, y: 24, map: FENCE },
    { x: 1, y: 15, map: TREE },
    { x: 23, y: 10, map: ROOF },
    { x: 23, y: 21, map: WALL },
    { x: 27, y: 23, map: WINDOW },
    { x: 37, y: 23, map: WINDOW },
    { x: 33, y: 25, map: DOOR },
    { x: 57, y: 19, map: SUNFLOWER },
    { x: 64, y: 21, map: SUNFLOWER },
    { x: 19, y: 13, map: SPARKLE },
    { x: 51, y: 14, map: SPARKLE },
    { x: 68, y: 13, map: SPARKLE },
    { x: 0, y: 32, map: GROUND },
  ],
};

// ---- The footer strip (64 × 22), repeated sideways by the CSS ---------------

/** Hills drawn from a wave, so the left and right edges join up when repeated. */
function hills(letter, base, size, period, shift) {
  const rows = Array.from({ length: 22 }, () => Array(64).fill('.'));
  for (let x = 0; x < 64; x++) {
    const top = Math.round(base - size * Math.sin(((x + shift) / period) * 2 * Math.PI));
    for (let y = Math.max(0, top); y < 22; y++) rows[y][x] = letter;
  }
  return rows.map((row) => row.join(''));
}

const FOOTER_FENCE = [
  'KK......KK......KK......KK......KK......KK......KK......KK......',
  'WWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKK',
  'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
  'WWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKKWWKKKKKK',
  'WW......WW......WW......WW......WW......WW......WW......WW......',
];

const FOOTER = {
  width: 64,
  height: 22,
  layers: [
    { map: hills('H', 7, 4, 32, 0) },
    { map: hills('M', 12, 3, 64, 16) },
    { x: 0, y: 14, map: FOOTER_FENCE },
    { x: 0, y: 19, map: ['G'.repeat(64), 'gGGGgGGGGgGGGGGg'.repeat(4), 'g'.repeat(64)] },
  ],
};

/** Every drawing the server can send, by file name (/art/<name>.svg). */
export const ART = {
  strawberry: { width: 12, height: 12, layers: [{ map: STRAWBERRY }] },
  fish: { width: 12, height: 12, layers: [{ y: 2, map: FISH }] },
  gift: { width: 12, height: 12, layers: [{ y: 1, map: GIFT }] },
  pot: { width: 12, height: 12, layers: [{ y: 1, map: POT }] },
  leaf: { width: 12, height: 12, layers: [{ map: LEAF }] },
  gem: { width: 12, height: 12, layers: [{ y: 2, map: GEM }] },
  coin: { width: 12, height: 12, layers: [{ map: COIN }] },
  calendar: { width: 12, height: 12, layers: [{ map: CALENDAR }] },
  heart: { width: 8, height: 6, layers: [{ map: HEART }] },
  sparkle: { width: 3, height: 3, layers: [{ map: SPARKLE }] },
  farm: FARM,
  footer: FOOTER,
};

/** The SVG text for one drawing, or null if there's no drawing with that name. */
export function artSvg(name) {
  return Object.hasOwn(ART, name) ? pixelSvg(ART[name]) : null;
}

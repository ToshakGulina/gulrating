import assert from 'node:assert/strict';
import { DOT_TEXT_GLYPHS, renderDotHeadingText } from '../src/lib/dotMatrix.js';

for (const [character, rows] of Object.entries(DOT_TEXT_GLYPHS)) {
  assert.equal(rows.length, ['Ц', 'Щ'].includes(character) ? 8 : 7,
    `${character} must use its intended dot-row count`);
  const columns = ['Ц', 'Щ'].includes(character) ? 6 : 5;
  for (const row of rows) assert.equal(row.length, columns, `${character} rows must use ${columns} dot columns`);
}
assert.deepEqual(DOT_TEXT_GLYPHS.Д,
  ['00110', '01001', '01001', '01001', '01001', '10001', '11111'],
  'the Cyrillic Д roof is centered and its legs join a complete baseline');
assert.deepEqual(DOT_TEXT_GLYPHS.Ё,
  ['01010', '00000', '11111', '10000', '11110', '10000', '11111'],
  'the Cyrillic Ё uses two dots above Е');
assert.deepEqual(DOT_TEXT_GLYPHS.Ы,
  ['10001', '10001', '11101', '10011', '10011', '10011', '11111'],
  'the Cyrillic Ы has both a complete soft-sign bowl and a full right stem');
assert.deepEqual(DOT_TEXT_GLYPHS.Ц,
  ['100010', '100010', '100010', '100010', '100010', '111110', '000010', '000011'],
  'the Cyrillic Ц has a full U body and a hooked right descender');
assert.deepEqual(DOT_TEXT_GLYPHS.Щ,
  ['101010', '101010', '101010', '101010', '101010', '111110', '000010', '000011'],
  'the Cyrillic Щ retains its three-stem body and gets a hooked right descender');
for (const character of ['Ц', 'Щ']) {
  const glyph = renderDotHeadingText(character);
  assert.equal((glyph.match(/<i class="dot-matrix-dot/g) || []).length, 48,
    `the renderer preserves the eighth descender row and sixth column for ${character}`);
  assert.match(glyph, /dot-text-glyph-six/,
    `${character} receives the six-column grid needed for its descender hook`);
}

const heading = renderDotHeadingText('Настройки');
const glyphs = [...heading.matchAll(/<span class="dot-matrix-text-glyph dot-text-glyph" aria-hidden="true">([\s\S]*?)<\/span>/g)];
assert.equal(glyphs.length, 9, 'the heading is rendered as nine uppercase Russian character glyphs');
for (const [, cells] of glyphs) {
  assert.equal((cells.match(/<i class="dot-matrix-dot/g) || []).length, 35,
    'each character uses a full 5-by-7 round-dot grid');
}
const spacedHeading = renderDotHeadingText('Настройки ленты');
assert.match(spacedHeading, /dot-text-space[\s\S]*?<wbr>/,
  'word spaces remain wrap opportunities in longer headings');
assert.equal((spacedHeading.match(/class="dot-text-word"/g) || []).length, 2,
  'letters stay grouped by word so a line never breaks arbitrarily inside short words');
assert.match(renderDotHeadingText('Привет!'), /dot-matrix-text-glyph/,
  'mixed-case Russian text is mapped to uppercase display glyphs');
assert.match(renderDotHeadingText('<'), /data-symbol="&lt;"/,
  'unsupported characters are escaped in the plain fallback');
console.log('Nothing headings use corrected round-dot Cyrillic glyphs: OK');

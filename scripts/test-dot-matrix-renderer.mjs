import assert from 'node:assert/strict';
import { DOT_TEXT_GLYPHS, renderDotHeadingText } from '../src/lib/dotMatrix.js';

for (const [character, rows] of Object.entries(DOT_TEXT_GLYPHS)) {
  assert.equal(rows.length, character === 'Ц' ? 8 : 7,
    `${character} must use its intended dot-row count`);
  for (const row of rows) assert.equal(row.length, 5, `${character} rows must use five dot columns`);
}
assert.deepEqual(DOT_TEXT_GLYPHS.Д,
  ['00110', '01001', '01001', '01001', '01001', '10001', '11111'],
  'the Cyrillic Д roof is centered and its legs join a complete baseline');
assert.deepEqual(DOT_TEXT_GLYPHS.Ц,
  ['10010', '10010', '10010', '10010', '10010', '11110', '00010', '00010'],
  'the Cyrillic Ц has a clearly visible two-dot right descender and a trailing margin');
const tsGlyph = renderDotHeadingText('Ц');
assert.equal((tsGlyph.match(/<i class="dot-matrix-dot/g) || []).length, 40,
  'the renderer preserves the eighth descender row for Ц');

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
console.log('Nothing headings use readable 5-by-7 round-dot glyphs: OK');

import assert from 'node:assert/strict';
import { DOT_TEXT_GLYPHS, renderDotHeadingText } from '../src/lib/dotMatrix.js';

for (const [character, rows] of Object.entries(DOT_TEXT_GLYPHS)) {
  assert.equal(rows.length, 7, `${character} must have seven dot rows`);
  for (const row of rows) assert.equal(row.length, 5, `${character} rows must use five dot columns`);
}

const heading = renderDotHeadingText('Настройки');
const glyphs = [...heading.matchAll(/<span class="dot-matrix-text-glyph dot-text-glyph" aria-hidden="true">([\s\S]*?)<\/span>/g)];
assert.equal(glyphs.length, 9, 'the heading is rendered as nine uppercase Russian character glyphs');
for (const [, cells] of glyphs) {
  assert.equal((cells.match(/<i class="dot-matrix-dot/g) || []).length, 35,
    'each character uses a full 5-by-7 round-dot grid');
}
assert.match(renderDotHeadingText('Настройки ленты'), /dot-text-space[\s\S]*?<wbr>/,
  'word spaces remain wrap opportunities in longer headings');
assert.match(renderDotHeadingText('Привет!'), /dot-matrix-text-glyph/,
  'mixed-case Russian text is mapped to uppercase display glyphs');
assert.match(renderDotHeadingText('<'), /data-symbol="&lt;"/,
  'unsupported characters are escaped in the plain fallback');
console.log('Nothing headings use readable 5-by-7 round-dot glyphs: OK');

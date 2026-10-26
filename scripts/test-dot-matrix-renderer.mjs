import assert from 'node:assert/strict';

const cols = 7;
const rows = 9;
const canvasWidth = cols * 10;
const canvasHeight = rows * 10;
const pixels = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
const pattern = [
  '0011100',
  '0110110',
  '1100011',
  '1100011',
  '1111111',
  '1100011',
  '1100011',
  '1100011',
  '1100011',
];

globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          clearRect() { pixels.fill(0); },
          fillText(character) {
            assert.equal(character, 'А');
            for (let row = 0; row < rows; row += 1) {
              for (let col = 0; col < cols; col += 1) {
                if (pattern[row][col] !== '1') continue;
                for (let y = row * 10; y < (row + 1) * 10; y += 1) {
                  for (let x = col * 10; x < (col + 1) * 10; x += 1) {
                    pixels[(y * canvasWidth + x) * 4 + 3] = 255;
                  }
                }
              }
            }
          },
          getImageData() { return { data: pixels }; },
        };
      },
    };
  },
};

try {
  const { rasterizeDotGlyph, renderDotHeadingText } = await import('../src/lib/dotMatrix.js');
  const glyph = rasterizeDotGlyph('А');
  assert.match(glyph, /<svg class="dot-matrix-glyph" viewBox="0 0 7 9"/);
  assert.equal((glyph.match(/<circle /g) || []).length, pattern.join('').replaceAll('0', '').length,
    'each sampled lit matrix cell produces one round dot');
  assert.match(renderDotHeadingText('а а'), /<wbr>/,
    'word spaces remain wrap opportunities in longer headings');
  assert.match(renderDotHeadingText('а'), /<svg[^>]+dot-matrix-glyph/,
    'heading glyphs are generated from the same 7-by-9 dot matrix');
  console.log('Nothing heading renderer produces crisp round-dot 7-by-9 glyphs: OK');
} finally {
  delete globalThis.document;
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
const root = { dataset: {} };
const metas = {
  'meta[name="theme-color"]': { content: '#0f172a' },
  'meta[name="apple-mobile-web-app-status-bar-style"]': { content: 'black-translucent' },
};
globalThis.document = {
  documentElement: root,
  querySelector(selector) { return metas[selector] || null; },
};

const { getThemeId, setTheme, THEMES } = await import('../src/lib/theme.js');
assert.equal(getThemeId(), 'classic');
values.set('gulrating:accent', '16 185 129');
assert.equal(getThemeId(), 'forest');
values.delete('gulrating:accent');
assert.equal(getThemeId(), 'classic');
assert.equal(THEMES.length, 6);
assert.equal(setTheme('ocean'), 'ocean');
assert.equal(root.dataset.theme, 'ocean');
assert.equal(metas['meta[name="theme-color"]'].content, '#07131d');
assert.equal(setTheme('light'), 'light');
assert.equal(metas['meta[name="apple-mobile-web-app-status-bar-style"]'].content, 'default');
assert.equal(setTheme('not-a-theme'), 'classic');
assert.equal(getThemeId(), 'classic');

const lightTheme = THEMES.find(theme => theme.id === 'light');
assert.equal(lightTheme.themeColor, '#f8fafc');
assert.equal(lightTheme.preview.primary, '79 70 229');
const nothingTheme = THEMES.find(theme => theme.id === 'nothing');
assert.equal(nothingTheme.themeColor, '#000000');
assert.equal(nothingTheme.preview.primary, '235 235 235');
assert.equal(nothingTheme.preview.secondary, '142 142 142');
assert.equal(setTheme('nothing'), 'nothing');
assert.equal(root.dataset.theme, 'nothing');
assert.equal(metas['meta[name="theme-color"]'].content, '#000000');
const glassTheme = THEMES.find(theme => theme.id === 'glass');
assert.equal(glassTheme.themeColor, '#0b1220');
assert.equal(glassTheme.preview.primary, '125 211 252');
assert.equal(setTheme('glass'), 'glass');
assert.equal(root.dataset.theme, 'glass');
assert.equal(metas['meta[name="theme-color"]'].content, '#0b1220');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(indexHtml.includes('--theme-bg: 248 250 252; --theme-deep: 226 232 240; --theme-card: 255 255 255;'));
assert.ok(indexHtml.includes('--theme-secondary: 37 99 235; --p-rgb: 79 70 229; color-scheme: light;'));
assert.ok(indexHtml.includes('--theme-bg: 0 0 0; --theme-deep: 0 0 0; --theme-card: 24 24 24;'));
assert.ok(indexHtml.includes('--theme-secondary: 142 142 142; --p-rgb: 235 235 235; --nothing-red: 215 25 33; color-scheme: dark;'));
assert.ok(indexHtml.includes(':root[data-theme="nothing"] h1') && indexHtml.includes('color: rgb(var(--theme-text-100)) !important;'),
  'Nothing headings should remain crisp and readable');
assert.ok(indexHtml.includes(':root[data-theme="nothing"] .top-header-title-dots')
  && indexHtml.includes(':root[data-theme="nothing"] .dot-text-glyph'),
  'Nothing top header uses the same 3-by-5 dot cells as score numerals');
assert.ok(indexHtml.includes(':root[data-theme="glass"] .title-card')
  && indexHtml.includes('backdrop-filter: blur(16px) saturate(138%)')
  && indexHtml.includes('theme-preview-glass'),
  'Glass theme renders translucent frosted panels and a distinct palette preview');
assert.ok(indexHtml.includes(':root[data-theme="nothing"] .rating-dot-digit') && indexHtml.includes('grid-template-columns: repeat(3, 3px);'),
  'Nothing rating numerals should use a clear dot-matrix grid');
assert.ok(indexHtml.includes('width: 56px;') && indexHtml.includes('justify-content: center;'),
  'Nothing rating glyphs should fit inside centered score badges');
assert.ok(indexHtml.includes('.search-ratings-list { display: flex; flex-direction: column; align-items: flex-end;'),
  'search participant ratings should align at the right side of each result');
assert.ok(indexHtml.includes('width: 112px;') && indexHtml.includes('height: 76px;'),
  'Nothing average-rating badge should have a roomy oval shape like the feed badge');
assert.ok(indexHtml.includes('.rating-score-badge.rating-score-mid { --rating-score-color: #d69e16; }'),
  'Nothing rating dots should preserve the rating color');
const feedJs = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');
const profileJs = await readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8');
assert.ok(profileJs.includes("theme.id === 'glass' ? 'theme-preview-glass' : ''"),
  'Glass receives its own profile palette preview');
assert.ok(feedJs.includes('top-header-title text-xl') && feedJs.includes('renderDotMatrixText(`Привет, ${currentUser.profile.username}!`)'),
  'feed header renders real dot-matrix glyphs instead of a dotted texture clipped to regular text');
assert.ok(feedJs.includes('А: [\'010\', \'101\', \'111\', \'101\', \'101\']')
  && feedJs.includes("DOT_TEXT_GLYPHS[character] || DOT_TEXT_GLYPHS['?']"),
  'the header dot font covers Cyrillic and uses a visible fallback for unsupported names');
assert.ok(feedJs.includes('rating-score-badge ${ratingScoreTone}'), 'feed rating badges should expose tone classes for Nothing theme styling');
assert.ok(feedJs.includes('function renderRatingDots(value)') && feedJs.includes("'7': ['111', '001', '010', '010', '010']"),
  'feed should render ratings as readable five-row dot glyphs');
assert.ok(indexHtml.includes(':root[data-theme="nothing"] .nav-btn svg'),
  'Nothing navigation icons should use circular Glyph-like buttons');
assert.ok(indexHtml.includes('.theme-preview-nothing::after'), 'the palette preview should include the signature red glyph dot');
assert.ok(indexHtml.includes("nothing: '#000000'"), 'first paint browser chrome color should match the selected Nothing theme');

const generatedCss = await readFile(new URL('../assets/tw.css', import.meta.url), 'utf8');
assert.ok(generatedCss.includes('var(--theme-raised)/var(--tw-bg-opacity)'), 'slate surface utilities must use theme tokens');
assert.ok(generatedCss.includes('var(--theme-card)/.7'), 'translucent card surfaces must use theme tokens');
assert.ok(generatedCss.includes('var(--theme-text-500)'), 'neutral text utilities must use theme tokens');
assert.ok(generatedCss.includes('var(--theme-border)/.6'), 'translucent borders must use theme tokens');
console.log('Theme selection, persistence, metadata, and generated utility colors: OK.');

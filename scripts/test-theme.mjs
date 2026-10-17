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
assert.equal(THEMES.length, 4);
assert.equal(setTheme('ocean'), 'ocean');
assert.equal(root.dataset.theme, 'ocean');
assert.equal(metas['meta[name="theme-color"]'].content, '#07131d');
assert.equal(setTheme('light'), 'light');
assert.equal(metas['meta[name="apple-mobile-web-app-status-bar-style"]'].content, 'default');
assert.equal(setTheme('not-a-theme'), 'classic');
assert.equal(getThemeId(), 'classic');

const generatedCss = await readFile(new URL('../assets/tw.css', import.meta.url), 'utf8');
assert.ok(generatedCss.includes('var(--theme-raised)/var(--tw-bg-opacity)'), 'slate surface utilities must use theme tokens');
assert.ok(generatedCss.includes('var(--theme-card)/.7'), 'translucent card surfaces must use theme tokens');
assert.ok(generatedCss.includes('var(--theme-text-500)'), 'neutral text utilities must use theme tokens');
assert.ok(generatedCss.includes('var(--theme-border)/.6'), 'translucent borders must use theme tokens');
console.log('Theme selection, persistence, metadata, and generated utility colors: OK.');

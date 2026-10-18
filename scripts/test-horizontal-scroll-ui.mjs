#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const feed = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');
const profile = await readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8');
const modal = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/tw-input.css', import.meta.url), 'utf8');

for (const [file, source] of [['Feed.js', feed], ['Profile.js', profile], ['RatingModal.js', modal]]) {
  for (const match of source.matchAll(/class="([^"]*overflow-x-(?:auto|scroll)[^"]*)"/g)) {
    assert.match(match[1], /scrollbar-hide/, `${file} horizontal scroller should not show a 1px native scrollbar`);
  }
}
assert.match(styles, /\.scrollbar-hide\s*\{/);
assert.match(styles, /\.scrollbar-hide::-webkit-scrollbar\s*\{\s*display:\s*none/);

assert.match(modal, /const showFriendRatingsPopover = sharedRatings\.length > 1/,
  'one shared rating is already labeled, so it should not open a redundant popover');
assert.match(modal, /franchise-scroll-left hidden absolute/);
assert.match(modal, /franchise-scroll-right hidden absolute/);
assert.match(modal, /tabs\.dataset\.scrollGutters !== 'true'/,
  'scroll controls reserve padding inside the viewport, not by resizing it at the ends');

console.log('Single-rating popover and horizontal-scrollbar behavior: OK');

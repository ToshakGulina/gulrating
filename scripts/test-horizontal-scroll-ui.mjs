#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fitSmallHorizontalOverflow } from '../src/lib/horizontalOverflow.js';

const tinyOverflow = {
  width: 108,
  clientWidth: 100,
  classList: {
    classes: new Set(),
    add(value) { this.classes.add(value); },
    remove(value) { this.classes.delete(value); },
    contains(value) { return this.classes.has(value); },
  },
  get scrollWidth() {
    return this.width - (this.classList.contains('overflow-fit-small') ? 12 : 0);
  },
};
assert.equal(fitSmallHorizontalOverflow(tinyOverflow), 0);
assert.equal(tinyOverflow.classList.contains('overflow-fit-small'), true,
  'a tiny overflow should be fixed by tightening the row, not by scrolling');

tinyOverflow.width = 160;
assert.equal(fitSmallHorizontalOverflow(tinyOverflow), 60);
assert.equal(tinyOverflow.classList.contains('overflow-fit-small'), false,
  'a substantial overflow should remain scrollable and keep its normal item sizes');

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/tw-input.css', import.meta.url), 'utf8');
const modal = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
const feed = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');

assert.match(main, /installHorizontalOverflowFit\(\)/,
  'tiny-overflow fit should cover dynamically rendered horizontal scrollers');
assert.match(styles, /\.overflow-fit-small\s*\{/);
assert.match(styles, /\.overflow-fit-small\s*>\s*\*\s*\{[^}]*flex-shrink:\s*1/);
assert.match(styles, /\.overflow-x-auto[^}]*scrollbar-width:\s*none/);
assert.match(styles, /\.overflow-x-auto::-webkit-scrollbar[^}]*display:\s*none/);
assert.match(modal, /fitSmallHorizontalOverflow\(tabs\)/,
  'franchise tabs should contract before enabling scroll controls');
assert.match(modal, /franchise-scroll-left hidden h-8/);
assert.match(modal, /franchise-scroll-right hidden h-8/);
assert.doesNotMatch(modal, /franchise-scroll-(?:left|right)[^\"]*absolute/,
  'scroll controls should remain in normal flow and leave with the modal content while scrolling vertically');
assert.match(feed, /class="[^"]*history-titles-row[^"]*"/);
assert.match(feed, /data-overflow-fit-tolerance="48"/);
assert.match(feed, /fitSmallHorizontalOverflow\(historyTitlesRow\)/,
  'search history gets an immediate fit after its dropdown becomes visible');
assert.match(modal, /const showFriendRatingsPopover = sharedRatings\.length > 1/,
  'one shared rating is already labeled, so it should not open a redundant popover');

console.log('Tiny horizontal overflow contracts; substantial rows remain scrollable: OK');

#!/usr/bin/env node
// The feed search header and filter panel must align without competing sticky layers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const feed = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const filterHeader = feed.match(/<div id="feed-filters"[^>]*>/)?.[0] || '';

assert.ok(filterHeader, 'the feed filter panel is present');
assert.match(filterHeader, /class="feed-filter-panel/,
  'filter section uses its own layout instead of reusing the app header card');
assert.doesNotMatch(filterHeader, /app-header|sticky|z-10/,
  'the filter panel cannot create a mismatched sticky header overlapping the main one');
assert.match(html, /\.app-header\s*\{[\s\S]*?margin:\s*\.5rem\s+\.5rem\s+0/,
  'the primary app header keeps its common outer alignment');
assert.match(html, /\.feed-filter-panel\s*\{[\s\S]*?margin-left:\s*-\.5rem;[\s\S]*?margin-right:\s*-\.5rem;[\s\S]*?border-radius:\s*1\.5rem/,
  'the feed filter panel expands to the same outer width as the main header');
console.log('Main site header and feed filter panel align and no longer overlap: OK');

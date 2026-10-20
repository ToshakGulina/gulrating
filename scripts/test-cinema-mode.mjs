#!/usr/bin/env node
// Cinema mode should give the embedded player the entire viewport and a clear way back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');

assert.match(player, /id="watch-cinema"[^>]*aria-pressed="false"[^>]*aria-label="Включить кинорежим"/,
  'the player exposes an accessible cinema-mode toggle');
assert.match(player, /ov\.classList\.toggle\('cinema-mode', cinemaMode\)/,
  'the toggle applies and removes cinema mode on the player overlay');
assert.match(player, /ov\.addEventListener\('pointermove', revealCinemaCursor\)/,
  'mouse movement reveals the cursor in cinema mode');
assert.match(player, /},\s*1200\)/,
  'the cursor hides again after brief inactivity');
assert.match(player, /cinema-cursor-hidden/,
  'cursor visibility is managed separately from the exit control');
assert.match(html, /\.watch-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 2\.75rem 2\.75rem/,
  'the title and two header controls use fixed, non-overlapping columns');
assert.match(html, /\.watch-cinema-toggle, \.watch-close\s*\{[\s\S]*?width:\s*2\.75rem[\s\S]*?height:\s*2\.75rem/,
  'cinema and close controls have equal square dimensions');
assert.match(html, /cinema-cursor-hidden[\s\S]*?cursor:\s*none\s*!important/,
  'cinema mode hides the pointer after inactivity');
assert.match(player, /cinemaBtn\.setAttribute\('aria-pressed', String\(cinemaMode\)\)/,
  'assistive technology can read the current toggle state');
assert.match(player, /if \(cinemaMode\) \{\s*setCinemaMode\(false\);\s*return;/,
  'Escape exits cinema mode before closing the player');
assert.match(player, /document\.documentElement\.classList\.add\('watch-player-open'\)[\s\S]*?document\.body\.style\.overflow = 'hidden'/,
  'opening the player locks background scrolling and removes the page scrollbar');
assert.match(player, /document\.body\.style\.overflow = previousBodyOverflow[\s\S]*?classList\.remove\('watch-player-open'\)/,
  'closing the player restores the previous page scrolling state');
assert.match(player, /class="watch-controls[\s\S]*?class="watch-footer/,
  'provider, dub, and playback hint controls are grouped as surrounding chrome');
assert.match(html, /#watch-overlay\.cinema-mode #watch-stage[\s\S]*?inset:\s*0[\s\S]*?width:\s*100vw[\s\S]*?height:\s*100vh[\s\S]*?height:\s*100dvh[\s\S]*?background:\s*#000/,
  'cinema mode expands the player to a pure-black, edge-to-edge viewport');
assert.match(html, /#watch-overlay\.cinema-mode \.watch-controls,[\s\S]*?#watch-overlay\.cinema-mode \.watch-footer\s*\{\s*display:\s*none/,
  'all provider and footer chrome disappears outside the player');
assert.match(html, /\* \{ scrollbar-width:\s*none;\s*-ms-overflow-style:\s*none;\s*\}/,
  'the site hides the global browser scrollbar while retaining touch and wheel scrolling');
assert.match(html, /#watch-overlay \*::-webkit-scrollbar[\s\S]*?display:\s*none\s*!important/,
  'the player overlay hides embedded UI scrollbars instead of showing the global gray scrollbar');
assert.match(html, /#watch-overlay\.cinema-mode \.watch-header > :not\(#watch-cinema\)\s*\{\s*display:\s*none/,
  'the title and close chrome are hidden while an accessible exit control remains');
console.log('Cinema mode expands the player, hides surrounding controls, and exits accessibly: OK');

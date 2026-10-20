#!/usr/bin/env node
// Continuing a playback-history item should launch the remembered dub, not stop at a source list.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const profile = await readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
const continueHandler = profile.match(/box\.querySelectorAll\('\.wh-continue'\)[\s\S]*?\n    \}\)\);/)?.[0] || '';

assert.ok(continueHandler, 'playback history has a Continue action');
assert.match(continueHandler, /resumeFromHistory:\s*true/,
  'Continue tells the player to auto-launch the remembered dub');
assert.doesNotMatch(continueHandler, /window\.location\.href/,
  'Continue stays in the player flow instead of opening a bare provider page');
assert.match(player, /resumeFromHistory\s*=\s*false/,
  'normal Watch actions keep their existing explicit-play behavior');
assert.match(player, /gulrating:last_dub/,
  'the most recently selected provider and dub are persisted locally');
assert.match(player, /if \(hasPlayed \|\| resumeFromHistory\)[\s\S]*?play\(resumeDub, startG, true\)[\s\S]*?if \(resumeFromHistory\) remember\(\)/,
  'Continue auto-starts the best available remembered dub and records a fallback selection');
console.log('Playback history Continue auto-starts the remembered dub (or available fallback): OK');

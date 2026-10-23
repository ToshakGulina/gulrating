#!/usr/bin/env node
// Unfinished playback belongs to the In Progress status; only completed titles appear in playback history.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

const { getCompletedWatchHistory, getUnfinishedWatchHistory } = await import('../src/lib/watchHistory.js');
storage.set('gulrating:watch_history', JSON.stringify([
  { id: 101, key: 'tv:101', title: 'Unfinished series' },
  { id: 102, key: 'movie:102', title: 'Completed film', done: { at: 123 } },
]));
assert.deepEqual(getUnfinishedWatchHistory().map(item => item.id), [101],
  'playback with no completion marker is classified as unfinished');
assert.deepEqual(getCompletedWatchHistory().map(item => item.id), [102],
  'only entries explicitly marked complete belong to playback history');

const profile = await readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8');
const modal = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
assert.match(profile, /for \(const item of getUnfinishedWatchHistory\(\)\)[\s\S]*?queueUserTitleStatus\(currentUser\.id, item\.id, item\.media_type, 'in_progress'\)/,
  'legacy unfinished entries are migrated to the personal In Progress status');
assert.match(profile, /const history = getCompletedWatchHistory\(\)/,
  'the playback-history section excludes unfinished entries');
assert.match(profile, /const resumableItems = new Map\(getUnfinishedWatchHistory\(\)[\s\S]*?profile-continue-watch/,
  'unfinished entries get a Continue action on their In Progress cards');
assert.match(modal, /addWatchEntry\([\s\S]*?queueUserTitleStatus\(currentUser\.id, titleId, mediaType, 'in_progress'\)/,
  'starting playback assigns In Progress unless the title is already rated or explicitly completed/dropped');
console.log('Unfinished playback routes to In Progress; completed playback remains in its separate history section: OK');

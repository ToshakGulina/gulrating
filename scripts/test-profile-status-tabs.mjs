#!/usr/bin/env node
// Regression test: each profile status tab includes rated and unrated titles in that status only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const profileSource = await readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8');
const tabSource = profileSource.match(/const PROFILE_ACTIVITY_TABS = \[([\s\S]*?)\];/)?.[1] || '';
const tabs = [...tabSource.matchAll(/\{ id: '([^']+)', label: '([^']+)' \}/g)].map(([, id, label]) => [id, label]);
assert.deepEqual(tabs, [
  ['in_progress', 'В процессе'],
  ['watched', 'Просмотрено'],
  ['watchlist', 'Хочу посмотреть'],
  ['dropped', 'Заброшено'],
], 'profile tabs have the requested order');
assert.ok(!profileSource.includes('id="watch-history"') && !profileSource.includes('id="watched-history"'), 'standalone playback history sections are removed');
assert.ok(profileSource.includes('id="profile-playback-history"'), 'playback history has a dedicated section outside the status tab panel');
assert.ok(profileSource.includes('const history = getWatchHistory();') && profileSource.includes('renderPlaybackRows(history)'), 'all playback history renders in its own section');
assert.ok(profileSource.includes('profileContent.innerHTML = renderProfileStatusTab('), 'status tabs render only title ratings and statuses');
assert.match(profileSource, /profileContent\.animate\(\[/,
  'changing profile status tabs slides the new card list horizontally');
assert.match(profileSource, /prefers-reduced-motion: reduce/,
  'profile tab transitions respect reduced-motion accessibility settings');
assert.ok(!profileSource.includes("getWatchHistory().filter(item => item.done)"), 'playback history is not injected into the Watched tab');
assert.ok(profileSource.includes('queueUserTitleStatus'), 'offline menu changes are saved for later sync');
assert.ok(!profileSource.includes("${currentUser.offlineOnly ? 'disabled' : ''}"), 'status menus stay enabled in offline mode');
const statusControls = [...profileSource.matchAll(/<select class="profile-status-select([^\"]*)"/g)];
assert.equal(statusControls.length, 3, 'each profile card type has a status control');
assert.ok(statusControls.every(([, classes]) => classes.includes('w-[112px]')), 'status labels have enough width to remain readable');
const modalSource = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
assert.ok(modalSource.includes('getCachedTitleDetails') && modalSource.includes('getCachedUserTitleStatus'), 'offline title cards open from local data');
assert.ok(!modalSource.includes('disabled title="Недоступно офлайн"'), 'title-card status selector is enabled offline');
assert.ok(modalSource.includes('queueUserTitleStatus'), 'title-card status selection queues offline');
const match = profileSource.match(/function renderProfileStatusTab\([\s\S]*?(?=\nfunction renderWatchlist\()/);
assert.ok(match, 'profile status tab renderer exists');

const context = {
  PROFILE_ACTIVITY_TABS: [
    { id: 'in_progress', label: 'В процессе' },
    { id: 'watched', label: 'Просмотрено' },
    { id: 'watchlist', label: 'Хочу посмотреть' },
    { id: 'dropped', label: 'Заброшено' },
  ],
  renderWatchlist: items => `watchlist:${items.map(item => item.title_id).join('|')}`,
  renderMyRatings: items => `rated:${items.map(item => item.title_id).join('|')}`,
  renderTitleStatuses: items => `unrated:${items.map(item => item.title_id).join('|')}`,
  escapeHtml: value => String(value),
};
vm.runInNewContext(`${match[0]}\nthis.renderProfileStatusTab = renderProfileStatusTab;`, context);

const ratings = [
  { title_id: 1, titles: { id: 1, media_type: 'movie' } },
  { title_id: 2, titles: { id: 2, media_type: 'tv' } },
  { title_id: 3, titles: { id: 3, media_type: 'movie' } },
];
const statuses = [
  { title_id: 1, status: 'watched', titles: { id: 1, media_type: 'movie' } }, // rated duplicate must not render twice
  { title_id: 1, status: 'in_progress', titles: { id: 1, media_type: 'movie' } }, // even inconsistent duplicate status must be hidden
  { title_id: 4, status: 'watched', titles: { id: 4, media_type: 'movie' } },
  { title_id: 2, status: 'in_progress', titles: { id: 2, media_type: 'tv' } },
  { title_id: 5, status: 'in_progress', titles: { id: 5, media_type: 'tv' } },
  { title_id: 3, status: 'dropped', titles: { id: 3, media_type: 'movie' } },
  { title_id: 6, status: 'dropped', titles: { id: 6, media_type: 'movie' } },
];
const byId = new Map([['1', 'watched'], ['2', 'in_progress'], ['3', 'dropped']]);
const watchlist = [
  { title_id: 1 }, // old inconsistent data should not put a rated title in the watchlist
  { title_id: 7 },
];
const currentUser = {};
const render = (tab) => context.renderProfileStatusTab(tab, ratings, watchlist, statuses, byId, currentUser);

assert.equal(render('watched'), 'rated:1unrated:4');
assert.equal(render('in_progress'), 'rated:2unrated:5');
assert.equal(render('dropped'), 'rated:3unrated:6');
assert.equal(render('watchlist'), 'watchlist:7');
console.log('Profile status tabs include rated and unrated titles without duplicates: OK');

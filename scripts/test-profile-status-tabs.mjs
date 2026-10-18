#!/usr/bin/env node
// Regression test: each profile status tab includes rated and unrated titles in that status only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const profileSource = await readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8');
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
    { id: 'watchlist', label: 'Хочу посмотреть' },
    { id: 'in_progress', label: 'В процессе' },
    { id: 'watched', label: 'Просмотрено' },
    { id: 'dropped', label: 'Заброшено' },
  ],
  renderWatchlist: items => `watchlist:${items.map(item => item.title_id).join('|')}`,
  renderMyRatings: items => `rated:${items.map(item => item.title_id).join('|')}`,
  renderTitleStatuses: items => `unrated:${items.map(item => item.title_id).join('|')}`,
  escapeHtml: value => String(value),
};
vm.runInNewContext(`${match[0]}\nthis.renderProfileStatusTab = renderProfileStatusTab;`, context);

const ratings = [
  { title_id: 1, titles: { id: 1 } },
  { title_id: 2, titles: { id: 2 } },
  { title_id: 3, titles: { id: 3 } },
];
const statuses = [
  { title_id: 1, status: 'watched', titles: { id: 1 } }, // rated duplicate must not render twice
  { title_id: 1, status: 'in_progress', titles: { id: 1 } }, // even inconsistent duplicate status must be hidden
  { title_id: 4, status: 'watched', titles: { id: 4 } },
  { title_id: 2, status: 'in_progress', titles: { id: 2 } },
  { title_id: 5, status: 'in_progress', titles: { id: 5 } },
  { title_id: 3, status: 'dropped', titles: { id: 3 } },
  { title_id: 6, status: 'dropped', titles: { id: 6 } },
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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [feed, profile] = await Promise.all([
  readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8'),
]);
const feedIcon = feed.match(/<button class="nav-btn[^\n]*data-page="feed">([\s\S]*?)<span class="text-xs">Лента<\/span>/)?.[1] || '';
const profileIcon = profile.match(/<button class="nav-btn[^\n]*data-page="feed">([\s\S]*?)<span class="text-xs">Лента<\/span>/)?.[1] || '';
assert.ok(feedIcon.includes('d="M9 6h11M9 12h11M9 18h11"') && feedIcon.includes('<circle'),
  'the feed tab uses a simple, recognizable list icon');
assert.ok(profileIcon.includes('d="M9 6h11M9 12h11M9 18h11"') && profileIcon.includes('<circle'),
  'the profile page uses the same feed icon');
assert.equal(feedIcon.match(/<svg/g)?.length, 1);
assert.equal(profileIcon.match(/<svg/g)?.length, 1);
console.log('Feed navigation uses a consistent list icon in both pages: OK.');

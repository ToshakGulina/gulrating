#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const feed = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');

assert.match(main, /syncUserData\(currentUser, 1600\)[\s\S]{0,100}\.then\(/,
  'cloud sync must not block the initial local shell');
assert.match(feed, /loadRatings\(currentUser, activeFilter\)\.catch/,
  'the feed shell should render without waiting for the rating request');
assert.match(feed, /const useOfflineCopy = Boolean\(currentUser\.offlineOnly\)/,
  'known-offline sessions should use the device cache instead of contacting Supabase');
assert.match(feed, /if \(useOfflineCopy\) \{[\s\S]*?data = cached;/,
  'cached ratings should be rendered directly in offline mode');
assert.match(auth, /navigator\.onLine === false\) return offlineUser\(user\)/,
  'an offline launch should use the locally persisted profile immediately');
assert.match(auth, /user = cachedAuthUser\(\)/,
  'a Supabase session timeout should fall back to the locally persisted account for read-only startup');
console.log('Offline launch uses local profile/cache and never holds the splash for feed or sync requests: OK');

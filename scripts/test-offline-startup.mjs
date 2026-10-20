#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const feed = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');

assert.match(main, /syncUserData\(currentUser, 5000\)[\s\S]{0,100}\.then\(/,
  'cloud sync must remain in the background and retry with a useful request timeout');
assert.match(feed, /loadRatings\(currentUser, activeFilter\)\.catch/,
  'the feed shell should render without waiting for the rating request');
assert.match(feed, /const useOfflineCopy = Boolean\(currentUser\.offlineOnly\)/,
  'known-offline sessions should use the device cache instead of contacting Supabase');
assert.match(feed, /if \(useOfflineCopy\) \{[\s\S]*?data = cached;/,
  'cached ratings should be rendered directly in offline mode');
assert.match(feed, /schedulePendingFlush\(currentUser, 1500\)/,
  'ratings queued before app startup are flushed on feed launch');
assert.match(feed, /if \(pending\.length\) \{\s*schedulePendingFlush\(pendingFlushUser\)/,
  'newly queued ratings begin retrying even without a browser online event');
assert.match(auth, /browserReportsOffline[\s\S]{0,300}withTimeout\(query, 1500\)/,
  'navigator.onLine is only a hint: profile lookup still probes the API before offline fallback');
assert.doesNotMatch(auth, /navigator\.onLine === false\) return offlineUser\(user\)/,
  'an offline hint must not skip the profile connectivity probe');
assert.match(auth, /user = cachedAuthUser\(\)/,
  'a Supabase session timeout should fall back to the locally persisted account for read-only startup');
console.log('Offline launch keeps local profile/cache fallback, probes connectivity, and does not wait for feed/cloud sync: OK');

#!/usr/bin/env node
// Ensure background account sync probes despite navigator.onLine=false and retries failures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const storage = new Map();
const dispatched = [];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
} });
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  GulRatingBridge: null,
  dispatchEvent: event => { dispatched.push(event.type); return true; },
  addEventListener() {},
} });

let selectCalls = 0;
globalThis.__mockSupabase = {
  from(table) {
    assert.equal(table, 'user_sync');
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle() {
        selectCalls += 1;
        return selectCalls === 1
          ? Promise.reject(new Error('Failed to fetch'))
          : Promise.resolve({ data: { data: {} }, error: null });
      },
      upsert() { return Promise.resolve({ error: null }); },
    };
  },
};

try {
  let source = await readFile(new URL('../src/lib/userSync.js', import.meta.url), 'utf8');
  source = source.replace("import { supabase } from './supabase.js';", 'const supabase = globalThis.__mockSupabase;')
    .replace('const RETRY_MIN_MS = 5000;', 'const RETRY_MIN_MS = 20;')
    .replace('const RETRY_MAX_MS = 120000;', 'const RETRY_MAX_MS = 40;');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { setSyncUser, syncUserData } = await import(moduleUrl);
  const user = { id: 'test-user' };
  setSyncUser(user);
  assert.equal(await syncUserData(user, 100), false, 'first network failure is reported without losing local state');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(selectCalls, 2, 'failed sync is retried automatically even while navigator reports offline');
  assert.ok(dispatched.includes('gulrating:sync-restored'), 'successful retry notifies the app to leave offline mode');
  console.log('Cloud sync retries automatically and recovers when navigator.onLine is false: OK');
} finally {
  delete globalThis.__mockSupabase;
  for (const [key, descriptor] of [['navigator', originalNavigator], ['localStorage', originalLocalStorage], ['window', originalWindow]]) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

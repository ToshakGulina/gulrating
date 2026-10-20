#!/usr/bin/env node
// New deployments must not interrupt a page the user is actively viewing.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

assert.doesNotMatch(main, /window\.location\.reload\(|build-check|reloaded_to_build/,
  'the app must not auto-reload when a newer build is deployed');
assert.doesNotMatch(worker, /skipWaiting\(|clients\.claim\(|client\.navigate\(/,
  'the service worker must wait for existing sessions instead of taking over or navigating them');
assert.match(worker, /caches\.open\(CACHE_VERSION\)[\s\S]*?cache\.addAll\(SHELL_ASSETS\)/,
  'the new offline shell is still fully cached before its normal activation');
assert.match(main, /Обновление сайта не прерывает текущую сессию/,
  'the startup code documents the non-disruptive update behavior');
console.log('Deployment updates wait for the current session; no surprise page refresh: OK');

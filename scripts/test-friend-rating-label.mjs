#!/usr/bin/env node
import assert from 'node:assert/strict';
import { friendRatingsLabel } from '../src/lib/ratingLabels.js';

assert.equal(friendRatingsLabel([]), 'Ваша оценка');
assert.equal(friendRatingsLabel([{ profiles: { username: 'Тимоха' } }]), 'Тимоха');
assert.equal(friendRatingsLabel([{ profiles: { username: 'Тимоха' } }, { profiles: { username: 'Алиса' } }]), 'Друзья');
assert.equal(friendRatingsLabel([{ profiles: {} }]), 'Участник');
assert.equal(friendRatingsLabel(null), 'Ваша оценка');

console.log('A single friend rating is labeled with the friend’s name: OK');

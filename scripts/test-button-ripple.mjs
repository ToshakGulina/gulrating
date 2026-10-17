import assert from 'node:assert/strict';
import { getRippleGeometry, RIPPLE_TARGET_SELECTOR } from '../src/lib/buttonRipple.js';

const rect = { left: 10, top: 20, width: 100, height: 50 };
assert.deepEqual(getRippleGeometry(rect, 60, 45), { x: 50, y: 25, diameter: 112 });
assert.deepEqual(getRippleGeometry(rect, 10, 20), { x: 0, y: 0, diameter: 224 });
assert.deepEqual(getRippleGeometry(rect, 500, -10), { x: 100, y: 0, diameter: 224 });
assert.ok(RIPPLE_TARGET_SELECTOR.includes('button:not(:disabled)'));
assert.ok(RIPPLE_TARGET_SELECTOR.includes('[role="button"]'));
assert.ok(RIPPLE_TARGET_SELECTOR.includes('summary'));
assert.ok(RIPPLE_TARGET_SELECTOR.includes('.cursor-pointer'));
console.log('Ripple targets native buttons and other interactive UI; geometry covers target: OK.');

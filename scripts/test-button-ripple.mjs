import assert from 'node:assert/strict';
import { getRippleGeometry } from '../src/lib/buttonRipple.js';

const rect = { left: 10, top: 20, width: 100, height: 50 };
assert.deepEqual(getRippleGeometry(rect, 60, 45), { x: 50, y: 25, diameter: 112 });
assert.deepEqual(getRippleGeometry(rect, 10, 20), { x: 0, y: 0, diameter: 224 });
assert.deepEqual(getRippleGeometry(rect, 500, -10), { x: 100, y: 0, diameter: 224 });
console.log('Button ripple starts at the click point and covers the full button: OK.');

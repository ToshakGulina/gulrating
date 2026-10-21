import assert from 'node:assert/strict';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = { location: { hostname: '' } };
const { getPositions, saveWatchPosition } = await import('../src/lib/watchHistory.js');

assert.deepEqual(getPositions(), {});
assert.equal(saveWatchPosition('movie:10', 121.8, 7200), true);
assert.deepEqual(getPositions()['movie:10'], {
  t: 121,
  d: 7200,
  at: getPositions()['movie:10'].at,
});
assert.equal(saveWatchPosition('movie:10', 125, 7200), false, 'progress writes are throttled');
assert.equal(saveWatchPosition('movie:10', 125, 7200, true), true, 'pause/close can force a final write');
assert.equal(getPositions()['movie:10'].t, 125);
assert.equal(saveWatchPosition('movie:11', 0, 7200), false, 'zero does not overwrite a saved position');

const nativeWrites = [];
window.GulRatingBridge = {
  getPositions: () => '{"tv:20":{"t":300,"d":1000,"at":1}}',
  savePlaybackPosition: (value) => { nativeWrites.push(JSON.parse(value)); return true; },
};
assert.deepEqual(getPositions(), { 'tv:20': { t: 300, d: 1000, at: 1 } });
assert.equal(saveWatchPosition('tv:20', 310, 1000, true), true, 'APK remote-player progress uses the native-owned store');
assert.deepEqual(nativeWrites, [{ t: 310, d: 1000, force: true }]);
window.GulRatingBridge.savePlaybackPosition = () => undefined;
assert.equal(saveWatchPosition('tv:20', 315, 1000), true, 'older void-returning APK bridges remain compatible');
console.log('Browser playback progress persists locally; remote APK events use the native-owned history: OK.');

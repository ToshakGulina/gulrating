import assert from 'node:assert/strict';

class FakePage {
  dataset = {};
  state = {};
}

const rootDocument = { style: { scrollBehavior: '' } };
globalThis.document = {
  documentElement: rootDocument,
  createElement: () => new FakePage(),
};
globalThis.window = {
  scrollY: 0,
  scrollTo(_x, y) { this.scrollY = y; },
  dispatchEvent() {},
};
globalThis.requestAnimationFrame = callback => callback();

const { mountPage, activePageKey, clearPageState } = await import('../src/lib/pageState.js');
const app = {
  children: [],
  get firstElementChild() { return this.children[0] || null; },
  replaceChildren(...nodes) { this.children = nodes; },
};

const feed = mountPage(app, 'feed');
assert.equal(feed.isNew, true);
feed.root.state = { filter: 'tv', query: 'Arrival', tab: 'week' };
window.scrollY = 360;

const profile = mountPage(app, 'profile');
assert.equal(profile.isNew, true);
assert.equal(activePageKey(app), 'profile');
profile.root.state.settingsTab = 'settings';
window.scrollY = 95;

const restoredFeed = mountPage(app, 'feed');
assert.equal(restoredFeed.isNew, false);
assert.equal(restoredFeed.root, feed.root);
assert.deepEqual(restoredFeed.root.state, { filter: 'tv', query: 'Arrival', tab: 'week' });
assert.equal(window.scrollY, 360);

const restoredProfile = mountPage(app, 'profile');
assert.equal(restoredProfile.root, profile.root);
assert.equal(restoredProfile.root.state.settingsTab, 'settings');
assert.equal(window.scrollY, 95);

clearPageState(app);
assert.equal(activePageKey(app), null);
assert.equal(app.children.length, 0);
console.log('Page tab cache preserves view identity, state, scroll, and clears cleanly.');

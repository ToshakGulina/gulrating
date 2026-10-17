// Keep the last DOM tree for each main app tab alive. Detaching inactive pages
// preserves scroll, filters, search text, selected sub-tabs, and event handlers.
const pageStores = new WeakMap();

function getStore(app) {
  let store = pageStores.get(app);
  if (!store) {
    store = { pages: new Map(), scroll: new Map() };
    pageStores.set(app, store);
  }
  return store;
}

function restoreScroll(y) {
  requestAnimationFrame(() => {
    const html = document.documentElement;
    const priorBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    requestAnimationFrame(() => { html.style.scrollBehavior = priorBehavior; });
  });
}

export function mountPage(app, key) {
  const store = getStore(app);
  const current = app.firstElementChild;

  if (current?.dataset.appPage === key) {
    return { root: current, isNew: false };
  }

  if (current?.dataset.appPage) {
    store.pages.set(current.dataset.appPage, current);
    store.scroll.set(current.dataset.appPage, window.scrollY || 0);
  }

  const cached = store.pages.get(key);
  if (cached) {
    app.replaceChildren(cached);
    restoreScroll(store.scroll.get(key) || 0);
    return { root: cached, isNew: false };
  }

  const root = document.createElement('div');
  root.dataset.appPage = key;
  app.replaceChildren(root);
  store.scroll.set(key, 0);
  restoreScroll(0);
  return { root, isNew: true };
}

export function activePageKey(app) {
  return app?.firstElementChild?.dataset.appPage || null;
}

export function clearPageState(app) {
  pageStores.delete(app);
  if (app) app.replaceChildren();
  window.dispatchEvent(new Event('gulrating:pages-cleared'));
}

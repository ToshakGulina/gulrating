import * as anime from '../../vendor/anime.esm.min.js';

const { animate, createTimeline, spring, stagger } = anime;

const CARD_SELECTOR = '.title-card, .rec-card, .history-title, .catalog-item, .search-result-item';
const SURFACE_SELECTOR = '.app-header, #blk-feed, #blk-trends, #blk-recs, .profile-section-panel:not(.hidden), nav.fixed, #toast-container > *';
const OVERLAY_SELECTOR = '.fixed.inset-0';

let motionQuery = null;
let motionRoot = null;
let motionInstalled = false;
let mutationObserver = null;
let viewportObserver = null;
let reducedMotionHandler = null;
const runningAnimations = new Set();
const pendingCompletions = new Set();
const preparedElements = new Set();
const seenSurfaces = new WeakSet();
const seenCards = new WeakSet();
const seenOverlays = new WeakSet();
const transitioningApps = new WeakSet();

function isMotionEnabled() {
  return motionInstalled && !motionQuery?.matches;
}

function track(animation) {
  if (!animation) return animation;
  runningAnimations.add(animation);
  animation.then?.(
    () => runningAnimations.delete(animation),
    () => runningAnimations.delete(animation),
  );
  return animation;
}

function prepare(element, opacity, transform) {
  element.style.opacity = String(opacity);
  element.style.transform = transform;
  preparedElements.add(element);
}

function clearPrepared(elements) {
  for (const element of elements) {
    element.style.removeProperty('opacity');
    element.style.removeProperty('transform');
    preparedElements.delete(element);
  }
}

function animateSurfaceBatch(elements, force = false) {
  const targets = elements.filter(element => {
    if (force) seenSurfaces.delete(element);
    if (seenSurfaces.has(element)) return false;
    seenSurfaces.add(element);
    return true;
  });
  if (!targets.length || !isMotionEnabled()) return;

  targets.forEach(element => prepare(element, 0, 'translateY(-16px) scale(.975)'));
  track(animate(targets, {
    opacity: [0, 1],
    y: [-16, 0],
    scale: [.975, 1],
    delay: stagger(48),
    duration: 470,
    ease: spring({ bounce: .18 }),
    onComplete: () => clearPrepared(targets),
  }));
}

function revealCards(elements, force = false) {
  const targets = elements.filter(element => {
    if (force) {
      seenCards.delete(element);
      viewportObserver?.unobserve(element);
    }
    if (seenCards.has(element)) return false;
    seenCards.add(element);
    prepare(element, 0, 'translateY(22px) scale(.965)');
    return true;
  });
  if (!targets.length) return;
  if (!viewportObserver) {
    animateCardBatch(targets);
    return;
  }
  for (const element of targets) viewportObserver.observe(element);
}

function animateCardBatch(elements) {
  if (!elements.length || !isMotionEnabled()) {
    clearPrepared(elements);
    return;
  }
  track(animate(elements, {
    opacity: [0, 1],
    y: [22, 0],
    scale: [.965, 1],
    delay: stagger(42),
    duration: 520,
    ease: spring({ bounce: .2 }),
    onComplete: () => clearPrepared(elements),
  }));
}

function collectMatches(node, selector, output) {
  if (node?.nodeType !== 1) return;
  if (node.matches(selector)) output.add(node);
  node.querySelectorAll(selector).forEach(element => output.add(element));
}

function getOverlayPanel(overlay) {
  return overlay.querySelector('.rating-modal-panel')
    || (overlay.firstElementChild?.matches('.bg-card, img') ? overlay.firstElementChild : null)
    || overlay.firstElementChild;
}

function enterOverlay(overlay) {
  // Franchise hand-offs own the incoming modal's opacity/transform. The normal
  // modal entrance would race that transition and make the tab change look static.
  if (overlay.dataset?.franchiseTransitioning === 'true') return;
  if (seenOverlays.has(overlay) || !isMotionEnabled()) return;
  seenOverlays.add(overlay);
  const panel = getOverlayPanel(overlay);
  const detailNodes = panel
    ? [...panel.querySelectorAll('.app-header, #modal-content > *')].slice(0, 7)
    : [];
  prepare(overlay, 0, 'none');
  if (panel) prepare(panel, 0, 'translateY(28px) scale(.94)');
  detailNodes.forEach(element => prepare(element, 0, 'translateY(12px) scale(.985)'));

  const timeline = createTimeline();
  timeline
    .add(overlay, { opacity: [0, 1], duration: 260, ease: 'out(3)' }, 0);
  if (panel) {
    timeline.add(panel, {
      opacity: [0, 1], y: [28, 0], scale: [.94, 1],
      duration: 520, ease: spring({ bounce: .22 }),
    }, 0);
  }
  if (detailNodes.length) {
    timeline.add(detailNodes, {
      opacity: [0, 1], y: [12, 0], scale: [.985, 1],
      delay: stagger(34), duration: 330, ease: 'out(3)',
    }, 130);
  }
  track(timeline);
  timeline.then?.(() => clearPrepared([overlay, ...(panel ? [panel] : []), ...detailNodes]));
}

function inspectAddedNode(node) {
  if (node?.nodeType !== 1) return;

  const overlays = new Set();
  collectMatches(node, OVERLAY_SELECTOR, overlays);
  overlays.forEach(enterOverlay);
  const containingOverlay = node.matches(OVERLAY_SELECTOR) ? node : node.closest(OVERLAY_SELECTOR);

  const surfaces = new Set();
  if (!containingOverlay) collectMatches(node, SURFACE_SELECTOR, surfaces);
  animateSurfaceBatch([...surfaces]);

  const cards = new Set();
  collectMatches(node, CARD_SELECTOR, cards);
  revealCards([...cards]);
}

function stopMotion() {
  if (mutationObserver) mutationObserver.disconnect();
  if (viewportObserver) viewportObserver.disconnect();
  motionInstalled = false;
  document.documentElement.classList.remove('anime-motion-ready');
  for (const complete of [...pendingCompletions]) complete();
  for (const animation of runningAnimations) animation.cancel?.();
  runningAnimations.clear();
  for (const element of preparedElements) {
    element.style.removeProperty('opacity');
    element.style.removeProperty('transform');
  }
  preparedElements.clear();
}

export function installAppMotion(root = document.body) {
  if (typeof window === 'undefined' || !root) return () => {};
  motionRoot = root;
  motionQuery ||= window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;

  if (!reducedMotionHandler && motionQuery?.addEventListener) {
    reducedMotionHandler = event => {
      if (event.matches) stopMotion();
      else installAppMotion(motionRoot || document.body);
    };
    motionQuery.addEventListener('change', reducedMotionHandler);
  }
  if (motionQuery?.matches) {
    stopMotion();
    return stopMotion;
  }
  if (motionInstalled) return stopMotion;

  motionInstalled = true;
  document.documentElement.classList.add('anime-motion-ready');
  if ('IntersectionObserver' in window) {
    viewportObserver = new IntersectionObserver(entries => {
      const visibleCards = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        viewportObserver.unobserve(entry.target);
        visibleCards.push(entry.target);
      }
      animateCardBatch(visibleCards);
    }, { threshold: .12, rootMargin: '0px 0px -28px 0px' });
  }

  root.querySelectorAll(`${OVERLAY_SELECTOR}, ${SURFACE_SELECTOR}, ${CARD_SELECTOR}`).forEach(element => {
    if (element.matches(OVERLAY_SELECTOR)) enterOverlay(element);
    else inspectAddedNode(element);
  });
  mutationObserver = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) inspectAddedNode(node);
    }
  });
  mutationObserver.observe(root, { childList: true, subtree: true });
  return stopMotion;
}

export function animateProfilePanel(panel) {
  if (!panel || !isMotionEnabled()) return false;
  prepare(panel, 0, 'translateY(16px) scale(.985)');
  track(animate(panel, {
    opacity: [0, 1], y: [16, 0], scale: [.985, 1],
    duration: 420, ease: spring({ bounce: .16 }),
    onComplete: () => clearPrepared([panel]),
  }));
  return true;
}

export function animateScoreBubble(bubble, score) {
  if (!bubble || !isMotionEnabled()) return false;
  const glow = Number(score) >= 8 ? '52 211 153' : Number(score) >= 5 ? '251 191 36' : '251 113 133';
  track(animate(bubble, {
    scale: [.84, 1.18, 1],
    boxShadow: [
      '0 3px 10px rgb(2 8 23 / .2)',
      `0 0 24px rgb(${glow} / .58), 0 8px 20px rgb(2 8 23 / .28)`,
      `0 0 12px rgb(${glow} / .2), 0 4px 12px rgb(2 8 23 / .2)`,
    ],
    duration: 440,
    ease: spring({ bounce: .36 }),
  }));
  return true;
}

export function animateOverlayExit(overlay, onComplete, slideDirection = 0) {
  if (!overlay || !isMotionEnabled()) return false;
  const panel = getOverlayPanel(overlay);
  const exitX = slideDirection ? -Math.sign(slideDirection) * Math.min(window.innerWidth * .28, 300) : 0;
  let finished = false;
  const complete = () => {
    if (finished) return;
    finished = true;
    pendingCompletions.delete(complete);
    onComplete?.();
  };
  pendingCompletions.add(complete);
  track(animate(overlay, {
    opacity: [1, 0], duration: slideDirection ? 220 : 260, ease: 'in(3)',
    ...(!panel ? { onComplete: complete } : {}),
  }));
  if (panel) {
    track(animate(panel, {
      opacity: [1, 0], y: slideDirection ? [0, 0] : [0, 20],
      ...(slideDirection ? { x: [0, exitX] } : {}),
      scale: slideDirection ? [1, .985] : [1, .965],
      duration: slideDirection ? 300 : 300, ease: 'in(3)', onComplete: complete,
    }));
  }
  return true;
}

export function animateFranchiseModalEnter(overlay, slideDirection) {
  if (!overlay || !slideDirection) return false;
  const panel = getOverlayPanel(overlay);
  if (!panel) return false;
  const enterX = Math.sign(slideDirection) * Math.min(window.innerWidth * .28, 300);
  // Set before MutationObserver sees the appended modal and starts its generic entrance.
  overlay.dataset.franchiseTransitioning = 'true';
  const enteringClasses = ['franchise-slide-enter', 'franchise-slide-enter-forward', 'franchise-slide-enter-backward'];
  const originalPanelStyle = {
    animation: panel.style.animation,
    transition: panel.style.transition,
    opacity: panel.style.opacity,
    transform: panel.style.transform,
    willChange: panel.style.willChange,
  };
  const originalOverlayStyle = {
    animation: overlay.style.animation,
    transition: overlay.style.transition,
    opacity: overlay.style.opacity,
  };

  // Use explicit style transitions for the hand-off. Unlike competing CSS
  // keyframes or an animation-engine timeline, these also run in older Android
  // WebViews where Element.animate() is absent or unreliable.
  panel.classList.remove(...enteringClasses);
  panel.style.animation = 'none';
  overlay.style.animation = 'none';
  panel.style.transition = 'none';
  overlay.style.transition = 'none';
  panel.style.opacity = '0';
  panel.style.transform = `translateX(${enterX}px) scale(.985)`;
  panel.style.willChange = 'opacity, transform';
  overlay.style.opacity = '0';

  // Commit the starting styles before applying the destination styles.
  void panel.offsetWidth;
  void overlay.offsetWidth;
  const requestFrame = window.requestAnimationFrame?.bind(window)
    || (callback => window.setTimeout(callback, 16));
  requestFrame(() => {
    // The app-wide reduced-motion stylesheet uses !important transition durations.
    // Franchise navigation is explicitly requested motion, so this short hand-off
    // overrides that global cap instead of silently becoming visually static.
    panel.style.setProperty('transition', 'opacity 440ms cubic-bezier(.2,.75,.25,1), transform 440ms cubic-bezier(.2,.75,.25,1)', 'important');
    overlay.style.setProperty('transition', 'opacity 180ms cubic-bezier(.2,.75,.25,1)', 'important');
    panel.style.opacity = '1';
    panel.style.transform = 'translateX(0) scale(1)';
    overlay.style.opacity = '1';
  });

  window.setTimeout(() => {
    for (const [property, value] of Object.entries(originalPanelStyle)) panel.style[property] = value;
    for (const [property, value] of Object.entries(originalOverlayStyle)) overlay.style[property] = value;
    panel.classList.remove(...enteringClasses);
    delete overlay.dataset.franchiseTransitioning;
  }, 500);
  return true;
}

export function transitionAppPage(app, targetPage, render) {
  if (!app || typeof render !== 'function') return false;
  const current = app.firstElementChild;
  if (!isMotionEnabled() || !current || current.dataset.appPage === targetPage) {
    render();
    return false;
  }
  if (transitioningApps.has(app)) return false;
  transitioningApps.add(app);

  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    pendingCompletions.delete(finish);
    current.style.removeProperty('opacity');
    current.style.removeProperty('transform');
    try {
      await render();
      requestAnimationFrame(() => {
        const nextPage = app.firstElementChild;
        if (nextPage) animatePageEnter(nextPage);
      });
    } finally {
      window.setTimeout(() => transitioningApps.delete(app), 480);
    }
  };
  pendingCompletions.add(finish);
  prepare(current, 1, 'translateY(0) scale(1)');
  track(animate(current, {
    opacity: [1, 0], y: [0, -14], scale: [1, .99],
    duration: 190, ease: 'in(2)', onComplete: finish,
  }));
  return true;
}

function animatePageEnter(root) {
  if (!root || !isMotionEnabled()) return;
  prepare(root, 0, 'translateY(12px) scale(.99)');
  track(animate(root, {
    opacity: [0, 1], y: [12, 0], scale: [.99, 1],
    duration: 330, ease: 'out(3)',
    onComplete: () => clearPrepared([root]),
  }));
}

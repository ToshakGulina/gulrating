#!/usr/bin/env node
// Motion should be noticeable and purposeful, but remain local, offline-safe, and accessible.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const motion = await readFile(new URL('../src/lib/motion.js', import.meta.url), 'utf8');
const ratingModal = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
const profile = await readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8');
const feed = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(html, /--ease-spring-out:\s*cubic-bezier\(/,
  'spring easing has a fallback for older embedded WebViews');
assert.match(html, /@supports \(animation-timing-function:\s*linear\(0, 1\)\)/,
  'modern browsers use the lightweight CSS linear spring curve');
assert.match(html, /html\.anime-motion-ready[\s\S]*?animation:\s*none\s*!important/,
  'the Anime.js entrances do not stack with the older CSS entrance animations');
assert.match(motion, /from ['"]\.\.\/\.\.\/vendor\/anime\.esm\.min\.js['"]/,
  'the animation engine is loaded from the app bundle, not a remote dependency');
assert.match(motion, /createTimeline[\s\S]*?stagger[\s\S]*?spring/,
  'Anime.js coordinates modal details and staggered, spring-eased entrances');
assert.match(motion, /SURFACE_SELECTOR = '[^']*#blk-feed[^']*#blk-trends[^']*#blk-recs/,
  'the feed, trends, and recommendations sections inside #blocks-wrap animate by their section IDs');
assert.match(motion, /translateY\(22px\) scale\(\.965\)[\s\S]*?stagger\(42\)[\s\S]*?duration:\s*520/,
  'card entrances are perceptible, staggered, and limited to a short sequence');
assert.match(motion, /transitionAppPage[\s\S]*?duration:\s*190/,
  'page changes use a coordinated outgoing/incoming transition');
assert.match(motion, /function animatePageEnter[\s\S]*?duration:\s*330/,
  'cached pages also get a deliberate incoming entrance after navigation');
assert.match(motion, /animateProfilePanel[\s\S]*?duration:\s*420/,
  'profile section changes have a deliberate panel entrance');
assert.match(motion, /function stopMotion\([\s\S]*?animation\.cancel\?\.\(\)[\s\S]*?anime-motion-ready/,
  'active animation is canceled and prepared styles cleared when reduced motion is enabled');
assert.match(motion, /prefers-reduced-motion:\s*reduce/,
  'the animation runtime checks the operating-system motion preference');
assert.match(main, /installAppMotion\(\)/,
  'app motion is installed before initial rendering');
assert.match(feed, /transitionAppPage\(/,
  'navigation uses the shared page transition');
assert.match(profile, /animateProfilePanel\(panel\)/,
  'profile tabs animate the newly selected section');
assert.match(ratingModal, /animateOverlayExit\(modal, removeModal, slideDirection\)/,
  'rating modal has a coordinated animated exit');
assert.match(ratingModal, /animateFranchiseModalEnter\(modal, franchiseDirection\)/,
  'franchise tab changes enter from the opposite side');
assert.match(motion, /animateFranchiseModalEnter[\s\S]*?translateX\(\$\{enterX\}px\)[\s\S]*?translateX\(0\) scale\(1\)/,
  'franchise tab transitions slide the next panel across the viewport');
assert.match(motion, /panel\.style\.transition = 'opacity 440ms[^']*transform 440ms/,
  'franchise modal hand-offs use an explicit, perceptible 440ms slide');
assert.match(motion, /void panel\.offsetWidth[\s\S]*?requestFrame\(\(\) =>/,
  'the transition commits its starting position before applying the destination, avoiding same-frame style collapse');
assert.match(motion, /panel\.classList\.remove\(\.\.\.enteringClasses\)/,
  'the transition removes competing CSS keyframe classes');
const { animateFranchiseModalEnter } = await import('../src/lib/motion.js');
const previousWindow = globalThis.window;
globalThis.window = { innerWidth: 1200, requestAnimationFrame: callback => { globalThis.__motionFrame = callback; }, setTimeout: callback => { globalThis.__motionCleanup = callback; } };
try {
  const removedClasses = [];
  const panel = {
    offsetWidth: 280,
    style: { animation: 'initial-panel-animation', transition: 'initial-panel-transition', opacity: '', transform: '', willChange: '' },
    classList: { remove: (...classes) => removedClasses.push(...classes) },
  };
  const overlay = {
    offsetWidth: 500,
    style: { animation: 'initial-overlay-animation', transition: 'initial-overlay-transition', opacity: '' },
    querySelector: () => panel,
  };
  assert.equal(animateFranchiseModalEnter(overlay, 1), true,
    'franchise hand-off starts without relying on Element.animate()');
  assert.match(panel.style.transform, /translateX\(300px\)/,
    'the next part is placed visibly offscreen before the transition');
  assert.equal(panel.style.transition, 'none');
  globalThis.__motionFrame();
  assert.equal(panel.style.transform, 'translateX(0) scale(1)',
    'the next part transitions into the viewport');
  assert.equal(panel.style.opacity, '1');
  assert.match(panel.style.transition, /440ms/);
  assert.equal(overlay.style.opacity, '1');
  globalThis.__motionCleanup();
  assert.equal(panel.style.animation, 'initial-panel-animation');
  assert.equal(panel.style.transition, 'initial-panel-transition');
  assert.equal(overlay.style.animation, 'initial-overlay-animation');
  assert(removedClasses.includes('franchise-slide-enter-forward'),
    'the CSS entrance class is removed to prevent replay');
} finally {
  delete globalThis.__motionFrame;
  delete globalThis.__motionCleanup;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}
assert.match(html, /franchise-tab-enter-from-(?:right|left)[\s\S]*?franchise-tab-exit-left/,
  'franchise tab transitions include directional CSS fallbacks');
assert.match(ratingModal, /animateScoreBubble\(bubble, selectedScore \?\? val\)/,
  'intentional score changes get a distinct rating-feedback motion');
assert.match(ratingModal, /prefers-reduced-motion:\s*reduce[\s\S]*?removeModal\(\)/,
  'closing animation is skipped when reduced motion is requested');
assert.match(ratingModal, /window\.setTimeout\(removeModal, 620\)/,
  'modal cleanup has a bounded fallback if an embedded WebView misses animation callbacks');
assert.match(ratingModal, /renderValue\(!fromSlider\)/,
  'the score feedback is reserved for deliberate stepper taps, not continuous slider movement');
assert.match(html, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*\.01ms/,
  'global CSS motion is reduced for accessibility');
assert.match(sw, /gulrating-v65[\s\S]*?\/vendor\/anime\.esm\.min\.js[\s\S]*?\/src\/lib\/motion\.js/,
  'the offline shell precaches the animation engine and app motion module under a fresh cache version');
assert.doesNotMatch(motion, /from ['"]animejs['"]|from ['"]motion['"]|from ['"]framer-motion['"]|https?:\/\/.*animejs/,
  'the offline-first app does not import or download an animation dependency remotely');
console.log('Coordinated page/modal motion, staggered cards, score feedback, offline precache, and reduced-motion paths: OK');

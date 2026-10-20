#!/usr/bin/env node
// Motion improvements should be purposeful, short, and accessible in the static APK/PWA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const ratingModal = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');

assert.match(html, /--ease-spring-out:\s*cubic-bezier\(/,
  'spring easing has a fallback for older embedded WebViews');
assert.match(html, /@supports \(animation-timing-function:\s*linear\(0, 1\)\)/,
  'modern browsers use the lightweight CSS linear spring curve');
assert.match(html, /\.fixed\.inset-0\.rating-modal-closing[\s\S]*?rating-modal-overlay-leave/,
  'rating modal has a short overlay exit animation');
assert.match(ratingModal, /prefers-reduced-motion:\s*reduce[\s\S]*?removeModal\(\)/,
  'closing animation is skipped when reduced motion is requested');
assert.match(ratingModal, /window\.setTimeout\(removeModal, 260\)/,
  'modal cleanup has a bounded fallback if the WebView misses animationend');
assert.match(ratingModal, /renderValue\(!fromSlider\)/,
  'the score pop is reserved for deliberate stepper taps, not continuous slider movement');
assert.match(html, /@keyframes rating-value-pop[\s\S]*?scale:/,
  'score feedback uses a compositor-friendly scale animation');
assert.match(html, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*\.01ms/,
  'global motion is reduced for accessibility');
assert.doesNotMatch(ratingModal, /from ['"]animejs['"]|from ['"]motion['"]|from ['"]framer-motion['"]|https?:\/\/.*animejs/,
  'the offline-first app does not add a remote animation dependency');
console.log('Spring easing, modal exit, intentional score feedback, and reduced-motion paths: OK');

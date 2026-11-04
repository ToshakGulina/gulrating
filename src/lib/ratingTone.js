// Keep perfect scores visually distinct throughout the app. Scores are displayed
// at tenths, so a rounded 10.0 (for example a 9.95 average) gets the gold tone.
export function ratingTone(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 'rating-score-low';
  if (Math.round(score * 10) / 10 >= 10) return 'rating-score-perfect';
  if (score >= 8) return 'rating-score-high';
  if (score >= 5) return 'rating-score-mid';
  return 'rating-score-low';
}

export function ratingBadgeColor(value) {
  const tone = ratingTone(value);
  if (tone === 'rating-score-perfect') return 'bg-amber-700';
  if (tone === 'rating-score-high') return 'bg-green-600';
  if (tone === 'rating-score-mid') return 'bg-yellow-600';
  return 'bg-red-600';
}

export function ratingAccentRgb(value) {
  const tone = ratingTone(value);
  if (tone === 'rating-score-perfect') return '234 179 8';
  if (tone === 'rating-score-high') return '34 197 94';
  if (tone === 'rating-score-mid') return '245 158 11';
  return '244 63 94';
}

export function ratingTextColor(value, strength = '400') {
  const tone = ratingTone(value);
  if (tone === 'rating-score-perfect') return 'rating-score-perfect-text';
  if (tone === 'rating-score-high') return strength === '300' ? 'text-green-300' : 'text-green-400';
  if (tone === 'rating-score-mid') return strength === '300' ? 'text-yellow-300' : 'text-yellow-400';
  return strength === '300' ? 'text-red-300' : 'text-red-400';
}

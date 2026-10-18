export function friendRatingsLabel(friendRatings, totalRatingCount = Array.isArray(friendRatings) ? friendRatings.length : 0) {
  if (!Array.isArray(friendRatings) || friendRatings.length === 0) return 'Ваша оценка';
  if (totalRatingCount === 1) return String(friendRatings[0]?.profiles?.username || 'Участник');
  return 'Друзья';
}

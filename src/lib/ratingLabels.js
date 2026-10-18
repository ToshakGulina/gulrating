export function friendRatingsLabel(friendRatings) {
  if (!Array.isArray(friendRatings) || friendRatings.length === 0) return 'Ваша оценка';
  if (friendRatings.length === 1) return String(friendRatings[0]?.profiles?.username || 'Участник');
  return 'Друзья';
}

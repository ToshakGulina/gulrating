export function friendRatingsLabel(friendRatings, hasOwnRating = false) {
  if (!Array.isArray(friendRatings) || friendRatings.length === 0) return 'Ваша оценка';
  if (friendRatings.length === 1) {
    const friendName = String(friendRatings[0]?.profiles?.username || 'Участник');
    return hasOwnRating ? `Вы и ${friendName}` : friendName;
  }
  return hasOwnRating ? 'Вы и друзья' : 'Друзья';
}

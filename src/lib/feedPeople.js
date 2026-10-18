export function feedUserOptions(profiles, currentUser) {
  const people = new Map();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!profile || profile.id == null) continue;
    const id = String(profile.id);
    if (!people.has(id)) {
      people.set(id, {
        id,
        username: String(profile.username || 'Участник'),
      });
    }
  }
  if (currentUser && currentUser.id != null) {
    const id = String(currentUser.id);
    people.set(id, {
      id,
      username: String(currentUser.profile?.username || people.get(id)?.username || 'Я'),
      isCurrentUser: true,
    });
  }

  return [...people.values()].sort((a, b) => {
    if (a.isCurrentUser) return -1;
    if (b.isCurrentUser) return 1;
    return a.username.localeCompare(b.username, 'ru');
  });
}

export function selectedFeedUserId(value) {
  const id = String(value || 'all');
  return id === 'all' ? '' : id;
}

export function feedRatingsCacheKey(filter, userId = 'all') {
  return `${filter}:${userId || 'all'}`;
}

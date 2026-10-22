import { getEpisodeWatchPositions } from './watchHistory.js';

export function estimateSeriesProgress(titleKey, positions, details) {
  const episodes = Math.floor(Number(details?.episodes));
  if (!Number.isFinite(episodes) || episodes < 1) return null;
  const savedEpisodes = getEpisodeWatchPositions(titleKey, positions);
  if (!savedEpisodes.length) return null;

  const durations = savedEpisodes.map(item => Number(item.d)).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const estimatedEpisodeSeconds = Number(details?.episode_runtime) > 0
    ? Number(details.episode_runtime) * 60
    : durations.length
      ? durations[Math.floor(durations.length / 2)]
      : 45 * 60;
  const estimatedTotalSeconds = Math.round(episodes * estimatedEpisodeSeconds);
  if (estimatedTotalSeconds < 1) return null;

  const watchedSeconds = savedEpisodes.reduce((sum, item) => {
    const t = Math.max(0, Number(item.t) || 0);
    const d = Math.max(0, Number(item.d) || 0);
    return sum + Math.min(t, d || t);
  }, 0);
  return {
    watchedSeconds,
    estimatedTotalSeconds,
    percent: Math.max(0, Math.min(100, Math.round(watchedSeconds / estimatedTotalSeconds * 100))),
    trackedEpisodes: savedEpisodes.length,
    totalEpisodes: episodes,
    estimated: !(Number(details?.episode_runtime) > 0),
  };
}

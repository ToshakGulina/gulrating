// Parsers and commands for iframe players that expose a postMessage API.
// Normal web pages cannot inspect a cross-origin iframe's DOM.
import { extractEpisodeIdentity } from './episodeIdentity.js';
const PLAYERJS_CONTEXT = 'player.js';
export const PLAYER_PROGRESS_HOSTS = Object.freeze([
  'stravers.live', 'alloha.tv', 'alloha.cool', 'obrut.show',
  'kodik.info', 'kodik.cc', 'kodik.club', 'kodik.ws',
  'videocdn.net', 'videocdn.tv', 'collaps.me', 'collaps.so',
  'bazon.cc', 'hdzo.fun', 'kurolesya.link', 'nextembed.ws',
  'kinokino.vip', 'kinobox.tv', 'vidlink.pro',
]);

export function isSupportedPlayerProgressOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && PLAYER_PROGRESS_HOSTS.some(host =>
      url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch (error) {
    return false;
  }
}

const PROGRESS_EVENTS = new Set([
  'timeupdate', 'progress', 'playbackprogress', 'watchinglog',
  'playprogress', 'pause', 'seeked', 'ended', 'play', 'state', 'playerstatus'
]);

function objectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function numberFrom(...values) {
  for (const value of values) {
    const number = Number(value);
    if (value !== null && value !== undefined && Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function normalizeEvent(value) {
  return String(value || '').trim().toLowerCase().replace(/[ _-]/g, '');
}

export function parsePlayerProgressMessage(raw) {
  const message = objectValue(raw);
  if (!message) return null;

  const playerJs = message.context === PLAYERJS_CONTEXT;
  const eventName = normalizeEvent(message.event || message.eventName || message.name || message.type);
  const payload = objectValue(message.data) || objectValue(message.detail)
    || objectValue(message.info) || objectValue(message.value) || message;

  if (playerJs && eventName === 'ready') {
    return {
      kind: 'ready',
      src: String(payload.src || ''),
      methods: Array.isArray(payload.methods) ? payload.methods.map(String) : [],
      events: Array.isArray(payload.events) ? payload.events.map(String) : [],
    };
  }

  if (playerJs && eventName === 'getcurrenttime') {
    const t = numberFrom(message.value, payload.seconds, payload.currentTime, payload.time);
    return t === null ? null : { kind: 'current-time', t, listener: String(message.listener || '') };
  }
  if (playerJs && eventName === 'getduration') {
    const d = numberFrom(message.value, payload.duration, payload.seconds, payload.time);
    return d === null ? null : { kind: 'duration', d, listener: String(message.listener || '') };
  }

  // Documented player APIs use both nested event names and status fields.
  // VidLink uses data.event/currentTime/duration; VidAPI uses
  // data.player_status/player_progress/player_duration; some emit watching-log.
  const nestedEvent = normalizeEvent(
    payload.event || payload.eventName || payload.name || payload.player_status
  );
  let event = nestedEvent || eventName;
  if (event === 'playing') event = 'play';
  if (event === 'paused') event = 'pause';
  if (event === 'completed') event = 'ended';
  if (event === 'playerevent' && (payload.currentTime != null || payload.player_progress != null)) event = 'timeupdate';
  if (event === 'watchinglog') event = 'timeupdate';
  if (event === 'playprogress') event = 'timeupdate';

  // YouTube's IFrame API sends position snapshots as infoDelivery messages.
  if (event === 'infodelivery') event = 'timeupdate';
  if (!PROGRESS_EVENTS.has(event)) return null;

  const t = numberFrom(
    payload.currentTime, payload.seconds, payload.time, payload.position,
    payload.player_progress, payload.watched,
    message.currentTime, message.seconds, message.time, message.position
  );
  const d = numberFrom(payload.duration, payload.player_duration, message.duration);
  if (t === null || d === null || d <= 0 || t > d + 30) return null;
  const episode = extractEpisodeIdentity(
    payload.episode, payload.season && payload.episodeNumber != null
      ? { season: payload.season, episode: payload.episodeNumber }
      : null,
    payload.url, payload.href, payload.title, message.episode, message.url, message.href
  );
  return { kind: 'progress', event, t, d, playerJs, ...(episode ? { episode } : {}) };
}

export function createPlayerJsMessage(method, value, listener) {
  const message = { context: PLAYERJS_CONTEXT, version: '0.0.11', method };
  if (value !== undefined) message.value = value;
  if (listener) message.listener = listener;
  return JSON.stringify(message);
}

// VidLink documents startAt as its cross-device resume parameter.
export function addSupportedResumeParameter(url, provider, position) {
  const seconds = Number(position);
  if (!Number.isFinite(seconds) || seconds < 30) return url;
  try {
    const parsed = new URL(url, globalThis.location && globalThis.location.href);
    const providerName = String(provider || '').toLowerCase();
    if (parsed.hostname === 'vidlink.pro' || providerName === 'vidlink') {
      parsed.searchParams.set('startAt', String(Math.floor(seconds)));
      return parsed.href;
    }
    return url;
  } catch (error) {
    return url;
  }
}

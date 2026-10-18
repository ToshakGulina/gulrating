// Parsers and commands for cross-origin HTML5 player iframes that expose a
// documented postMessage API. Browsers cannot inspect an iframe's DOM directly.
const PLAYERJS_CONTEXT = 'player.js';
const PROGRESS_EVENTS = new Set(['timeupdate', 'progress', 'playbackprogress', 'pause', 'seeked', 'ended', 'play', 'state', 'playerstatus']);

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
    || objectValue(message.value) || message;

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

  // Support Player.js and common parent-window progress event shapes, but only
  // accept messages with a recognizable playback event and a real duration.
  const nestedEvent = normalizeEvent(payload.event || payload.eventName || payload.name);
  const event = nestedEvent || eventName;
  if (!PROGRESS_EVENTS.has(event)) return null;

  const t = numberFrom(
    payload.currentTime, payload.seconds, payload.time, payload.position,
    message.currentTime, message.seconds, message.time, message.position
  );
  const d = numberFrom(payload.duration, message.duration);
  if (t === null || d === null || d <= 0 || t > d + 30) return null;
  return { kind: 'progress', event, t, d, playerJs };
}

export function createPlayerJsMessage(method, value, listener) {
  const message = { context: PLAYERJS_CONTEXT, version: '0.0.11', method };
  if (value !== undefined) message.value = value;
  if (listener) message.listener = listener;
  return JSON.stringify(message);
}

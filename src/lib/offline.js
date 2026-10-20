// Отложенные оценки: если сеть пропала, оценка сохраняется на устройстве
// и улетает в базу автоматически, как только интернет появляется.
// Очередь живёт в localStorage — переживает перезагрузки и закрытие телефона.

import { saveRating } from './ratings.js';

const QUEUE_KEY = 'gulrating:pending_ratings';

// Похоже ли ошибка на отсутствие сети (а не на отказ базы или прав доступа)
export function networkLikeError(e) {
  // Оцениваем текст реальной ошибки, а не navigator.onLine (в APK WebView он часто неверен).
  const msg = (e && e.message) || '';
  return /Failed to fetch|NetworkError|Load failed|network|503|Unable to access/i.test(msg);
}

function readQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, 100)));
  } catch (e) {
    // приватный режим — очередь просто не переживёт закрытие вкладки
  }
}

export function getPendingRatings() {
  return readQueue();
}

// item: { title_id, media_type, rating, comment, title, poster_path }
export function enqueueRating(item) {
  const queue = readQueue();
  queue.unshift({
    ...item,
    qid: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queued_at: new Date().toISOString()
  });
  writeQueue(queue);
  return queue.length;
}

export function removePending(qid) {
  writeQueue(readQueue().filter(i => i.qid !== qid));
}

// Отправляем всё накопленное; возвращает число отправленных оценок.
// При сетевой ошибке прекращаем долбить очередь до следующей попытки.
export async function flushPendingRatings(userId) {
  const queue = readQueue();
  if (!queue.length) return 0;
  let sent = 0;
  const left = [];
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    try {
      await saveRating(userId, item.title_id, item.media_type, item.rating, item.comment || '');
      sent += 1;
    } catch (e) {
      left.push(item);
      if (networkLikeError(e)) {
        // Не теряем последующие элементы очереди, до которых из-за сети не дошли.
        left.push(...queue.slice(index + 1));
        break;
      }
    }
  }
  writeQueue(left);
  return sent;
}

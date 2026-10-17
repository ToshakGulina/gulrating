// Сервис-воркер для PWA: офлайн-доступ к оболочке приложения.
//
// Принципы (исправляет проблему старой версии, которая кэшировала ВСЁ подряд):
// 1. Кэшируем ТОЛЬКО статику своего домена (оболочку приложения и иконки).
//    Запросы к Supabase, TMDb и прочим внешним API воркер не трогает вообще —
//    иначе кэшировались бы ответы авторизации и данные фильмов, и приложение
//    показывало бы устаревшее состояние.
// 2. Навигация (открытие страниц) — network-first с офлайн-фолбэком на кэш,
//    чтобы после нового деплоя пользователь сразу получал свежую версию.
// 3. При активации новой версии старые кэши удаляются.

const CACHE_VERSION = 'gulrating-v14';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/assets/tw.css',
  '/vendor/supabase.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/src/main.js',
  '/src/config.js',
  '/src/lib/supabase.js',
  '/src/lib/userSync.js',
  '/src/lib/tmdb.js',
  '/src/lib/ratings.js',
  '/src/lib/date.js',
  '/src/lib/dom.js',
  '/src/lib/history.js',
  '/src/lib/offline.js',
  '/src/lib/offlineCatalog.js',
  '/src/lib/fullCatalog.js',
  '/src/lib/watchHistory.js',
  '/src/lib/kinopoisk.js',
  '/src/lib/kinobox.js',
  '/src/components/Auth.js',
  '/src/components/Setup.js',
  '/src/components/AccessDenied.js',
  '/src/components/Feed.js',
  '/src/components/RatingModal.js',
  '/src/components/Profile.js',
  '/src/components/Catalog.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Обрабатываем только GET своего домена: API и чужие origin'ы не трогаем
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Служебная проверка свежести сборки из main.js: всегда в сеть, мимо кэша
  if (url.searchParams.has('build-check')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Код приложения и документы — network-first с фолбэком в кэш:
  // после нового деплоя пользователь ОБЯЗАН получить свежий модуль с первого
  // же захода (cache-first здесь оставлял людей на старых сборках при
  // нестабильной сети: фоновое обновление просто не успевало доехать).
  // Офлайн не ломается: нет сети — отдаём последнюю закэшированную версию.
  const isCode = request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname === '/index.html'
    || url.pathname === '/manifest.json'
    || url.pathname === '/sw.js'
    || url.pathname.startsWith('/src/');

  if (isCode) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Иконки и прочая статика: кэш с фоновым обновлением (stale-while-revalidate)
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

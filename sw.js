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

const CACHE_VERSION = 'gulrating-v37';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/assets/tw.css',
  '/assets/fonts/inter.css',
  '/assets/fonts/files/inter-cyrillic-ext-400-normal.woff2',
  '/assets/fonts/files/inter-cyrillic-400-normal.woff2',
  '/assets/fonts/files/inter-latin-ext-400-normal.woff2',
  '/assets/fonts/files/inter-latin-400-normal.woff2',
  '/assets/fonts/files/inter-cyrillic-ext-500-normal.woff2',
  '/assets/fonts/files/inter-cyrillic-500-normal.woff2',
  '/assets/fonts/files/inter-latin-ext-500-normal.woff2',
  '/assets/fonts/files/inter-latin-500-normal.woff2',
  '/assets/fonts/files/inter-cyrillic-ext-600-normal.woff2',
  '/assets/fonts/files/inter-cyrillic-600-normal.woff2',
  '/assets/fonts/files/inter-latin-ext-600-normal.woff2',
  '/assets/fonts/files/inter-latin-600-normal.woff2',
  '/assets/fonts/files/inter-cyrillic-ext-700-normal.woff2',
  '/assets/fonts/files/inter-cyrillic-700-normal.woff2',
  '/assets/fonts/files/inter-latin-ext-700-normal.woff2',
  '/assets/fonts/files/inter-latin-700-normal.woff2',
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
  '/src/lib/theme.js',
  '/src/lib/buttonRipple.js',
  '/src/lib/history.js',
  '/src/lib/offline.js',
  '/src/lib/offlineCatalog.js',
  '/src/lib/fullCatalog.js',
  '/src/lib/watchHistory.js',
  '/src/lib/kinopoisk.js',
  '/src/lib/kinobox.js',
  '/src/lib/kinopoiskWatchLinks.js',
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
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key !== CACHE_VERSION)
      .map((key) => caches.delete(key)));

    // Сразу переключаем уже открытые вкладки на новый код. Иначе старый
    // модуль поиска продолжает жить в памяти, даже после успешного деплоя.
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
  })());
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

  const cachedShellFallback = async () => {
    const exact = await caches.match(request);
    if (exact) return exact;
    // Навигация с параметрами (например, ссылка на тайтл) всё равно должна
    // открывать закэшированную оболочку, даже если URL с query не кэшировался.
    if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
      return await caches.match('/index.html') || await caches.match('/');
    }
    return null;
  };

  if (isCode) {
    event.respondWith((async () => {
      const cached = await cachedShellFallback();
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        }
        // Геоблоки и фильтры иногда возвращают 403/5xx как HTTP-ответ,
        // а не сетевую ошибку. В таком случае тоже отдаём сохранённую оболочку.
        return cached || response;
      } catch (error) {
        return cached;
      }
    })());
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
            return response;
          }
          return cached || response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

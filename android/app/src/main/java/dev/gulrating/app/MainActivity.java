package dev.gulrating.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageInstaller;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * ГульРейтинг на Android без Google Play: тонкая WebView-обёртка поверх
 * PWA-сайта плюс возможности, которые без натива не дать:
 *  — плеер kinokino.vip открывается внутри приложения;
 *  — мост GulRatingBridge: сайт сообщает, какой тайтл смотрят; скрипт
 *    отслеживания внедряется в основную страницу и iframe плеера, включая
 *    cross-origin кадры, а нативный опрос остаётся резервным способом;
 *  — позиция сохраняется и подставляется при повторном входе в плеер;
 *  — нативные уведомления (новые сезоны досмотренных сериалов).
 *
 * Установка: sideload APK (файл собирается GitHub Actions, см. README).
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://gulrating.pages.dev/";
    private static final String HOME_HOST = "gulrating.pages.dev";
    // Хосты плеера: открываются внутри WebView приложения (кнопка «Смотреть»),
    // кнопка «назад» телефона возвращает к сайту через историю WebView
    // Хосты плееров: зеркала (kinokino.vip) и бэкенды Kinobox, на которые
    // приложение теперь переходит напрямую (чистый плеер без обвязки зеркала)
    private static final String[] PLAYER_HOSTS = {
            "kinokino.vip", "kinobox.tv", "stravers.live",
            "kodik.info", "kodik.cc", "kodik.club", "kodik.ws",
            "videocdn.net", "videocdn.tv", "collaps.me", "collaps.so",
            "bazon.cc", "alloha.cool", "hdzo.fun", "pleer.videocdn.net",
            "kurolesya.link", "obrut.show", "nextembed.ws"
    };
    private static final String CHANNEL = "gulrating-watch";
    private static final String UPDATE_CHANNEL = "gulrating-updates";
    private static final String RELEASE_API = "https://api.github.com/repos/ToshakGulina/gulrating/releases/latest";
    private static final String ACTION_DOWNLOAD_UPDATE = "dev.gulrating.app.DOWNLOAD_UPDATE";
    private static final String ACTION_INSTALL_STATUS = "dev.gulrating.app.UPDATE_INSTALL_STATUS";
    private static final String EXTRA_UPDATE_URL = "gulrating.update.url";
    private static final String EXTRA_UPDATE_VERSION = "gulrating.update.version";
    private static final int UPDATE_NOTIFICATION_ID = 2601;
    private static final int REQUEST_UNKNOWN_SOURCES = 2602;
    private static final int REQUEST_POST_NOTIFICATIONS = 2603;

    private WebView web;
    private Handler handler;
    private NotificationManager notifManager;
    // Ключ тайтла, который сейчас смотрят: "tv:123" / "movie:456"
    private volatile String currentWatchKey = "";
    private volatile boolean playbackTrackingEnabled = false;
    private final Object positionsLock = new Object();
    // Идёт сеанс плеера: после входа на хост плеера держим внутри WebView
    // любые редиректы и смежные домены, пока пользователь не вернётся на сайт
    private volatile boolean inPlayerSession = false;
    // APK всегда запускается с локальной копии оболочки: для первого кадра
    // и офлайн-старта не требуется доступ к pages.dev. Origin URL при этом
    // остаётся прежним, поэтому сохраняются localStorage и Supabase-сессия.
    private volatile boolean useBundledWebApp = true;
    private volatile boolean triedBundledFallback = false;
    private volatile boolean remoteBuildCheckStarted = false;
    private volatile boolean appUpdateCheckStarted = false;
    private volatile boolean appUpdateCheckRunning = false;
    private volatile boolean updateDownloadRunning = false;
    private volatile String pendingUpdateUrl = "";
    private volatile String pendingUpdateVersion = "";
    private java.io.File pendingInstallFile;
    private AlertDialog updateProgressDialog;
    private ProgressBar updateProgressBar;
    // Автофуллскрин с тапа по озвучке: ландшафт + иммерсив сразу;
    // выход — Back или возврат домой
    private boolean cinema = false;
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    private String homeUA;
    // Нативный фуллскрин видео (кнопка полноэкранного режима в плеере)
    private FrameLayout root;
    private View customView;
    private android.webkit.WebChromeClient.CustomViewCallback customViewCallback;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        notifManager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Просмотр и новые сезоны", NotificationManager.IMPORTANCE_DEFAULT);
            NotificationChannel updateChannel = new NotificationChannel(UPDATE_CHANNEL, "Обновления приложения", NotificationManager.IMPORTANCE_DEFAULT);
            notifManager.createNotificationChannel(ch);
            notifManager.createNotificationChannel(updateChannel);
        }
        handler = new Handler(Looper.getMainLooper());
        // Система иногда возвращает полоски сама (уведомления и т.п.) —
        // пока мы в фуллскрине, восстанавливаем иммерсивность
        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(vis -> {
            if (customView != null) {
                handler.post(() -> applyImmersive(customView));
            }
        });

        root = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f172a"));
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setDatabaseEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        // Кэш и cookie WebView: service worker сайта живёт на них же
        web.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
        // Cookie встроенных плееров: во фрейме они сторонние, а WebView их
        // по умолчанию блокирует — Alloha из-за этого не мог сохранить
        // сессию и писал «контент не найден», хотя в браузере играл
        final android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(web, true);
        // Маркер для сайта: включает поведение «приложение» (офлайн-база,
        // открытие плеера внутри WebView)
        homeUA = web.getSettings().getUserAgentString() + " GulRatingApp/1";
        web.getSettings().setUserAgentString(homeUA);

        // Фуллскрин плеера: WebView отдаёт кастомную вью сюда, без этого
        // кнопка полноэкранного режима в плеере молча не работает
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                // Видео fullscreen — поворачиваем в ландшафт, как видеоплееры
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                // Полноценный полноэкранный режим: прячем шторку и кнопки навигации
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
                web.setVisibility(View.GONE);
                applyImmersive(customView);
                // Повторяем после раскладки: некоторые оболочки сбрасывают флаги
                handler.post(() -> applyImmersive(customView));
                handler.postDelayed(() -> applyImmersive(customView), 300);
                root.addView(customView, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }
        });
        // Запросы, инициированные Service Worker, НЕ проходят через WebViewClient.
        // Без этого офлайн-PWA пытается взять ES-модули из сети даже при наличии
        // локального APK-бандла и остаётся на заставке. Обслуживаем их теми же
        // ассетами, что и обычные WebView-запросы.
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (useBundledWebApp && HOME_HOST.equals(uri.getHost())
                        && "https".equalsIgnoreCase(uri.getScheme())) {
                    return bundledWebResponse(uri.getPath());
                }
                return null;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (useBundledWebApp && HOME_HOST.equals(uri.getHost())
                        && "https".equalsIgnoreCase(uri.getScheme())) {
                    WebResourceResponse bundled = bundledWebResponse(uri.getPath());
                    if (bundled != null) return bundled;
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        android.webkit.WebResourceError error) {
                super.onReceivedError(view, request, error);
                tryBundledFallback(request);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            android.webkit.WebResourceResponse errorResponse) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (errorResponse.getStatusCode() >= 400) tryBundledFallback(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                // Уход с плеера: снять позицию сразу, не дожидаясь тика опроса
                if (onPlayer() && !isPlayerHost(uri.toString()) && !isPlayerSessionUrl(uri.toString())) {
                    probePlayer();
                }
                // Всё своё открываем внутри приложения, внешние ссылки
                // (Кинопоиск, Телеграм) — в браузере телефона
                if (host != null && host.equals(HOME_HOST)) {
                    if (request.isForMainFrame()) {
                        inPlayerSession = false;
                        playbackTrackingEnabled = false;
                        currentWatchKey = "";
                        exitCinema();
                        web.getSettings().setUserAgentString(homeUA);
                    }
                    return false;
                }
                if (isPlayerHost(uri.toString())) {
                    inPlayerSession = true;
                    return false;
                }
                // Сеанс плеера: редиректы и смежные домены плеера остаются
                // внутри приложения, иначе «Смотреть» открывал бы браузер
                if (inPlayerSession) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    // нечем открыть ссылку — просто остаёмся на месте
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!isPlayerHost(url) && !isPlayerSessionUrl(url)) {
                    if (isHomeShellUrl(url)) {
                        // Back navigation may restore the home page without going
                        // through shouldOverrideUrlLoading; stop tracking that session.
                        inPlayerSession = false;
                        playbackTrackingEnabled = false;
                        currentWatchKey = "";
                        if (useBundledWebApp) checkRemoteBuildAndUpdate();
                        checkForAppUpdate(false);
                    }
                    scheduleBundledBootCheck(url);
                    return;
                }
                resumePlayback(view);
            }
        });

        // Мост для сайта: репорт тайтла, позиции просмотра, нативные уведомления
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void reportWatch(String json) {
                try {
                    org.json.JSONObject o = new org.json.JSONObject(json);
                    String type = o.optString("type");
                    String id = o.optString("id");
                    if (!("movie".equals(type) || "tv".equals(type))
                            || !id.matches("[A-Za-z0-9_-]{1,100}")) return;
                    currentWatchKey = type + ":" + id;
                    playbackTrackingEnabled = true;
                } catch (Exception ignored) {
                }
            }

            @JavascriptInterface
            public boolean isPlaybackTrackingActive() {
                return playbackTrackingEnabled;
            }

            @JavascriptInterface
            public String getCurrentWatchKey() {
                return playbackTrackingEnabled ? currentWatchKey : "";
            }

            @JavascriptInterface
            public void savePlaybackPosition(String json) {
                if (!playbackTrackingEnabled) return;
                try {
                    org.json.JSONObject o = new org.json.JSONObject(json);
                    storePlaybackPosition(currentWatchKey,
                            Math.round(o.optDouble("t", 0)),
                            Math.round(o.optDouble("d", 0)),
                            o.optBoolean("force", false));
                } catch (Exception ignored) {
                }
            }

            @JavascriptInterface
            public String getPositions() {
                return prefs().getString("positions", "{}");
            }

            @JavascriptInterface
            public String getCurrentPosition() {
                if (!playbackTrackingEnabled || currentWatchKey.isEmpty()) return "{}";
                synchronized (positionsLock) {
                    try {
                        org.json.JSONObject all = new org.json.JSONObject(prefs().getString("positions", "{}"));
                        org.json.JSONObject current = all.optJSONObject(currentWatchKey);
                        return current == null ? "{}" : current.toString();
                    } catch (Exception ignored) {
                        return "{}";
                    }
                }
            }

            @JavascriptInterface
            public void mergePositions(String json) {
                synchronized (positionsLock) {
                    try {
                        org.json.JSONObject local = new org.json.JSONObject(prefs().getString("positions", "{}"));
                        org.json.JSONObject incoming = new org.json.JSONObject(json == null ? "{}" : json);
                        java.util.Iterator<String> keys = incoming.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            org.json.JSONObject remote = incoming.optJSONObject(key);
                            org.json.JSONObject current = local.optJSONObject(key);
                            if (remote != null && (current == null
                                    || remote.optLong("at", 0) >= current.optLong("at", 0))) {
                                local.put(key, remote);
                            }
                        }
                        prefs().edit().putString("positions", local.toString()).apply();
                    } catch (Exception ignored) {
                    }
                }
            }

            // Переход на чистую страницу плеера БЕЗ Referer: проверено
            // пользователем — в браузере (фрейм no-referrer) играют все
            // источники, а с подставленным referer зеркала Alloha и Turbo
            // режут «недоступно в регионе» (kinokino.vip не в их белом
            // списке). loadUrl без заголовков = прямой заход, referer пуст.
            @JavascriptInterface
            public void openPlayer(final String url, final String referer) {
                if (url == null || url.isEmpty()) return;
                handler.post(() -> {
                    inPlayerSession = true;
                    setPlayerUA();
                    enterCinema();
                    web.loadUrl(url);
                });
            }

            // Автофуллскрин из веб-части: тап по озвучке у embed-only
            // плееров (фрейм) тоже даёт ландшафт и иммерсив сразу
            @JavascriptInterface
            public void enterCinema() {
                // ВАЖНО: здесь нельзя трогать User-Agent — setUserAgentString
                // перезагружает текущую страницу (дом) и роняет оверлей.
                // Во фреймовом режиме плееры живут и под мобильным UA,
                // десктопный нужен только полнодокументной навигации
                handler.post(() -> enterCinema());
            }

            @JavascriptInterface
            public void notify(final String text) {
                handler.post(() -> showNotification(text));
            }

            @JavascriptInterface
            public void checkForUpdate() {
                checkForAppUpdate(true);
            }

            @JavascriptInterface
            public String getAppVersion() {
                return BuildConfig.VERSION_NAME;
            }
        }, "GulRatingBridge");
        installPlaybackProgressTracker();

        // Опрос <video> плеера: позиция и длительность для истории просмотра.
        // Сам опрос — короткий JS-сниппет, по энергии копеечный на фоне
        // декодирования видео, поэтому тик оставлен частым (5 с); дополнительно
        // позиция снимается при уходе со страницы плеера и при сворачивании
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (onPlayer()) probePlayer();
                handler.postDelayed(this, 5000);
            }
        }, 8000);

        if (savedInstanceState == null) {
            web.loadUrl(HOME);
        }
        setContentView(root);
        handleUpdaterIntent(getIntent());
    }

    private boolean isBundledShellPath(String path) {
        return path == null || "/".equals(path) || "/index.html".equals(path)
                || "/manifest.json".equals(path) || path.startsWith("/src/")
                || path.startsWith("/assets/") || path.startsWith("/vendor/")
                || path.startsWith("/icons/") || path.startsWith("/data/");
    }

    private void tryBundledFallback(WebResourceRequest request) {
        Uri uri = request.getUrl();
        boolean homeOrigin = HOME_HOST.equals(uri.getHost())
                && "https".equalsIgnoreCase(uri.getScheme());
        boolean failedShellAsset = homeOrigin && isBundledShellPath(uri.getPath());
        if ((request.isForMainFrame() || failedShellAsset) && homeOrigin && !triedBundledFallback) {
            triedBundledFallback = true;
            useBundledWebApp = true;
            handler.post(() -> web.loadUrl(HOME));
        }
    }

    // Некоторые WebView сообщают о неудачной загрузке ES-модуля только
    // после onPageFinished, а не как об ошибке главного документа. Если
    // приложение не смонтировало ничего в #app, перезапускаем страницу из APK.
    private void scheduleBundledBootCheck(String url) {
        Uri finished = Uri.parse(url);
        if (!HOME_HOST.equals(finished.getHost()) || triedBundledFallback || useBundledWebApp) return;
        handler.postDelayed(() -> {
            if (isFinishing() || triedBundledFallback || useBundledWebApp) return;
            Uri current = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
            if (!HOME_HOST.equals(current.getHost())) return;
            web.evaluateJavascript(
                    "(function(){var a=document.getElementById('app');return !a||!a.firstChild;})()",
                    value -> {
                        if ("true".equals(value) && !triedBundledFallback && !useBundledWebApp) {
                            triedBundledFallback = true;
                            useBundledWebApp = true;
                            web.loadUrl(HOME);
                        }
                    });
        }, 13000);
    }

    private boolean isHomeShellUrl(String url) {
        Uri uri = Uri.parse(url == null ? "" : url);
        String path = uri.getPath();
        return HOME_HOST.equals(uri.getHost()) && (path == null || path.isEmpty()
                || "/".equals(path) || "/index.html".equals(path));
    }

    // Обновление сайта проверяем в фоне уже после запуска локальной оболочки.
    // Если pages.dev недоступен, пользователь остаётся в рабочем APK и не
    // ждёт сеть; если на сайте другая сборка — переключаемся на неё без потери
    // сессии и локальных данных (host/origin остаётся тем же).
    private void checkRemoteBuildAndUpdate() {
        if (remoteBuildCheckStarted || !useBundledWebApp || isFinishing()) return;
        remoteBuildCheckStarted = true;
        new Thread(() -> {
            String localBuild = readBundledBuild();
            String remoteBuild = fetchRemoteBuild();
            if (remoteBuild != null && localBuild != null && !remoteBuild.equals(localBuild)) {
                handler.post(() -> {
                    if (isFinishing() || !useBundledWebApp || web == null) return;
                    useBundledWebApp = false;
                    web.loadUrl(HOME);
                });
            } else if (remoteBuild == null) {
                // Сеть могла восстановиться позже; повторяем проверку редко,
                // не мешая офлайн-работе и не дёргая батарею.
                handler.postDelayed(() -> {
                    if (!isFinishing() && useBundledWebApp) {
                        remoteBuildCheckStarted = false;
                        checkRemoteBuildAndUpdate();
                    }
                }, 60_000);
            }
        }, "gulrating-build-check").start();
    }

    private String readBundledBuild() {
        try (java.io.InputStream input = getAssets().open("web/src/config.js")) {
            return extractBuild(readUtf8(input));
        } catch (Exception ignored) {
            return null;
        }
    }

    private String fetchRemoteBuild() {
        java.net.HttpURLConnection connection = null;
        try {
            java.net.URL url = new java.net.URL(HOME + "src/config.js?build-check=1");
            connection = (java.net.HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(2500);
            connection.setReadTimeout(2500);
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache");
            if (connection.getResponseCode() != 200) return null;
            try (java.io.InputStream input = connection.getInputStream()) {
                return extractBuild(readUtf8(input));
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String readUtf8(java.io.InputStream input) throws java.io.IOException {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toString("UTF-8");
    }

    private String extractBuild(String source) {
        if (source == null) return null;
        java.util.regex.Matcher matcher = java.util.regex.Pattern
                .compile("APP_BUILD\\s*=\\s*\\\"([^\\\"]+)\\\"")
                .matcher(source);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static final class AppUpdate {
        final String version;
        final String apkUrl;

        AppUpdate(String version, String apkUrl) {
            this.version = version;
            this.apkUrl = apkUrl;
        }
    }

    private void checkForAppUpdate(boolean manual) {
        if (isFinishing()) return;
        if (appUpdateCheckRunning) {
            if (manual) handler.post(() -> Toast.makeText(this, "Проверка обновлений уже выполняется", Toast.LENGTH_SHORT).show());
            return;
        }
        long lastCheck = prefs().getLong("apk_update_last_check", 0L);
        if (!manual && System.currentTimeMillis() - lastCheck < 6 * 60 * 60 * 1000L) return;
        if (!manual && appUpdateCheckStarted) return;
        appUpdateCheckStarted = true;
        appUpdateCheckRunning = true;
        if (manual) handler.post(() -> Toast.makeText(this, "Проверяем обновления…", Toast.LENGTH_SHORT).show());
        new Thread(() -> {
            AppUpdate update = fetchLatestAppUpdate();
            prefs().edit().putLong("apk_update_last_check", System.currentTimeMillis()).apply();
            appUpdateCheckRunning = false;
            appUpdateCheckStarted = false;
            handler.post(() -> {
                if (isFinishing()) return;
                if (update == null) {
                    if (manual) Toast.makeText(this, "Новых обновлений нет или GitHub недоступен", Toast.LENGTH_LONG).show();
                    return;
                }
                pendingUpdateUrl = update.apkUrl;
                pendingUpdateVersion = update.version;
                postUpdateNotification(update);
                showUpdateAvailable(update, manual);
            });
        }, "gulrating-apk-update-check").start();
    }

    private AppUpdate fetchLatestAppUpdate() {
        java.net.HttpURLConnection connection = null;
        try {
            java.net.URL url = new java.net.URL(RELEASE_API);
            connection = (java.net.HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(7000);
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setRequestProperty("User-Agent", "GulRating-Android/" + BuildConfig.VERSION_NAME);
            if (connection.getResponseCode() != 200) return null;
            try (java.io.InputStream input = connection.getInputStream()) {
                org.json.JSONObject release = new org.json.JSONObject(readUtf8(input));
                if (release.optBoolean("draft", true) || release.optBoolean("prerelease", true)) return null;
                String version = release.optString("tag_name", "").replaceFirst("^[vV]", "");
                if (!isNewerAppVersion(version, BuildConfig.VERSION_NAME)) return null;
                org.json.JSONArray assets = release.optJSONArray("assets");
                if (assets == null) return null;
                for (int i = 0; i < assets.length(); i++) {
                    org.json.JSONObject asset = assets.optJSONObject(i);
                    if (asset == null) continue;
                    String name = asset.optString("name", "");
                    String downloadUrl = asset.optString("browser_download_url", "");
                    if (name.toLowerCase(java.util.Locale.ROOT).endsWith(".apk")
                            && downloadUrl.startsWith("https://github.com/ToshakGulina/gulrating/releases/download/")) {
                        return new AppUpdate(version, downloadUrl);
                    }
                }
            }
        } catch (Exception ignored) {
            // Проверка обновлений не должна мешать офлайн-запуску приложения.
        } finally {
            if (connection != null) connection.disconnect();
        }
        return null;
    }

    private boolean isNewerAppVersion(String candidate, String installed) {
        int[] latest = versionParts(candidate);
        int[] current = versionParts(installed);
        if (latest == null || current == null) return false;
        for (int i = 0; i < Math.max(latest.length, current.length); i++) {
            int a = i < latest.length ? latest[i] : 0;
            int b = i < current.length ? current[i] : 0;
            if (a != b) return a > b;
        }
        return false;
    }

    private int[] versionParts(String version) {
        if (version == null || !version.matches("[0-9]+(?:\\.[0-9]+)*")) return null;
        String[] parts = version.split("\\.");
        int[] numbers = new int[parts.length];
        try {
            for (int i = 0; i < parts.length; i++) numbers[i] = Integer.parseInt(parts[i]);
            return numbers;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private void postUpdateNotification(AppUpdate update) {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (!update.version.equals(prefs().getString("apk_update_notification_prompted", ""))) {
                prefs().edit().putString("apk_update_notification_prompted", update.version).apply();
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, REQUEST_POST_NOTIFICATIONS);
            }
            return;
        }
        Intent intent = new Intent(this, MainActivity.class)
                .setAction(ACTION_DOWNLOAD_UPDATE)
                .putExtra(EXTRA_UPDATE_URL, update.apkUrl)
                .putExtra(EXTRA_UPDATE_VERSION, update.version);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, UPDATE_NOTIFICATION_ID, intent, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, UPDATE_CHANNEL) : new Notification.Builder(this);
        Notification notification = builder
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Доступно обновление ГульРейтинга")
                .setContentText("Версия " + update.version + " — нажмите, чтобы скачать и установить")
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(Notification.PRIORITY_DEFAULT)
                .build();
        notifManager.notify(UPDATE_NOTIFICATION_ID, notification);
    }

    private void showUpdateAvailable(AppUpdate update, boolean manual) {
        String dismissed = prefs().getString("apk_update_dismissed", "");
        if (!manual && update.version.equals(dismissed)) return;
        new AlertDialog.Builder(this)
                .setTitle("Доступно обновление")
                .setMessage("Новая версия ГульРейтинга " + update.version + ". Скачать APK и установить сейчас?")
                .setPositiveButton("Скачать и установить", (dialog, which) -> downloadAndInstallUpdate(update.apkUrl, update.version))
                .setNegativeButton("Позже", (dialog, which) -> prefs().edit().putString("apk_update_dismissed", update.version).apply())
                .show();
    }

    private void downloadAndInstallUpdate(String url, String version) {
        if (updateDownloadRunning) {
            Toast.makeText(this, "Загрузка обновления уже выполняется", Toast.LENGTH_SHORT).show();
            return;
        }
        if (url == null || !url.startsWith("https://github.com/ToshakGulina/gulrating/releases/download/")) {
            Toast.makeText(this, "Некорректная ссылка на обновление", Toast.LENGTH_LONG).show();
            return;
        }
        updateDownloadRunning = true;
        showUpdateProgress();
        new Thread(() -> {
            java.io.File apkFile = downloadUpdateFile(url, version);
            updateDownloadRunning = false;
            handler.post(() -> {
                hideUpdateProgress();
                if (isFinishing()) return;
                if (apkFile == null) {
                    Toast.makeText(this, "Не удалось скачать обновление. Проверьте подключение к интернету.", Toast.LENGTH_LONG).show();
                    return;
                }
                pendingInstallFile = apkFile;
                beginApkInstall(apkFile, version);
            });
        }, "gulrating-apk-update-download").start();
    }

    private java.io.File downloadUpdateFile(String url, String version) {
        java.net.HttpURLConnection connection = null;
        java.io.File outputFile = null;
        boolean verifiedApk = false;
        try {
            java.io.File downloadDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDir == null) downloadDir = getFilesDir();
            if (!downloadDir.exists() && !downloadDir.mkdirs()) return null;
            String safeVersion = version.replaceAll("[^A-Za-z0-9._-]", "_");
            outputFile = new java.io.File(downloadDir, "gulrating-v" + safeVersion + ".apk");
            connection = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "GulRating-Android/" + BuildConfig.VERSION_NAME);
            if (connection.getResponseCode() != 200) return null;
            long total = connection.getContentLengthLong();
            if (total > 300L * 1024L * 1024L) return null;
            try (java.io.InputStream input = connection.getInputStream();
                 java.io.FileOutputStream output = new java.io.FileOutputStream(outputFile)) {
                byte[] buffer = new byte[32 * 1024];
                long downloaded = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    downloaded += count;
                    if (downloaded > 300L * 1024L * 1024L) return null;
                    output.write(buffer, 0, count);
                    if (total > 0) {
                        int progress = (int) Math.min(100, downloaded * 100 / total);
                        handler.post(() -> updateDownloadProgress(progress));
                    }
                }
                output.getFD().sync();
                if (total > 0 && downloaded != total) return null;
            }
            PackageInfo archive = getPackageManager().getPackageArchiveInfo(outputFile.getAbsolutePath(), 0);
            if (archive == null || archive.applicationInfo == null
                    || !getPackageName().equals(archive.applicationInfo.packageName)
                    || !version.equals(archive.versionName)
                    || !isNewerAppVersion(archive.versionName, BuildConfig.VERSION_NAME)) return null;
            verifiedApk = true;
            return outputFile;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
            if (!verifiedApk && outputFile != null && outputFile.exists()) outputFile.delete();
        }
    }

    private void showUpdateProgress() {
        updateProgressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        updateProgressBar.setMax(100);
        updateProgressBar.setIndeterminate(true);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        FrameLayout container = new FrameLayout(this);
        container.setPadding(padding, padding, padding, padding);
        container.addView(updateProgressBar, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
        updateProgressDialog = new AlertDialog.Builder(this)
                .setTitle("Скачивание обновления…")
                .setView(container)
                .setNegativeButton("Скрыть", (dialog, which) -> { })
                .create();
        updateProgressDialog.show();
    }

    private void updateDownloadProgress(int progress) {
        if (updateProgressBar != null) {
            updateProgressBar.setIndeterminate(false);
            updateProgressBar.setProgress(progress);
        }
    }

    private void hideUpdateProgress() {
        if (updateProgressDialog != null && updateProgressDialog.isShowing()) updateProgressDialog.dismiss();
        updateProgressDialog = null;
        updateProgressBar = null;
    }

    private void beginApkInstall(java.io.File apkFile, String version) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(this)
                    .setTitle("Разрешите установку APK")
                    .setMessage("Android попросит разрешить установку приложений из этого источника. После выдачи разрешения откроется системное окно установки обновления.")
                    .setPositiveButton("Открыть настройки", (dialog, which) -> {
                        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        startActivityForResult(settings, REQUEST_UNKNOWN_SOURCES);
                    })
                    .setNegativeButton("Отмена", null)
                    .show();
            return;
        }
        try {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                // Close both streams before commit: PackageInstaller rejects a
                // session while any write handles are still open ("Files still open").
                try (java.io.InputStream input = new java.io.FileInputStream(apkFile);
                     java.io.OutputStream output = session.openWrite("gulrating-update.apk", 0, apkFile.length())) {
                    byte[] buffer = new byte[32 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    session.fsync(output);
                }
                Intent statusIntent = new Intent(this, MainActivity.class).setAction(ACTION_INSTALL_STATUS);
                statusIntent.putExtra(EXTRA_UPDATE_VERSION, version);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent statusPendingIntent = PendingIntent.getActivity(this, sessionId, statusIntent, flags);
                session.commit(statusPendingIntent.getIntentSender());
            }
            Toast.makeText(this, "Откройте системное окно Android и подтвердите установку", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Toast.makeText(this, "Не удалось запустить установщик: " + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void handleUpdaterIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (ACTION_DOWNLOAD_UPDATE.equals(action)) {
            String url = intent.getStringExtra(EXTRA_UPDATE_URL);
            String version = intent.getStringExtra(EXTRA_UPDATE_VERSION);
            pendingUpdateUrl = url == null ? "" : url;
            pendingUpdateVersion = version == null ? "" : version;
            downloadAndInstallUpdate(pendingUpdateUrl, pendingUpdateVersion);
            intent.setAction(null);
        } else if (ACTION_INSTALL_STATUS.equals(action)) {
            handleInstallStatus(intent);
            intent.setAction(null);
        }
    }

    private void handleInstallStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation;
            if (Build.VERSION.SDK_INT >= 33) confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            else confirmation = (Intent) intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmation != null) startActivity(confirmation);
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(this, "Обновление установлено", Toast.LENGTH_LONG).show();
        } else if (status != PackageInstaller.STATUS_FAILURE_ABORTED) {
            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            Toast.makeText(this, "Установка не завершена: " + (message == null ? "ошибка Android" : message), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleUpdaterIntent(intent);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_POST_NOTIFICATIONS && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED
                && !pendingUpdateUrl.isEmpty() && !pendingUpdateVersion.isEmpty()) {
            postUpdateNotification(new AppUpdate(pendingUpdateVersion, pendingUpdateUrl));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_UNKNOWN_SOURCES && pendingInstallFile != null) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls()) {
                beginApkInstall(pendingInstallFile, pendingUpdateVersion);
            } else {
                Toast.makeText(this, "Разрешение на установку APK не выдано", Toast.LENGTH_LONG).show();
            }
        }
    }

    private WebResourceResponse bundledWebResponse(String requestPath) {
        String path = requestPath == null || requestPath.isEmpty() || "/".equals(requestPath)
                ? "index.html" : requestPath.replaceFirst("^/", "");
        // Не даём URL-кодированным сегментам выйти из папки локальных ассетов.
        if (path.contains("..") || path.contains("\\")) return null;
        String assetPath = "web/" + path;
        try {
            AssetManager assets = getAssets();
            String mime = mimeType(path);
            return new WebResourceResponse(mime, mime.startsWith("text/") || mime.contains("javascript")
                    || mime.contains("json") || mime.contains("xml") ? "UTF-8" : null,
                    200, "OK", java.util.Collections.singletonMap("Cache-Control", "no-cache"),
                    assets.open(assetPath));
        } catch (Exception ignored) {
            // API routes (например /tmdb) и неизвестные ресурсы должны идти
            // в сеть, а не подменяться пустым ответом.
            return null;
        }
    }

    private String mimeType(String path) {
        String p = path.toLowerCase(java.util.Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("gulrating", MODE_PRIVATE);
    }

    private boolean isPlayerSessionUrl(String url) {
        // Смежные домены сеанса плеера (зеркала любят скакать по хостам).
        // Compare the parsed home origin instead of a string prefix so a URL
        // without a trailing slash still ends the native progress session.
        return inPlayerSession && url != null && !isHomeShellUrl(url);
    }

    private boolean onPlayer() {
        return isPlayerHost(web.getUrl()) || inPlayerSession;
    }

    private static final int IMMERSIVE_FLAGS = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;

    // Флаги ставятся на decor-вью окна (и дублируются на кастомную вью):
    // на дочерних представлениях система их не учитывает как системные
    private void applyImmersive(View v) {
        if (v != null) v.setSystemUiVisibility(IMMERSIVE_FLAGS);
        getWindow().getDecorView().setSystemUiVisibility(IMMERSIVE_FLAGS);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Вернули фокус в фуллскрине — восстанавливаем иммерсивность
        if (hasFocus && customView != null) applyImmersive(customView);
    }

    private void setPlayerUA() {
        web.getSettings().setUserAgentString(DESKTOP_UA);
    }

    private void enterCinema() {
        cinema = true;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        applyImmersive(null);
    }

    private void exitCinema() {
        if (!cinema) return;
        cinema = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    private void exitFullscreen() {
        if (customView == null) return;
        if (!cinema) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
        root.removeView(customView);
        customView = null;
        web.setVisibility(View.VISIBLE);
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    private boolean isPlayerHost(String url) {
        if (url == null) return false;
        String host = Uri.parse(url).getHost();
        if (host == null) return false;
        for (String h : PLAYER_HOSTS) {
            // С поддоменами: theatre.stravers.live, player.kinobox.tv и т.п.
            if (host.equals(h) || host.endsWith("." + h)) return true;
        }
        return false;
    }

    private static final String FIND_VIDEO_JS =
            "(function(){"
                    + "function findVideo(w,depth){"
                    + "try{var vs=w.document.querySelectorAll('video'),candidate=null;"
                    + "for(var i=0;i<vs.length;i++){var v=vs[i];"
                    + "if(Number.isFinite(v.duration)&&v.duration>0)return v;"
                    + "if(!candidate)candidate=v;}"
                    + "if(depth<3)for(var j=0;j<w.frames.length;j++){"
                    + "var nested=findVideo(w.frames[j],depth+1);"
                    + "if(nested&&Number.isFinite(nested.duration)&&nested.duration>0)return nested;"
                    + "if(!candidate)candidate=nested;}return candidate;}"
                    + "catch(e){}return null;}"
                    + "var v=findVideo(window,0);"
                    + "if(!v)return null;return {t:v.currentTime||0,d:v.duration||0};})()";

    private void installPlaybackProgressTracker() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        try (InputStream input = getAssets().open("player-progress-tracker.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String script = output.toString(StandardCharsets.UTF_8.name());
            // The observer is intentionally tiny and only reports media timing.
            // It must run in embedded cross-origin frames as well as the main page.
            WebViewCompat.addDocumentStartJavaScript(web, script,
                    java.util.Collections.singleton("*"));
        } catch (Exception ignored) {
            // On old System WebView builds the existing main-frame probe remains active.
        }
    }

    private void storePlaybackPosition(String key, long t, long d, boolean force) {
        if (!playbackTrackingEnabled || key == null || key.isEmpty()
                || !key.equals(currentWatchKey) || t <= 0 || d <= 0
                || d > 7L * 24L * 60L * 60L || t > d + 30) return;
        long now = System.currentTimeMillis();
        synchronized (positionsLock) {
            if (!playbackTrackingEnabled || !key.equals(currentWatchKey)) return;
            try {
                org.json.JSONObject all = new org.json.JSONObject(prefs().getString("positions", "{}"));
                org.json.JSONObject previous = all.optJSONObject(key);
                if (previous != null) {
                    long previousAt = previous.optLong("at", 0);
                    long previousDuration = previous.optLong("d", 0);
                    // Ignore tiny ad/preview clips that would otherwise replace
                    // a saved feature-length movie or full episode position.
                    if (previousDuration >= 600 && d * 3 < previousDuration) return;
                    long minInterval = force ? 750L : 2500L;
                    if (now - previousAt < minInterval) return;
                }
                org.json.JSONObject record = new org.json.JSONObject();
                record.put("t", t);
                record.put("d", d);
                record.put("at", now);
                all.put(key, record);
                prefs().edit().putString("positions", all.toString()).apply();
            } catch (Exception ignored) {
            }
        }
    }

    private void probePlayer() {
        final String key = currentWatchKey;
        if (key == null || key.isEmpty() || !onPlayer() || web == null) return;
        web.evaluateJavascript(FIND_VIDEO_JS, value -> {
            if (!key.equals(currentWatchKey) || value == null || value.isEmpty() || "null".equals(value)) return;
            try {
                Object decoded = new org.json.JSONTokener(value).nextValue();
                // evaluateJavascript отдаёт JSON-представление результата; старые
                // версии возвращали JSON.stringify(...) и получали здесь строку.
                org.json.JSONObject state = decoded instanceof org.json.JSONObject
                        ? (org.json.JSONObject) decoded
                        : decoded instanceof String
                                ? new org.json.JSONObject((String) decoded) : null;
                if (state == null) return;
                long t = Math.round(state.optDouble("t", 0));
                long d = Math.round(state.optDouble("d", 0));
                if (t <= 0 || d <= 0) return;
                storePlaybackPosition(key, t, d, false);
            } catch (Exception ignored) {
            }
        });
    }

    // Плеер может загрузить метаданные после onPageFinished. Повторяем попытку
    // до 45 секунд и прекращаем, если пользователь уже начал смотреть дальше.
    private void resumePlayback(final WebView view) {
        final String key = currentWatchKey;
        if (key == null || key.isEmpty() || view == null) return;
        try {
            org.json.JSONObject all = new org.json.JSONObject(prefs().getString("positions", "{}"));
            org.json.JSONObject rec = all.optJSONObject(key);
            if (rec == null) return;
            final long t = rec.optLong("t", 0);
            final long d = rec.optLong("d", 0);
            if (t < 30 || d <= 0 || t > d - 20) return;
            attemptResumePlayback(view, view.getUrl(), t, 0);
        } catch (Exception ignored) {
        }
    }

    private void attemptResumePlayback(final WebView view, final String playerUrl,
                                       final long target, final int attempt) {
        if (attempt >= 30 || view == null
                || (!isPlayerHost(view.getUrl()) && !isPlayerSessionUrl(view.getUrl()))
                || (playerUrl != null && !playerUrl.equals(view.getUrl()))) return;
        String script = "(function(){"
                + "function findVideo(w,depth){try{var vs=w.document.querySelectorAll('video'),candidate=null;"
                + "for(var i=0;i<vs.length;i++){var v=vs[i];"
                + "if(Number.isFinite(v.duration)&&v.duration>0)return v;"
                + "if(!candidate)candidate=v;}"
                + "if(depth<3)for(var j=0;j<w.frames.length;j++){"
                + "var nested=findVideo(w.frames[j],depth+1);"
                + "if(nested&&Number.isFinite(nested.duration)&&nested.duration>0)return nested;"
                + "if(!candidate)candidate=nested;}return candidate;}"
                + "catch(e){}return null;}"
                + "var v=findVideo(window,0);if(!v)return 'wait';"
                + "if(!Number.isFinite(v.duration)||v.duration<=0){"
                + "if(v.__gulratingResumeTarget!==" + target + "){"
                + "v.__gulratingResumeTarget=" + target + ";"
                + "var retry=function(){v.removeEventListener('loadedmetadata',retry);"
                + "if(Number.isFinite(v.duration)&&v.duration>" + target + "+10&&v.currentTime<=10)"
                + "v.currentTime=" + target + ";};"
                + "v.addEventListener('loadedmetadata',retry);}return 'wait';}"
                + "if(v.currentTime>10)return 'already-playing';"
                + "if(" + target + ">=v.duration-10)return 'invalid-position';"
                + "v.currentTime=" + target + ";return 'seeked';})()";
        view.evaluateJavascript(script, value -> {
            String result = decodeJavascriptString(value);
            if ("wait".equals(result)) {
                handler.postDelayed(() -> attemptResumePlayback(view, playerUrl,
                        target, attempt + 1), 1500L);
            }
        });
    }

    private String decodeJavascriptString(String value) {
        if (value == null) return "";
        try {
            Object decoded = new org.json.JSONTokener(value).nextValue();
            return decoded instanceof String ? (String) decoded : String.valueOf(decoded);
        } catch (Exception ignored) {
            return value;
        }
    }

    private void showNotification(String text) {
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle("ГульРейтинг")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setAutoCancel(true)
                .build();
        notifManager.notify((int) (System.currentTimeMillis() % 100000), n);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Свернули/закрыли приложение — позиция просмотра сохранена
        probePlayer();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        web.restoreState(savedInstanceState);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            exitFullscreen();
            return;
        }
        if (cinema) {
            exitCinema();
            return;
        }
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}

package dev.gulrating.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * ГульРейтинг на Android без Google Play: тонкая WebView-обёртка поверх
 * PWA-сайта плюс возможности, которые без натива не дать:
 *  — плеер kinokino.vip открывается внутри приложения;
 *  — мост GulRatingBridge: сайт сообщает, какой тайтл смотрят, приложение
 *    опрашивает <video> плеера раз в 5 секунд и хранит позицию просмотра;
 *  — при повторном входе в плеер позиция подставляется (продолжить с места);
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

    private WebView web;
    private Handler handler;
    private NotificationManager notifManager;
    // Ключ тайтла, который сейчас смотрят: "tv:123" / "movie:456"
    private volatile String currentWatchKey = "";
    // Идёт сеанс плеера: после входа на хост плеера держим внутри WebView
    // любые редиректы и смежные домены, пока пользователь не вернётся на сайт
    private volatile boolean inPlayerSession = false;
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
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Просмотр и новые сезоны", NotificationManager.IMPORTANCE_DEFAULT);
        notifManager.createNotificationChannel(ch);
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
        web.setWebViewClient(new WebViewClient() {
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
                    inPlayerSession = false;
                    exitCinema();
                    web.getSettings().setUserAgentString(homeUA);
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
                if (!isPlayerHost(url)) return;
                resumePlayback(view);
            }
        });

        // Мост для сайта: репорт тайтла, позиции просмотра, нативные уведомления
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void reportWatch(String json) {
                try {
                    org.json.JSONObject o = new org.json.JSONObject(json);
                    currentWatchKey = o.optString("type") + ":" + o.optString("id");
                } catch (Exception ignored) {
                }
            }

            @JavascriptInterface
            public String getPositions() {
                return prefs().getString("positions", "{}");
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
                handler.post(() -> {
                    // Фреймовый режим (embed-only плееры): тоже десктопный UA
                    setPlayerUA();
                    enterCinema();
                });
            }

            @JavascriptInterface
            public void notify(final String text) {
                handler.post(() -> showNotification(text));
            }
        }, "GulRatingBridge");

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
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("gulrating", MODE_PRIVATE);
    }

    private boolean isPlayerSessionUrl(String url) {
        // Смежные домены сеанса плеера (зеркала любят скакать по хостам)
        return inPlayerSession && url != null && !url.startsWith(HOME);
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

    private void probePlayer() {
        final String key = currentWatchKey;
        if (key == null || key.isEmpty()) return;
        if (!onPlayer()) return;
        web.evaluateJavascript(
                "(function(){var v=document.querySelector('video');if(!v||!v.duration)return '';return JSON.stringify({t:v.currentTime,d:v.duration});})()",
                value -> {
                    if (value == null || value.isEmpty() || "null".equals(value)) return;
                    try {
                        org.json.JSONObject o = new org.json.JSONObject(value);
                        long t = Math.round(o.optDouble("t", 0));
                        long d = Math.round(o.optDouble("d", 0));
                        if (t <= 0 || d <= 0) return;
                        SharedPreferences p = prefs();
                        org.json.JSONObject all = new org.json.JSONObject(p.getString("positions", "{}"));
                        org.json.JSONObject rec = new org.json.JSONObject();
                        rec.put("t", t);
                        rec.put("d", d);
                        rec.put("at", System.currentTimeMillis());
                        all.put(key, rec);
                        p.edit().putString("positions", all.toString()).apply();
                    } catch (Exception ignored) {
                    }
                });
    }

    // Подставляем сохранённую позицию: плеер может инициализироваться с задержкой,
    // поэтому несколько попыток
    private void resumePlayback(final WebView view) {
        final String key = currentWatchKey;
        if (key == null || key.isEmpty()) return;
        try {
            org.json.JSONObject all = new org.json.JSONObject(prefs().getString("positions", "{}"));
            org.json.JSONObject rec = all.optJSONObject(key);
            if (rec == null) return;
            final long t = rec.optLong("t", 0);
            final long d = rec.optLong("d", 0);
            // Не продолжаем начало и самый конец
            if (t < 30 || d <= 0 || t > d - 20) return;
            for (int i = 0; i < 6; i++) {
                handler.postDelayed(() -> view.evaluateJavascript(
                        "(function(){var v=document.querySelector('video');if(!v||!v.duration||v.currentTime>5)return 'wait';v.currentTime=" + t + ";return 'ok';})()",
                        val -> {
                        }), i * 1500L);
            }
        } catch (Exception ignored) {
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

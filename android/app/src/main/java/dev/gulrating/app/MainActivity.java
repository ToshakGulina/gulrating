package dev.gulrating.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
    private static final String[] PLAYER_HOSTS = { "kinokino.vip", "www.kinokino.vip" };
    private static final String CHANNEL = "gulrating-watch";

    private WebView web;
    private Handler handler;
    private NotificationManager notifManager;
    // Ключ тайтла, который сейчас смотрят: "tv:123" / "movie:456"
    private volatile String currentWatchKey = "";

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        notifManager = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Просмотр и новые сезоны", NotificationManager.IMPORTANCE_DEFAULT);
        notifManager.createNotificationChannel(ch);
        handler = new Handler(Looper.getMainLooper());

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f172a"));

        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setDatabaseEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        // Кэш и cookie WebView: service worker сайта живёт на них же
        web.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
        // Маркер для сайта: включает поведение «приложение» (офлайн-база,
        // открытие плеера внутри WebView)
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " GulRatingApp/1");

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                // Всё своё открываем внутри приложения, внешние ссылки
                // (Кинопоиск, Телеграм) — в браузере телефона
                if (host != null && host.equals(HOME_HOST)) return false;
                if (host != null) {
                    for (String playerHost : PLAYER_HOSTS) {
                        if (host.equals(playerHost)) return false;
                    }
                }
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

            @JavascriptInterface
            public void notify(final String text) {
                handler.post(() -> showNotification(text));
            }
        }, "GulRatingBridge");

        // Опрос <video> плеера: позиция и длительность для истории просмотра
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                probePlayer();
                handler.postDelayed(this, 5000);
            }
        }, 5000);

        if (savedInstanceState == null) {
            web.loadUrl(HOME);
        }
        setContentView(web);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("gulrating", MODE_PRIVATE);
    }

    private boolean isPlayerHost(String url) {
        if (url == null) return false;
        String host = Uri.parse(url).getHost();
        if (host == null) return false;
        for (String h : PLAYER_HOSTS) {
            if (h.equals(host)) return true;
        }
        return false;
    }

    private void probePlayer() {
        final String key = currentWatchKey;
        if (key == null || key.isEmpty()) return;
        if (!isPlayerHost(web.getUrl())) return;
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
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}

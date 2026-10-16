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
import android.webkit.WebResourceResponse;
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
    private static final String[] PLAYER_HOSTS = { "kinokino.vip", "www.kinokino.vip" };
    private static final String CHANNEL = "gulrating-watch";

    private WebView web;
    private Handler handler;
    private NotificationManager notifManager;
    // Ключ тайтла, который сейчас смотрят: "tv:123" / "movie:456"
    private volatile String currentWatchKey = "";
    // Идёт сеанс плеера: после входа на хост плеера держим внутри WebView
    // любые редиректы и смежные домены, пока пользователь не вернётся на сайт
    private volatile boolean inPlayerSession = false;
    // User-Agent кэшируем: из shouldInterceptRequest (фоновый поток)
    // обращаться к WebView нельзя
    private String userAgent;
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
        // Маркер для сайта: включает поведение «приложение» (офлайн-база,
        // открытие плеера внутри WebView)
        userAgent = web.getSettings().getUserAgentString() + " GulRatingApp/1";
        web.getSettings().setUserAgentString(userAgent);

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
                applyImmersive(customView);
                web.setVisibility(View.GONE);
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
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // Видео плеера обычно лежит во вложенном фрейме чужого домена:
                // из натива туда не дотянуться, поэтому подменяем HTML документа
                // (главного кадра и фреймов плеера) своей копией со скриптом-мостом:
                // он шлёт позицию в GulRatingBridge и сам продолжает с сохранённой минуты
                if (inPlayerSession && "GET".equals(request.getMethod())) {
                    String accept = request.getRequestHeaders() == null
                            ? "" : String.valueOf(request.getRequestHeaders().get("Accept"));
                    boolean isDoc = request.isForMainFrame() || accept.contains("text/html");
                    String url = request.getUrl().toString();
                    if (isDoc && !url.startsWith(HOME)) {
                        WebResourceResponse injected = injectBridgeScript(url);
                        if (injected != null) return injected;
                    }
                }
                return super.shouldInterceptRequest(view, request);
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

            // Позицию репортит скрипт, внедрённый в страницу плеера
            // (видео часто живёт во вложенном фрейме — оттуда и пишем)
            @JavascriptInterface
            public void reportPosition(final long t, final long d) {
                final String key = currentWatchKey;
                if (key == null || key.isEmpty() || t <= 0 || d <= 0) return;
                try {
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
            }

            // С какой минуты продолжать (0 — не продолжать)
            @JavascriptInterface
            public long getResume() {
                final String key = currentWatchKey;
                if (key == null || key.isEmpty()) return 0;
                try {
                    org.json.JSONObject all = new org.json.JSONObject(prefs().getString("positions", "{}"));
                    org.json.JSONObject rec = all.optJSONObject(key);
                    if (rec == null) return 0;
                    long t = rec.optLong("t", 0);
                    long d = rec.optLong("d", 0);
                    if (t < 30 || d <= 0 || t > d - 20) return 0;
                    return t;
                } catch (Exception e) {
                    return 0;
                }
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

    private void applyImmersive(View v) {
        v.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Вернули фокус в фуллскрине — восстанавливаем иммерсивность
        if (hasFocus && customView != null) applyImmersive(customView);
    }

    private void exitFullscreen() {
        if (customView == null) return;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
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
            if (h.equals(host)) return true;
        }
        return false;
    }

    private WebResourceResponse injectBridgeScript(String url) {
        try {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestProperty("Accept", "text/html");
            c.setRequestProperty("User-Agent", userAgent);
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            if (c.getResponseCode() != 200) return null;
            String ctype = c.getContentType();
            if (ctype == null || !ctype.contains("text/html")) return null;
            String charset = "UTF-8";
            int cs = ctype.toLowerCase().indexOf("charset=");
            if (cs >= 0) {
                String named = ctype.substring(cs + 8).split("[;\s]")[0].trim();
                if (!named.isEmpty()) charset = named;
            }
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            java.io.InputStream in = c.getInputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            String html;
            try {
                html = bos.toString(charset);
            } catch (Exception enc) {
                html = bos.toString("UTF-8");
            }
            String script = "<script>(function(){function rp(){try{var v=document.querySelector('video');"
                    + "if(v&&v.duration&&window.GulRatingBridge){GulRatingBridge.reportPosition(Math.round(v.currentTime),Math.round(v.duration));}}"
                    + "catch(e){}}setInterval(rp,3000);rp();"
                    + "var s=0;try{s=window.GulRatingBridge?window.GulRatingBridge.getResume():0;}catch(e){}"
                    + "if(s>0){var k=0;var iv=setInterval(function(){try{var v=document.querySelector('video');"
                    + "if(v&&v.duration&&v.currentTime<5){v.currentTime=s;clearInterval(iv);}}catch(e){}if(++k>25)clearInterval(iv);},1000);}"
                    + "document.addEventListener('DOMContentLoaded',rp);})();</script>";
            int idx = html.lastIndexOf("</body>");
            if (idx > 0) html = html.substring(0, idx) + script + html.substring(idx);
            else html = html + script;
            byte[] out;
            try {
                out = html.getBytes(charset);
            } catch (Exception enc) {
                out = html.getBytes("UTF-8");
            }
            return new WebResourceResponse("text/html", charset,
                    new java.io.ByteArrayInputStream(out));
        } catch (Exception e) {
            return null; // не смогли подменить — пусть грузится оригинал
        }
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
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}

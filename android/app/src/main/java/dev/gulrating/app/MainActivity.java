package dev.gulrating.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * ГульРейтинг на Android без Google Play: тонкая WebView-обёртка поверх
 * PWA-сайта. Всё приложение — это сам сайт: оценки, каталог, бот-ссылки,
 * офлайн-оболочку даёт service worker сайта, поэтому обёрнка сознательно
 * минимальна и не дублирует логику.
 *
 * Установка: sideload APK (файл собирается GitHub Actions, см. README).
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://gulrating.pages.dev/";
    private static final String HOME_HOST = "gulrating.pages.dev";
    // Хосты плеера: открываются внутри WebView приложения (кнопка «Смотреть»),
    // кнопка «назад» телефона возвращает к сайту через историю WebView
    private static final String[] PLAYER_HOSTS = { "kinokino.vip", "www.kinokino.vip" };

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
        });

        if (savedInstanceState == null) {
            web.loadUrl(HOME);
        }
        setContentView(web);
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

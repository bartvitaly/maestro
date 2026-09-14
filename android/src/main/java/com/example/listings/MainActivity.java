package com.example.listings;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Thin WebView shell around the static Harbor Lease demo.
 * Not a Capacitor / Play Store binary. Default URL is the emulator host alias.
 */
public class MainActivity extends Activity {
    public static final String EXTRA_URL = "url";
    public static final String DEFAULT_URL = "http://10.0.2.2:4173";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        WebView web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        web.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        return false;
                    }
                });
        setContentView(web);
        web.loadUrl(resolveUrl(getIntent()));
    }

    static String resolveUrl(Intent intent) {
        if (intent == null) return DEFAULT_URL;
        String extra = intent.getStringExtra(EXTRA_URL);
        if (extra != null && extra.length() > 0) return extra;
        Uri data = intent.getData();
        if (data != null && data.toString().length() > 0) return data.toString();
        return DEFAULT_URL;
    }
}

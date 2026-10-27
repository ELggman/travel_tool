package com.yanlu.travel;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String TAG = "YanluMain";
    private static final int PORT = 8765;
    private static final String START_URL =
            "http://127.0.0.1:" + PORT + "/index.html";

    private LocalServer server;
    private LanSyncServer lanServer;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        getWindow().setBackgroundDrawable(new ColorDrawable(0xFFF2EDE1));
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(30, 40, 34));
        getWindow().setNavigationBarColor(Color.rgb(30, 40, 34));
        WebView.setWebContentsDebuggingEnabled(true);

        try {
            server = new LocalServer(getAssets(), PORT);
            server.start();
        } catch (Exception e) {
            Log.e(TAG, "local server failed", e);
            showError("本地服务启动失败: " + e.getMessage());
            return;
        }

        webView = new WebView(this);
        webView.setBackgroundColor(0xFFF2EDE1);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.addJavascriptInterface(new LanBridge(), "YanluLan");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                Log.i(TAG, "page finished: " + url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                Log.e(TAG, "web error: " + request.getUrl() + " " + error.getDescription());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d("YanluWeb", message.message() + " @" + message.lineNumber());
                return true;
            }
        });

        setContentView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(START_URL);
    }

    public class LanBridge {
        @JavascriptInterface
        public String start() {
            try {
                if (lanServer == null) lanServer = new LanSyncServer(8766);
                return lanServer.start();
            } catch (Exception e) {
                Log.e(TAG, "lan start failed", e);
                return "{\"ok\":false,\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
            }
        }

        @JavascriptInterface
        public String stop() {
            if (lanServer != null) lanServer.stop();
            return "{\"ok\":true}";
        }

        @JavascriptInterface
        public String info() {
            return lanServer == null ? "{\"ok\":false,\"error\":\"not started\"}" : lanServer.getInfo();
        }

        @JavascriptInterface
        public String publish(String tripJson) {
            return lanServer == null ? "{\"ok\":false,\"error\":\"not started\"}" : lanServer.publish(tripJson);
        }

        @JavascriptInterface
        public String publishAt(String tripJson, int baseVersion) {
            return lanServer == null ? "{\"ok\":false,\"error\":\"not started\"}" : lanServer.publishAt(tripJson, baseVersion);
        }

        @JavascriptInterface
        public String publishAtSeq(String tripJson, int baseVersion, String clientId, int seq) {
            return lanServer == null ? "{\"ok\":false,\"error\":\"not started\"}" : lanServer.publishAt(tripJson, baseVersion, clientId, seq);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (lanServer != null) lanServer.stop();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void showError(String message) {
        TextView view = new TextView(this);
        view.setText(message);
        view.setTextColor(Color.WHITE);
        view.setTextSize(16);
        view.setBackgroundColor(Color.rgb(30, 40, 34));
        view.setPadding(48, 96, 48, 48);
        setContentView(view);
    }
}

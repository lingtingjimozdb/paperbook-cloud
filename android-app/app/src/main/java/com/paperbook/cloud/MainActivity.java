package com.paperbook.cloud;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String APP_URL =
            "https://lingtingjimozdb.github.io/paperbook-cloud/?app=android&v=8";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int STORAGE_PERMISSION_REQUEST = 1002;

    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> filePathCallback;

    private byte[] pendingDownloadBytes;
    private String pendingDownloadName;
    private String pendingDownloadMime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(0xFF2F6555);
            getWindow().setNavigationBarColor(0xFFFFFFFF);
        }

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        progressBar = new ProgressBar(
                this,
                null,
                android.R.attr.progressBarStyleHorizontal
        );
        progressBar.setMax(100);

        root.addView(
                webView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                )
        );

        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                dp(3)
        );
        root.addView(progressBar, progressParams);
        setContentView(root);

        configureWebView();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(
                settings.getUserAgentString() + " PaperBookAndroid/1.0"
        );

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new PaperBookWebViewClient());
        webView.setWebChromeClient(new PaperBookChromeClient());

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || url.startsWith("blob:")) return;
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.addRequestHeader(
                        "Cookie",
                        CookieManager.getInstance().getCookie(url)
                );
                request.addRequestHeader("User-Agent", userAgent);
                request.setTitle(URLUtil.guessFileName(url, contentDisposition, mimeType));
                request.setDescription("正在下载 PaperBook 文件");
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                );
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        URLUtil.guessFileName(url, contentDisposition, mimeType)
                );
                DownloadManager manager =
                        (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(this, "已开始下载", Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "下载失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    private class PaperBookWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost();

            if (host != null && (
                    host.equals("lingtingjimozdb.github.io") ||
                    host.endsWith(".supabase.co")
            )) {
                return false;
            }

            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            progressBar.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progressBar.setVisibility(View.GONE);
            injectMobileInterface();
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(
                WebView view,
                WebResourceRequest request,
                WebResourceError error
        ) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                    request.isForMainFrame()) {
                showOfflinePage();
            }
        }
    }

    private class PaperBookChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallbackValue,
                FileChooserParams fileChooserParams
        ) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }

            filePathCallback = filePathCallbackValue;

            Intent intent;
            try {
                intent = fileChooserParams.createIntent();
            } catch (Exception error) {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
            }

            try {
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                return true;
            } catch (Exception error) {
                filePathCallback = null;
                Toast.makeText(
                        MainActivity.this,
                        "无法打开文件选择器",
                        Toast.LENGTH_LONG
                ).show();
                return false;
            }
        }
    }

    private void injectMobileInterface() {
        try {
            InputStream input = getAssets().open("mobile_inject.js");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            input.close();
            String javascript = output.toString(StandardCharsets.UTF_8.name());
            webView.evaluateJavascript(javascript, null);
        } catch (Exception error) {
            Toast.makeText(
                    this,
                    "手机界面加载失败：" + error.getMessage(),
                    Toast.LENGTH_LONG
            ).show();
        }
    }

    private void showOfflinePage() {
        String html =
                "<!doctype html><html lang='zh-CN'><head>" +
                "<meta charset='utf-8'><meta name='viewport' " +
                "content='width=device-width,initial-scale=1'>" +
                "<style>body{font-family:sans-serif;background:#f6f4ee;" +
                "display:flex;align-items:center;justify-content:center;" +
                "min-height:100vh;margin:0;color:#292d2a}.card{width:82%;" +
                "background:white;padding:28px;border-radius:18px;text-align:center;" +
                "box-shadow:0 12px 34px rgba(0,0,0,.12)}button{background:#2f6555;" +
                "color:white;border:0;border-radius:12px;padding:13px 22px;" +
                "font-size:17px}</style></head><body><div class='card'>" +
                "<h2>暂时无法连接</h2><p>请检查手机网络，然后重新加载。</p>" +
                "<button onclick='AndroidBridge.reloadApp()'>重新加载</button>" +
                "</div></body></html>";

        webView.loadDataWithBaseURL(APP_URL, html, "text/html", "UTF-8", null);
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void reloadApp() {
            runOnUiThread(() -> webView.loadUrl(APP_URL));
        }

        @JavascriptInterface
        public void saveDataUrl(String fileName, String dataUrl, String mimeType) {
            new Thread(() -> {
                try {
                    int comma = dataUrl.indexOf(',');
                    String encoded = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
                    byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                    runOnUiThread(() -> saveDownload(fileName, bytes, mimeType));
                } catch (Exception error) {
                    runOnUiThread(() -> Toast.makeText(
                            MainActivity.this,
                            "保存失败：" + error.getMessage(),
                            Toast.LENGTH_LONG
                    ).show());
                }
            }).start();
        }
    }

    private void saveDownload(String fileName, byte[] bytes, String mimeType) {
        String safeName = sanitizeFileName(
                fileName == null || fileName.isEmpty()
                        ? "PaperBook_备份.json"
                        : fileName
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                values.put(
                        MediaStore.Downloads.MIME_TYPE,
                        mimeType == null || mimeType.isEmpty()
                                ? "application/octet-stream"
                                : mimeType
                );
                values.put(
                        MediaStore.Downloads.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/PaperBook"
                );

                Uri uri = getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        values
                );
                if (uri == null) throw new IllegalStateException("无法创建下载文件");

                try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
                    if (stream == null) throw new IllegalStateException("无法写入下载文件");
                    stream.write(bytes);
                }

                Toast.makeText(
                        this,
                        "已保存到：下载/PaperBook/" + safeName,
                        Toast.LENGTH_LONG
                ).show();
            } catch (Exception error) {
                Toast.makeText(
                        this,
                        "保存失败：" + error.getMessage(),
                        Toast.LENGTH_LONG
                ).show();
            }
            return;
        }

        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            pendingDownloadBytes = bytes;
            pendingDownloadName = safeName;
            pendingDownloadMime = mimeType;
            requestPermissions(
                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    STORAGE_PERMISSION_REQUEST
            );
            return;
        }

        saveLegacyDownload(safeName, bytes);
    }

    private void saveLegacyDownload(String safeName, byte[] bytes) {
        try {
            File directory = new File(
                    Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS
                    ),
                    "PaperBook"
            );
            if (!directory.exists() && !directory.mkdirs()) {
                throw new IllegalStateException("无法创建下载目录");
            }

            File target = new File(directory, safeName);
            try (FileOutputStream stream = new FileOutputStream(target)) {
                stream.write(bytes);
            }

            Toast.makeText(
                    this,
                    "已保存到：" + target.getAbsolutePath(),
                    Toast.LENGTH_LONG
            ).show();
        } catch (Exception error) {
            Toast.makeText(
                    this,
                    "保存失败：" + error.getMessage(),
                    Toast.LENGTH_LONG
            ).show();
        }
    }

    private String sanitizeFileName(String input) {
        return input.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == STORAGE_PERMISSION_REQUEST) {
            if (grantResults.length > 0 &&
                    grantResults[0] == PackageManager.PERMISSION_GRANTED &&
                    pendingDownloadBytes != null) {
                saveLegacyDownload(pendingDownloadName, pendingDownloadBytes);
            } else {
                Toast.makeText(this, "未获得保存文件权限", Toast.LENGTH_LONG).show();
            }

            pendingDownloadBytes = null;
            pendingDownloadName = null;
            pendingDownloadMime = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = null;

            if (resultCode == RESULT_OK) {
                results = WebChromeClient.FileChooserParams.parseResult(
                        resultCode,
                        data
                );
            }

            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }

        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript(
                "window.__paperbookAndroidBack ? " +
                "window.__paperbookAndroidBack() : false",
                value -> {
                    if ("true".equals(value)) return;

                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("退出 PaperBook")
                                .setMessage("确定关闭应用吗？未完成的内容会先由网页自动保存。")
                                .setNegativeButton("取消", null)
                                .setPositiveButton("退出", (dialog, which) -> finish())
                                .show();
                    }
                }
        );
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        webView.removeJavascriptInterface("AndroidBridge");
        webView.stopLoading();
        webView.setWebChromeClient(null);
        webView.setWebViewClient(null);
        webView.destroy();
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

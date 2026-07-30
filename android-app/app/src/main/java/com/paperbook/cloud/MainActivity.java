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
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
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
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public class MainActivity extends Activity {
    private static final String APP_URL =
            "https://lingtingjimozdb.github.io/paperbook-cloud/?app=android&v=email-auth-v9-2";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int STORAGE_PERMISSION_REQUEST = 1002;
    private static final int DOCUMENT_SCAN_REQUEST = 1003;

    private WebView webView;
    private ProgressBar progressBar;
    private Button scannerButton;
    private ValueCallback<Uri[]> filePathCallback;

    private byte[] pendingDownloadBytes;
    private String pendingDownloadName;
    private String pendingDownloadMime;
    private String pendingDownloadFolder;

    private ScanMode pendingScanMode = ScanMode.DOCUMENT_TEXT;
    private final TextRecognizer chineseRecognizer =
            TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    private final TextRecognizer latinRecognizer =
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

    private enum ScanMode {
        DOCUMENT_TEXT,
        BOOK_EBOOK,
        EXAM_CLEAN,
        EXAM_REMOVE_COLOR,
        ID_ARCHIVE,
        IMAGE_ONLY
    }

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

        scannerButton = new Button(this);
        scannerButton.setText("📷 扫描");
        scannerButton.setTextSize(15);
        scannerButton.setTextColor(Color.WHITE);
        scannerButton.setBackgroundColor(0xFF2F6555);
        scannerButton.setAllCaps(false);
        scannerButton.setVisibility(View.GONE);
        scannerButton.setOnClickListener(view -> showScannerMenu());

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

        FrameLayout.LayoutParams scannerParams = new FrameLayout.LayoutParams(
                dp(108),
                dp(50)
        );
        scannerParams.gravity = Gravity.END | Gravity.BOTTOM;
        scannerParams.setMargins(dp(12), dp(12), dp(14), dp(82));
        // V5 uses the shared web scan entry. The native button remains available
        // through AndroidBridge but is no longer added as a duplicate overlay.

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
            settings.getUserAgentString() + " PaperBookAndroid/9.0-Complete"
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

    private void showScannerMenu() {
        String[] items = {
                "文档转文字（保存到当前笔记）",
                "书籍多页扫描（PDF + TXT + EPUB）",
                "试卷清洁（纠偏、增强、去阴影）",
                "试卷去彩色答案/标记（实验）",
                "证件扫描（自动归档到证件文件夹）",
                "图片扫描（保存高清图片）"
        };

        new AlertDialog.Builder(this)
                .setTitle("PaperBook 扫描中心")
                .setItems(items, (dialog, which) -> {
                    ScanMode mode;
                    switch (which) {
                        case 1:
                            mode = ScanMode.BOOK_EBOOK;
                            break;
                        case 2:
                            mode = ScanMode.EXAM_CLEAN;
                            break;
                        case 3:
                            showColorRemovalWarning();
                            return;
                        case 4:
                            mode = ScanMode.ID_ARCHIVE;
                            break;
                        case 5:
                            mode = ScanMode.IMAGE_ONLY;
                            break;
                        case 0:
                        default:
                            mode = ScanMode.DOCUMENT_TEXT;
                            break;
                    }
                    startDocumentScanner(mode);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void showColorRemovalWarning() {
        new AlertDialog.Builder(this)
                .setTitle("去答案/标记说明")
                .setMessage(
                        "该模式可以较稳定地去除红色、蓝色等彩色笔迹和批改标记。" +
                        "黑色手写答案与黑色印刷题干颜色相同，当前本地算法无法保证准确区分，" +
                        "可能残留或误伤文字。请保留原始扫描文件。"
                )
                .setNegativeButton("取消", null)
                .setPositiveButton(
                        "继续扫描",
                        (dialog, which) -> startDocumentScanner(ScanMode.EXAM_REMOVE_COLOR)
                )
                .show();
    }

    private void startDocumentScanner(ScanMode mode) {
        pendingScanMode = mode;
        int pageLimit;
        switch (mode) {
            case BOOK_EBOOK:
                pageLimit = 100;
                break;
            case ID_ARCHIVE:
                pageLimit = 2;
                break;
            case IMAGE_ONLY:
                pageLimit = 1;
                break;
            case EXAM_CLEAN:
            case EXAM_REMOVE_COLOR:
                pageLimit = 20;
                break;
            case DOCUMENT_TEXT:
            default:
                pageLimit = 30;
                break;
        }

        GmsDocumentScannerOptions options =
                new GmsDocumentScannerOptions.Builder()
                        .setGalleryImportAllowed(true)
                        .setPageLimit(pageLimit)
                        .setResultFormats(
                                GmsDocumentScannerOptions.RESULT_FORMAT_JPEG,
                                GmsDocumentScannerOptions.RESULT_FORMAT_PDF
                        )
                        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                        .build();

        GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options);
        Toast.makeText(this, "正在打开扫描器…", Toast.LENGTH_SHORT).show();

        scanner.getStartScanIntent(this)
                .addOnSuccessListener(intentSender -> {
                    try {
                        startIntentSenderForResult(
                                intentSender,
                                DOCUMENT_SCAN_REQUEST,
                                null,
                                0,
                                0,
                                0
                        );
                    } catch (Exception error) {
                        Toast.makeText(
                                this,
                                "无法启动扫描器：" + error.getMessage(),
                                Toast.LENGTH_LONG
                        ).show();
                    }
                })
                .addOnFailureListener(error -> Toast.makeText(
                        this,
                        "扫描器不可用：" + error.getMessage(),
                        Toast.LENGTH_LONG
                ).show());
    }

    private class PaperBookWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost();

            if (host != null && host.equals("lingtingjimozdb.github.io") &&
                    uri.getPath() != null &&
                    uri.getPath().startsWith("/paperbook-cloud/")) {
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
            Uri uri = Uri.parse(url);
            if ("lingtingjimozdb.github.io".equals(uri.getHost()) &&
                    uri.getPath() != null &&
                    uri.getPath().startsWith("/paperbook-cloud/")) {
                injectMobileInterface();
            }
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
                ValueCallback<Uri[]> callback,
                FileChooserParams fileChooserParams
        ) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }

            filePathCallback = callback;
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

    private void handleDocumentScanResult(Intent data) {
        GmsDocumentScanningResult result =
                GmsDocumentScanningResult.fromActivityResultIntent(data);

        if (result == null || result.getPages() == null || result.getPages().isEmpty()) {
            Toast.makeText(this, "没有获得扫描页面", Toast.LENGTH_LONG).show();
            return;
        }

        List<Uri> imageUris = new ArrayList<>();
        for (GmsDocumentScanningResult.Page page : result.getPages()) {
            imageUris.add(page.getImageUri());
        }

        Uri pdfUri = result.getPdf() == null ? null : result.getPdf().getUri();
        String stamp = new SimpleDateFormat(
                "yyyyMMdd_HHmmss",
                Locale.CHINA
        ).format(new Date());

        switch (pendingScanMode) {
            case DOCUMENT_TEXT:
                saveOriginalScanAsync("扫描文档/" + stamp, imageUris, pdfUri);
                recognizePages(imageUris, pendingScanMode, stamp);
                break;

            case BOOK_EBOOK:
                saveOriginalScanAsync("电子书/" + stamp, imageUris, pdfUri);
                recognizePages(imageUris, pendingScanMode, stamp);
                break;

            case ID_ARCHIVE:
                saveOriginalScanAsync("证件档案/" + stamp, imageUris, pdfUri);
                recognizePages(imageUris, pendingScanMode, stamp);
                break;

            case EXAM_CLEAN:
                processExamAsync(imageUris, stamp, false);
                break;

            case EXAM_REMOVE_COLOR:
                processExamAsync(imageUris, stamp, true);
                break;

            case IMAGE_ONLY:
                saveOriginalScanAsync("扫描图片/" + stamp, imageUris, null);
                Toast.makeText(
                        this,
                        "图片已保存到 下载/PaperBook/扫描图片/" + stamp,
                        Toast.LENGTH_LONG
                ).show();
                break;
        }
    }

    private void saveOriginalScanAsync(
            String folder,
            List<Uri> imageUris,
            Uri pdfUri
    ) {
        new Thread(() -> {
            try {
                for (int i = 0; i < imageUris.size(); i++) {
                    copyUriToDownload(
                            imageUris.get(i),
                            folder,
                            String.format(Locale.CHINA, "第%03d页.jpg", i + 1),
                            "image/jpeg"
                    );
                }

                if (pdfUri != null) {
                    copyUriToDownload(
                            pdfUri,
                            folder,
                            "扫描原件.pdf",
                            "application/pdf"
                    );
                }
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(
                        this,
                        "保存扫描原件失败：" + error.getMessage(),
                        Toast.LENGTH_LONG
                ).show());
            }
        }).start();
    }

    private void recognizePages(
            List<Uri> imageUris,
            ScanMode mode,
            String stamp
    ) {
        Toast.makeText(
                this,
                "正在识别文字，共 " + imageUris.size() + " 页…",
                Toast.LENGTH_LONG
        ).show();

        StringBuilder aggregate = new StringBuilder();
        recognizePageAtIndex(imageUris, 0, aggregate, mode, stamp);
    }

    private void recognizePageAtIndex(
            List<Uri> imageUris,
            int index,
            StringBuilder aggregate,
            ScanMode mode,
            String stamp
    ) {
        if (index >= imageUris.size()) {
            onRecognitionCompleted(aggregate.toString(), mode, stamp, imageUris);
            return;
        }

        try {
            InputImage image = InputImage.fromFilePath(
                    this,
                    imageUris.get(index)
            );

            Task<Text> chineseTask = chineseRecognizer.process(image);
            Task<Text> latinTask = latinRecognizer.process(image);

            Tasks.whenAllSuccess(chineseTask, latinTask)
                    .addOnSuccessListener(results -> {
                        String chinese = ((Text) results.get(0)).getText();
                        String latin = ((Text) results.get(1)).getText();
                        String best = chooseBestOcrText(chinese, latin);

                        aggregate
                                .append("\n\n===== 第 ")
                                .append(index + 1)
                                .append(" 页 =====\n\n")
                                .append(best == null || best.trim().isEmpty()
                                        ? "（未识别到文字）"
                                        : best.trim());

                        recognizePageAtIndex(
                                imageUris,
                                index + 1,
                                aggregate,
                                mode,
                                stamp
                        );
                    })
                    .addOnFailureListener(error -> {
                        aggregate
                                .append("\n\n===== 第 ")
                                .append(index + 1)
                                .append(" 页 =====\n\n")
                                .append("（文字识别失败：")
                                .append(error.getMessage())
                                .append("）");

                        recognizePageAtIndex(
                                imageUris,
                                index + 1,
                                aggregate,
                                mode,
                                stamp
                        );
                    });
        } catch (Exception error) {
            aggregate
                    .append("\n\n===== 第 ")
                    .append(index + 1)
                    .append(" 页 =====\n\n")
                    .append("（无法读取页面：")
                    .append(error.getMessage())
                    .append("）");

            recognizePageAtIndex(
                    imageUris,
                    index + 1,
                    aggregate,
                    mode,
                    stamp
            );
        }
    }

    private String chooseBestOcrText(String chinese, String latin) {
        String c = chinese == null ? "" : chinese.trim();
        String l = latin == null ? "" : latin.trim();

        int cScore = c.replaceAll("\\s", "").length();
        int lScore = l.replaceAll("\\s", "").length();

        if (cScore == 0) return l;
        if (lScore == 0) return c;

        // 中文模型通常也包含拉丁字符；选择信息量更多的结果，避免重复。
        return cScore >= lScore ? c : l;
    }

    private void onRecognitionCompleted(
            String text,
            ScanMode mode,
            String stamp,
            List<Uri> imageUris
    ) {
        String normalizedText = text == null ? "" : text.trim();

        switch (mode) {
            case DOCUMENT_TEXT:
                saveBytesAsync(
                        "扫描文档/" + stamp,
                        "识别文字.txt",
                        normalizedText.getBytes(StandardCharsets.UTF_8),
                        "text/plain"
                );
                sendNativeScanPagesToWeb(
                        "扫描文档 " + stamp,
                        normalizedText,
                        imageUris
                );
                Toast.makeText(
                        this,
                        "设备识别完成，已进入 AI 原图恢复工作台，并保存原件。",
                        Toast.LENGTH_LONG
                ).show();
                break;

            case BOOK_EBOOK:
                createBookFilesAsync(normalizedText, stamp);
                break;

            case ID_ARCHIVE:
                saveBytesAsync(
                        "证件档案/" + stamp,
                        "证件识别信息.txt",
                        normalizedText.getBytes(StandardCharsets.UTF_8),
                        "text/plain"
                );
                Toast.makeText(
                        this,
                        "证件已保存到 下载/PaperBook/证件档案/" + stamp +
                                "。为保护隐私，识别文字未自动上传到云端笔记。",
                        Toast.LENGTH_LONG
                ).show();
                break;

            default:
                break;
        }
    }

    private void sendNativeScanPagesToWeb(
            String title,
            String aggregateText,
            List<Uri> imageUris
    ) {
        new Thread(() -> {
            String[] pageTexts = aggregateText == null
                    ? new String[0]
                    : aggregateText.split(
                            "\\s*===== 第 \\d+ 页 =====\\s*"
                    );
            for (int index = 0; index < imageUris.size(); index++) {
                try (InputStream input = getContentResolver().openInputStream(imageUris.get(index))) {
                    if (input == null) continue;
                    Bitmap original = BitmapFactory.decodeStream(input);
                    if (original == null) continue;
                    int maxSide = Math.max(original.getWidth(), original.getHeight());
                    float scale = maxSide > 1800 ? 1800f / maxSide : 1f;
                    Bitmap prepared = scale < 1f
                            ? Bitmap.createScaledBitmap(
                                    original,
                                    Math.round(original.getWidth() * scale),
                                    Math.round(original.getHeight() * scale),
                                    true
                            )
                            : original;
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    prepared.compress(Bitmap.CompressFormat.JPEG, 92, output);
                    String dataUrl = "data:image/jpeg;base64," +
                            Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
                    int textIndex = index + 1;
                    String pageText = textIndex < pageTexts.length
                            ? pageTexts[textIndex].trim()
                            : "";
                    int pageIndex = index;
                    String javascript =
                            "window.__paperbookReceiveNativeScanPage && " +
                            "window.__paperbookReceiveNativeScanPage(" +
                            JSONObject.quote(title) + "," +
                            JSONObject.quote(pageText) + "," +
                            JSONObject.quote(dataUrl) + "," +
                            pageIndex + "," +
                            imageUris.size() +
                            ");";
                    runOnUiThread(() -> webView.evaluateJavascript(javascript, null));
                    if (prepared != original) prepared.recycle();
                    original.recycle();
                } catch (Exception error) {
                    runOnUiThread(() -> Toast.makeText(
                            this,
                            "扫描页送入 AI 工作台失败：" + error.getMessage(),
                            Toast.LENGTH_LONG
                    ).show());
                }
            }
        }).start();
    }

    private void appendTextToCurrentNote(String title, String text) {
        String javascript =
                "window.__paperbookAppendScanText && " +
                "window.__paperbookAppendScanText(" +
                JSONObject.quote(title) + "," +
                JSONObject.quote(text) +
                ");";
        webView.evaluateJavascript(javascript, null);
    }

    private void createBookFilesAsync(String text, String stamp) {
        new Thread(() -> {
            try {
                String folder = "电子书/" + stamp;
                byte[] txt = text.getBytes(StandardCharsets.UTF_8);
                byte[] epub = buildTextEpub(
                        "PaperBook 扫描电子书 " + stamp,
                        text
                );

                saveBytesToDownload(
                        folder,
                        "电子书文字.txt",
                        txt,
                        "text/plain"
                );
                saveBytesToDownload(
                        folder,
                        "电子书.epub",
                        epub,
                        "application/epub+zip"
                );

                runOnUiThread(() -> new AlertDialog.Builder(this)
                        .setTitle("电子书生成完成")
                        .setMessage(
                                "已保存 PDF 原件、逐页图片、OCR 文本和 EPUB 到：\n" +
                                "下载/PaperBook/电子书/" + stamp + "\n\n" +
                                "OCR 电子书可能无法完全还原复杂排版、表格和图片位置。"
                        )
                        .setNegativeButton("关闭", null)
                        .setPositiveButton(
                                "文字加入当前笔记",
                                (dialog, which) -> appendTextToCurrentNote(
                                        "扫描电子书 " + stamp,
                                        text
                                )
                        )
                        .show());
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(
                        this,
                        "电子书生成失败：" + error.getMessage(),
                        Toast.LENGTH_LONG
                ).show());
            }
        }).start();
    }

    private byte[] buildTextEpub(String title, String text) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            byte[] mimeBytes = "application/epub+zip".getBytes(StandardCharsets.US_ASCII);
            CRC32 crc = new CRC32();
            crc.update(mimeBytes);

            ZipEntry mime = new ZipEntry("mimetype");
            mime.setMethod(ZipEntry.STORED);
            mime.setSize(mimeBytes.length);
            mime.setCompressedSize(mimeBytes.length);
            mime.setCrc(crc.getValue());
            zip.putNextEntry(mime);
            zip.write(mimeBytes);
            zip.closeEntry();

            putZipText(
                    zip,
                    "META-INF/container.xml",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
                    "<container version=\"1.0\" " +
                    "xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">" +
                    "<rootfiles><rootfile full-path=\"OEBPS/content.opf\" " +
                    "media-type=\"application/oebps-package+xml\"/>" +
                    "</rootfiles></container>"
            );

            String escapedTitle = escapeXml(title);
            String escapedBody = escapeXml(text)
                    .replace("\r\n", "\n")
                    .replace("\r", "\n")
                    .replace("\n\n", "</p><p>")
                    .replace("\n", "<br/>");

            putZipText(
                    zip,
                    "OEBPS/content.opf",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
                    "<package version=\"3.0\" unique-identifier=\"book-id\" " +
                    "xmlns=\"http://www.idpf.org/2007/opf\">" +
                    "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">" +
                    "<dc:identifier id=\"book-id\">paperbook-" + System.currentTimeMillis() +
                    "</dc:identifier><dc:title>" + escapedTitle +
                    "</dc:title><dc:language>zh-CN</dc:language></metadata>" +
                    "<manifest><item id=\"chapter\" href=\"chapter.xhtml\" " +
                    "media-type=\"application/xhtml+xml\"/>" +
                    "<item id=\"nav\" href=\"nav.xhtml\" " +
                    "media-type=\"application/xhtml+xml\" properties=\"nav\"/>" +
                    "</manifest><spine><itemref idref=\"chapter\"/></spine></package>"
            );

            putZipText(
                    zip,
                    "OEBPS/nav.xhtml",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                    "<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"zh-CN\">" +
                    "<head><title>目录</title></head><body>" +
                    "<nav epub:type=\"toc\" xmlns:epub=\"http://www.idpf.org/2007/ops\">" +
                    "<ol><li><a href=\"chapter.xhtml\">正文</a></li></ol>" +
                    "</nav></body></html>"
            );

            putZipText(
                    zip,
                    "OEBPS/chapter.xhtml",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                    "<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"zh-CN\">" +
                    "<head><meta charset=\"UTF-8\"/><title>" + escapedTitle +
                    "</title><style>body{font-family:sans-serif;line-height:1.8;" +
                    "padding:1em}h1{font-size:1.5em}p{margin:0 0 1em}</style></head>" +
                    "<body><h1>" + escapedTitle + "</h1><p>" + escapedBody +
                    "</p></body></html>"
            );
        }
        return output.toByteArray();
    }

    private void putZipText(
            ZipOutputStream zip,
            String path,
            String text
    ) throws Exception {
        zip.putNextEntry(new ZipEntry(path));
        zip.write(text.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private String escapeXml(String value) {
        if (value == null) return "";
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    private void processExamAsync(
            List<Uri> imageUris,
            String stamp,
            boolean removeColor
    ) {
        Toast.makeText(
                this,
                removeColor
                        ? "正在清理试卷并去除彩色标记…"
                        : "正在清理试卷、增强文字…",
                Toast.LENGTH_LONG
        ).show();

        new Thread(() -> {
            List<Bitmap> cleanedPages = new ArrayList<>();
            try {
                String folder = (removeColor ? "试卷去标记/" : "试卷清洁/") + stamp;

                for (int i = 0; i < imageUris.size(); i++) {
                    Bitmap source;
                    try (InputStream input =
                                 getContentResolver().openInputStream(imageUris.get(i))) {
                        source = BitmapFactory.decodeStream(input);
                    }

                    if (source == null) {
                        throw new IllegalStateException("第 " + (i + 1) + " 页无法读取");
                    }

                    Bitmap cleaned = cleanExamBitmap(source, removeColor);
                    source.recycle();
                    cleanedPages.add(cleaned);

                    ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
                    cleaned.compress(Bitmap.CompressFormat.JPEG, 94, jpeg);
                    saveBytesToDownload(
                            folder,
                            String.format(Locale.CHINA, "清洁第%03d页.jpg", i + 1),
                            jpeg.toByteArray(),
                            "image/jpeg"
                    );
                }

                byte[] pdf = buildPdf(cleanedPages);
                saveBytesToDownload(
                        folder,
                        removeColor ? "去彩色标记试卷.pdf" : "清洁试卷.pdf",
                        pdf,
                        "application/pdf"
                );

                for (Bitmap page : cleanedPages) {
                    page.recycle();
                }

                runOnUiThread(() -> new AlertDialog.Builder(this)
                        .setTitle(removeColor ? "试卷去标记完成" : "试卷清洁完成")
                        .setMessage(
                                "文件已保存到：\n下载/PaperBook/" + folder +
                                "\n\n已完成自动裁剪/纠偏后的进一步灰度增强。" +
                                (removeColor
                                        ? "\n已尝试去除彩色笔迹；黑色手写答案不能保证去除。"
                                        : "")
                        )
                        .setPositiveButton("确定", null)
                        .show());
            } catch (Exception error) {
                for (Bitmap page : cleanedPages) {
                    if (page != null && !page.isRecycled()) page.recycle();
                }

                runOnUiThread(() -> Toast.makeText(
                        this,
                        "试卷处理失败：" + error.getMessage(),
                        Toast.LENGTH_LONG
                ).show());
            }
        }).start();
    }

    private Bitmap cleanExamBitmap(Bitmap source, boolean removeColor) {
        int width = source.getWidth();
        int height = source.getHeight();
        Bitmap output = Bitmap.createBitmap(
                width,
                height,
                Bitmap.Config.ARGB_8888
        );

        int[] pixels = new int[width * height];
        source.getPixels(pixels, 0, width, 0, 0, width, height);

        for (int i = 0; i < pixels.length; i++) {
            int pixel = pixels[i];
            int r = Color.red(pixel);
            int g = Color.green(pixel);
            int b = Color.blue(pixel);

            int max = Math.max(r, Math.max(g, b));
            int min = Math.min(r, Math.min(g, b));
            int chroma = max - min;

            if (removeColor && chroma > 34 && max < 248) {
                pixels[i] = Color.WHITE;
                continue;
            }

            int gray = (int) (0.299 * r + 0.587 * g + 0.114 * b);
            int enhanced = (int) ((gray - 128) * 1.38 + 128);
            enhanced = Math.max(0, Math.min(255, enhanced));

            if (enhanced > 222) enhanced = 255;
            if (enhanced < 58) enhanced = 0;

            pixels[i] = Color.rgb(enhanced, enhanced, enhanced);
        }

        output.setPixels(pixels, 0, width, 0, 0, width, height);
        return output;
    }

    private byte[] buildPdf(List<Bitmap> pages) throws Exception {
        PdfDocument document = new PdfDocument();
        try {
            int pageNumber = 1;
            for (Bitmap bitmap : pages) {
                PdfDocument.PageInfo info =
                        new PdfDocument.PageInfo.Builder(
                                bitmap.getWidth(),
                                bitmap.getHeight(),
                                pageNumber++
                        ).create();

                PdfDocument.Page page = document.startPage(info);
                Canvas canvas = page.getCanvas();
                canvas.drawColor(Color.WHITE);
                canvas.drawBitmap(bitmap, 0, 0, null);
                document.finishPage(page);
            }

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            document.writeTo(output);
            return output.toByteArray();
        } finally {
            document.close();
        }
    }

    private void copyUriToDownload(
            Uri source,
            String folder,
            String fileName,
            String mimeType
    ) throws Exception {
        try (
                InputStream input = getContentResolver().openInputStream(source);
                OutputStream output = openDownloadOutput(folder, fileName, mimeType)
        ) {
            if (input == null) throw new IllegalStateException("无法读取扫描文件");
            if (output == null) throw new IllegalStateException("无法创建保存文件");

            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
        }
    }

    private void saveBytesAsync(
            String folder,
            String fileName,
            byte[] bytes,
            String mimeType
    ) {
        new Thread(() -> {
            try {
                saveBytesToDownload(folder, fileName, bytes, mimeType);
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(
                        this,
                        "保存文件失败：" + error.getMessage(),
                        Toast.LENGTH_LONG
                ).show());
            }
        }).start();
    }

    private void saveBytesToDownload(
            String folder,
            String fileName,
            byte[] bytes,
            String mimeType
    ) throws Exception {
        try (OutputStream output = openDownloadOutput(
                folder,
                fileName,
                mimeType
        )) {
            if (output == null) throw new IllegalStateException("无法创建保存文件");
            output.write(bytes);
        }
    }

    private OutputStream openDownloadOutput(
            String folder,
            String fileName,
            String mimeType
    ) throws Exception {
        String safeName = sanitizeFileName(fileName);
        String relativeFolder = Environment.DIRECTORY_DOWNLOADS +
                "/PaperBook/" + folder;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(
                    MediaStore.Downloads.RELATIVE_PATH,
                    relativeFolder
            );

            Uri uri = getContentResolver().insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    values
            );
            if (uri == null) {
                throw new IllegalStateException("无法创建下载文件");
            }

            return getContentResolver().openOutputStream(uri);
        }

        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("旧版安卓需要存储权限");
        }

        File directory = new File(
                Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS
                ),
                "PaperBook/" + folder
        );
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("无法创建下载目录");
        }

        return new FileOutputStream(new File(directory, safeName));
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
        public void openScanner() {
            runOnUiThread(() -> showScannerMenu());
        }

        @JavascriptInterface
        public void setScannerVisible(boolean visible) {
            runOnUiThread(() -> scannerButton.setVisibility(
                    visible ? View.VISIBLE : View.GONE
            ));
        }

        @JavascriptInterface
        public void saveDataUrl(String fileName, String dataUrl, String mimeType) {
            new Thread(() -> {
                try {
                    int comma = dataUrl.indexOf(',');
                    String encoded = comma >= 0
                            ? dataUrl.substring(comma + 1)
                            : dataUrl;
                    byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                    runOnUiThread(() -> saveDownload(
                            fileName,
                            bytes,
                            mimeType,
                            ""
                    ));
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

    private void saveDownload(
            String fileName,
            byte[] bytes,
            String mimeType,
            String folder
    ) {
        String safeName = sanitizeFileName(
                fileName == null || fileName.isEmpty()
                        ? "PaperBook_备份.json"
                        : fileName
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                saveBytesToDownload(
                        folder,
                        safeName,
                        bytes,
                        mimeType == null || mimeType.isEmpty()
                                ? "application/octet-stream"
                                : mimeType
                );
                Toast.makeText(
                        this,
                        "已保存到下载/PaperBook/" + safeName,
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
            pendingDownloadFolder = folder;
            requestPermissions(
                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    STORAGE_PERMISSION_REQUEST
            );
            return;
        }

        saveLegacyDownload(folder, safeName, bytes);
    }

    private void saveLegacyDownload(
            String folder,
            String safeName,
            byte[] bytes
    ) {
        try {
            File directory = new File(
                    Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS
                    ),
                    "PaperBook/" + folder
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
                saveLegacyDownload(
                        pendingDownloadFolder == null ? "" : pendingDownloadFolder,
                        pendingDownloadName,
                        pendingDownloadBytes
                );
            } else {
                Toast.makeText(this, "未获得保存文件权限", Toast.LENGTH_LONG).show();
            }

            pendingDownloadBytes = null;
            pendingDownloadName = null;
            pendingDownloadMime = null;
            pendingDownloadFolder = null;
        }
    }

    @Override
    protected void onActivityResult(
            int requestCode,
            int resultCode,
            Intent data
    ) {
        if (requestCode == DOCUMENT_SCAN_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                handleDocumentScanResult(data);
            }
            return;
        }

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
        chineseRecognizer.close();
        latinRecognizer.close();
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

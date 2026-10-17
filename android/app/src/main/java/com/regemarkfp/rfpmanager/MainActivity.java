package com.regemarkfp.rfpmanager;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
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
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import org.json.JSONObject;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The app's one window. The screens come from the website (so they are always up to date), and the app adds what a
 * phone can do: push notifications, the camera and files for uploads (receipts, adverts), downloads, sharing, keeping
 * the screen on while scoring or directing, vibration, Google sign-in through the browser, links that open in the app,
 * and updates of the app itself.
 */
public class MainActivity extends AppCompatActivity implements App.TokenListener {
    private static final int REQ_FILE = 11, REQ_PERMS = 12, REQ_NOTIFY = 13;
    private static final String SITE = BuildConfig.SITE;

    private WebView web;
    private SwipeRefreshLayout swipe;
    private FrameLayout root, fullscreen;
    private LinearLayout offline;
    private ProgressBar progress;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private PermissionRequest pendingWebPermission;
    private Runnable afterPermission;
    private volatile String currentHost = "";
    private long updateDownload = -1;
    private BroadcastReceiver downloadDone;

    // ---- the website's own addresses open in the app; everything else in the browser
    static boolean ours(Uri u) {
        if (u == null || u.getHost() == null) return false;
        String h = u.getHost().toLowerCase();
        String site = Uri.parse(SITE).getHost();
        return h.equals(site) || h.equals("regemarkfp.com") || h.endsWith(".regemarkfp.com");
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.parseColor("#1d1d1d"));
        getWindow().setNavigationBarColor(Color.parseColor("#1d1d1d"));

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#262626"));
        web = new WebView(this);
        swipe = new SwipeRefreshLayout(this);
        swipe.addView(web, new ViewGroup.LayoutParams(-1, -1));
        swipe.setColorSchemeColors(Color.parseColor("#00ff82"));
        swipe.setProgressBackgroundColorSchemeColor(Color.parseColor("#1d1d1d"));
        swipe.setOnRefreshListener(() -> web.reload());
        // pull to refresh only from the very top of a page that scrolls as a whole
        swipe.setOnChildScrollUpCallback((parent, child) -> web.getScrollY() > 0 || noPull);
        root.addView(swipe, new FrameLayout.LayoutParams(-1, -1));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(false);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#00ff82")));
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));

        offline = offlineView();
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));

        fullscreen = new FrameLayout(this);
        fullscreen.setBackgroundColor(Color.BLACK);
        fullscreen.setVisibility(View.GONE);
        root.addView(fullscreen, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        setUpWebView();
        App.get().addListener(this);
        PushService.onMessage = () -> js("window.RFPNotifyUI&&RFPNotifyUI.unread().then(function(n){window.rfpUnread&&rfpUnread(n)})");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (customView != null) { hideCustomView(); return; }
                if (web.canGoBack()) { web.goBack(); return; }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });

        if (saved != null) web.restoreState(saved);
        else if (!handle(getIntent())) web.loadUrl(SITE + "/app");

        askNotificationsOnce();
        checkForUpdate(false);
    }

    private volatile boolean noPull = false;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void setUpWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUserAgentString(s.getUserAgentString() + " RFPManagerAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setBackgroundColor(Color.parseColor("#262626"));
        web.addJavascriptInterface(new Bridge(), "RFPNative");

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return route(req.getUrl());
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap fav) {
                currentHost = hostOf(url);
                progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView v, String url) {
                currentHost = hostOf(url);
                swipe.setRefreshing(false);
                progress.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
                // the token may have arrived before the page was ready
                if (!App.get().token().isEmpty()) js("window.rfpPushToken&&window.rfpPushToken()");
            }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) {
                currentHost = hostOf(url);
                // screens with their own scrolling or dragging (the MCR, scoring, the player) don't pull to refresh
                noPull = url != null && (url.contains("/watch/") || url.contains("#/mcr") || url.contains("#/score") || url.contains("#/stream"));
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) { swipe.setRefreshing(false); offline.setVisibility(View.VISIBLE); }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) { progress.setProgress(p); }

            @Override public void onShowCustomView(View view, CustomViewCallback cb) {
                if (customView != null) { cb.onCustomViewHidden(); return; }
                customView = view;
                customCallback = cb;
                fullscreen.addView(view, new FrameLayout.LayoutParams(-1, -1));
                fullscreen.setVisibility(View.VISIBLE);
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
                c.hide(WindowInsetsCompat.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            @Override public void onHideCustomView() { hideCustomView(); }

            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                boolean images = false;
                for (String t : params.getAcceptTypes()) if (t == null || t.isEmpty() || t.startsWith("image")) images = true;
                boolean camera = images && getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
                boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                String[] accept = params.getAcceptTypes();
                if (camera && !granted(Manifest.permission.CAMERA)) {
                    askPermissions(new String[]{ Manifest.permission.CAMERA }, () -> chooseFile(accept, multiple, granted(Manifest.permission.CAMERA)));
                } else chooseFile(accept, multiple, camera);
                return true;
            }

            @Override public void onPermissionRequest(PermissionRequest req) {
                // the camera and microphone for pages that use them (only on the website's own pages)
                runOnUiThread(() -> {
                    if (!ours(req.getOrigin())) { req.deny(); return; }
                    List<String> need = new ArrayList<>();
                    for (String r : req.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !granted(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !granted(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
                    }
                    if (need.isEmpty()) { req.grant(req.getResources()); return; }
                    pendingWebPermission = req;
                    askPermissions(need.toArray(new String[0]), () -> {
                        PermissionRequest p = pendingWebPermission;
                        pendingWebPermission = null;
                        if (p == null) return;
                        List<String> ok = new ArrayList<>();
                        for (String r : p.getResources()) {
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && granted(Manifest.permission.CAMERA)) ok.add(r);
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && granted(Manifest.permission.RECORD_AUDIO)) ok.add(r);
                        }
                        if (ok.isEmpty()) p.deny(); else p.grant(ok.toArray(new String[0]));
                    });
                });
            }
        });

        // files the website offers (call sheets, invoices, exports) go to Downloads with the person's session
        web.setDownloadListener((url, ua, disposition, mime, length) -> {
            if (url.startsWith("blob:") || url.startsWith("data:")) { Toast.makeText(this, "That file can only be saved from a computer", Toast.LENGTH_LONG).show(); return; }
            try {
                String name = URLUtil.guessFileName(url, disposition, mime);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url))
                    .setMimeType(mime)
                    .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                    .addRequestHeader("User-Agent", ua)
                    .setTitle(name)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                openExternal(Uri.parse(url));
            }
        });
    }

    // ---- links: ours in the app, others in a browser tab, apps (mail, phone, WhatsApp) in their apps
    private boolean route(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if ("rfpmanager".equals(scheme)) { handle(new Intent(Intent.ACTION_VIEW, u)); return true; }
        if (scheme.equals("http") || scheme.equals("https")) {
            if (ours(u) && !u.getPath().startsWith("/api/auth/app-start")) return false;
            openTab(u);
            return true;
        }
        openExternal(u);
        return true;
    }

    /** A link, a notification or the browser after Google sign-in. Returns true when it loaded something. */
    private boolean handle(Intent i) {
        if (i == null || i.getData() == null) return false;
        Uri u = i.getData();
        if ("rfpmanager".equals(u.getScheme()) && "signin".equals(u.getHost())) {
            String code = u.getQueryParameter("code"), next = u.getQueryParameter("next");
            if (code == null) return false;
            web.loadUrl(SITE + "/api/auth/app-claim?code=" + Uri.encode(code) + "&next=" + Uri.encode(next == null ? "/app" : next));
            return true;
        }
        if (ours(u) && "https".equals(u.getScheme())) { offline.setVisibility(View.GONE); web.loadUrl(u.toString()); return true; }
        return false;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        handle(i);
    }

    private void openTab(Uri u) {
        try {
            new CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder().setToolbarColor(Color.parseColor("#1d1d1d")).build())
                .setShowTitle(true)
                .build()
                .launchUrl(this, u);
        } catch (ActivityNotFoundException e) { openExternal(u); }
    }

    private void openExternal(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "No app on this phone opens that link", Toast.LENGTH_SHORT).show(); }
    }

    // ---- the file chooser: files, or a new photo from the camera
    private void chooseFile(String[] accept, boolean multiple, boolean camera) {
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE);
        List<String> types = new ArrayList<>();
        for (String t : accept) if (t != null && !t.trim().isEmpty()) for (String x : t.split(",")) types.add(mimeOf(x.trim()));
        if (types.size() == 1) pick.setType(types.get(0));
        else { pick.setType("*/*"); if (!types.isEmpty()) pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0])); }
        if (multiple) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        Intent chooser = Intent.createChooser(pick, "Choose a file");
        cameraUri = null;
        if (camera) {
            try {
                File dir = new File(getCacheDir(), "camera");
                if (!dir.exists()) dir.mkdirs();
                File f = File.createTempFile("photo", ".jpg", dir);
                cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
                Intent shoot = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{ shoot });
            } catch (Exception e) { cameraUri = null; }
        }
        try { startActivityForResult(chooser, REQ_FILE); }
        catch (ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback = null; }
    }

    private static String mimeOf(String t) {
        if (t.contains("/")) return t;
        String ext = t.startsWith(".") ? t.substring(1) : t;
        String m = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
        return m == null ? "*/*" : m;
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_FILE || fileCallback == null) return;
        Uri[] out = null;
        if (result == Activity.RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                out = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < out.length; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) out = new Uri[]{ data.getData() };
            else if (cameraUri != null) out = new Uri[]{ cameraUri };
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
    }

    // ---- permissions
    private boolean granted(String p) { return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED; }

    private void askPermissions(String[] perms, Runnable then) {
        afterPermission = then;
        requestPermissions(perms, REQ_PERMS);
    }

    private void askNotificationsOnce() {
        if (Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS)) return;
        if (App.get().prefs().getBoolean("askedNotify", false)) return;
        App.get().prefs().edit().putBoolean("askedNotify", true).apply();
        requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
    }

    @Override
    public void onRequestPermissionsResult(int req, @NonNull String[] perms, @NonNull int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == REQ_PERMS && afterPermission != null) { Runnable r = afterPermission; afterPermission = null; r.run(); }
        if (req == REQ_NOTIFY && !App.get().token().isEmpty()) js("window.rfpPushToken&&window.rfpPushToken()");
    }

    // ---- the push token reached the app: the page registers it for whoever is signed in
    @Override
    public void onToken(String token) { js("window.rfpPushToken&&window.rfpPushToken()"); }

    private void js(String code) { runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); }); }

    // ---- what the website can ask of the phone (window.RFPNative)
    private class Bridge {
        private boolean allowed() {
            String h = currentHost;
            return h.equals(Uri.parse(SITE).getHost()) || h.equals("regemarkfp.com") || h.endsWith(".regemarkfp.com");
        }
        @JavascriptInterface public String pushToken() { return allowed() ? App.get().token() : ""; }
        @JavascriptInterface public String deviceName() {
            String m = Build.MODEL == null ? "Android" : Build.MODEL;
            String b = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
            return (m.toLowerCase().startsWith(b.toLowerCase()) ? m : cap(b) + " " + m).trim();
        }
        @JavascriptInterface public String appVersion() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public boolean notificationsAllowed() {
            return androidx.core.app.NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
        }
        @JavascriptInterface public void askPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
                    if (shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) || !App.get().prefs().getBoolean("askedNotify", false)) {
                        App.get().prefs().edit().putBoolean("askedNotify", true).apply();
                        requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
                        return;
                    }
                }
                if (!notificationsAllowed()) notificationSettings();
            });
        }
        @JavascriptInterface public void openNotificationSettings() { runOnUiThread(MainActivity.this::notificationSettings); }
        @JavascriptInterface public void signInWithGoogle(String next) {
            if (!allowed()) return;
            String n = next == null || !next.startsWith("/") ? "/app" : next;
            runOnUiThread(() -> openTab(Uri.parse(SITE + "/api/auth/app-start?next=" + Uri.encode(n))));
        }
        @JavascriptInterface public void share(String title, String text, String url) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, title == null ? "" : title)
                    .putExtra(Intent.EXTRA_TEXT, ((text == null || text.isEmpty()) ? "" : text + " ") + (url == null ? "" : url));
                startActivity(Intent.createChooser(i, "Share"));
            });
        }
        @JavascriptInterface public void keepAwake(boolean on) {
            runOnUiThread(() -> { if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
        }
        @JavascriptInterface public void vibrate(int ms) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null) return;
            int t = Math.max(10, Math.min(ms, 1000));
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(t, VibrationEffect.DEFAULT_AMPLITUDE)); else v.vibrate(t);
        }
        @JavascriptInterface public void openExternal(String url) {
            if (url == null) return;
            runOnUiThread(() -> openTab(Uri.parse(url)));
        }
        @JavascriptInterface public void checkForUpdate() { MainActivity.this.checkForUpdate(true); }
    }

    private static String cap(String s) { return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1); }

    private void notificationSettings() {
        Intent i = Build.VERSION.SDK_INT >= 26
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        try { startActivity(i); } catch (ActivityNotFoundException ignored) { }
    }

    // ---- fullscreen video
    private void hideCustomView() {
        if (customView == null) return;
        fullscreen.removeView(customView);
        fullscreen.setVisibility(View.GONE);
        customView = null;
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
        WindowCompat.getInsetsController(getWindow(), root).show(WindowInsetsCompat.Type.systemBars());
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // ---- no connection
    private LinearLayout offlineView() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(Color.parseColor("#262626"));
        l.setPadding(dp(32), dp(32), dp(32), dp(32));
        TextView t = new TextView(this);
        t.setText("No connection");
        t.setTextColor(Color.WHITE);
        t.setTextSize(22);
        t.setGravity(Gravity.CENTER);
        TextView s = new TextView(this);
        s.setText("RFP Manager can't reach the website. Check your Wi-Fi or mobile data and try again.");
        s.setTextColor(Color.parseColor("#bbbbbb"));
        s.setTextSize(15);
        s.setGravity(Gravity.CENTER);
        s.setPadding(0, dp(10), 0, dp(20));
        Button b = new Button(this);
        b.setText("Try again");
        b.setTextColor(Color.BLACK);
        b.setBackgroundColor(Color.parseColor("#00ff82"));
        b.setOnClickListener(v -> {
            offline.setVisibility(View.GONE);
            String u = web.getUrl();
            if (u == null || u.startsWith("about:") || u.startsWith("data:")) web.loadUrl(SITE + "/app"); else web.reload();
        });
        l.addView(t);
        l.addView(s);
        l.addView(b, new LinearLayout.LayoutParams(-2, -2));
        return l;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    // ---- updates of the app itself (from the website: /app/rfp-manager.json and .apk, built by GitHub)
    private void checkForUpdate(boolean byHand) {
        long last = App.get().prefs().getLong("updateCheck", 0);
        if (!byHand && System.currentTimeMillis() - last < 12 * 3600e3) return;
        App.get().prefs().edit().putLong("updateCheck", System.currentTimeMillis()).apply();
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(SITE + "/app/rfp-manager.json?t=" + System.currentTimeMillis()).openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(10000);
                if (c.getResponseCode() != 200) return;
                JSONObject j = new JSONObject(App.read(c.getInputStream()));
                int code = j.optInt("versionCode", 0);
                String name = j.optString("versionName", "");
                if (code <= BuildConfig.VERSION_CODE) {
                    if (byHand) runOnUiThread(() -> Toast.makeText(this, "RFP Manager is up to date (" + BuildConfig.VERSION_NAME + ")", Toast.LENGTH_SHORT).show());
                    return;
                }
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    new AlertDialog.Builder(this)
                        .setTitle("Update RFP Manager")
                        .setMessage("Version " + name + " is ready (you have " + BuildConfig.VERSION_NAME + ").")
                        .setPositiveButton("Update", (d, w) -> downloadUpdate(name))
                        .setNegativeButton("Later", null)
                        .show();
                });
            } catch (Exception e) {
                Log.w(App.TAG, "Update check: " + e.getMessage());
            }
        }, "rfp-update").start();
    }

    private void downloadUpdate(String name) {
        File dir = getExternalFilesDir("updates");
        if (dir == null) { openExternal(Uri.parse(SITE + "/app/rfp-manager.apk")); return; }
        File f = new File(dir, "rfp-manager.apk");
        if (f.exists()) f.delete();
        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        DownloadManager.Request r = new DownloadManager.Request(Uri.parse(SITE + "/app/rfp-manager.apk?v=" + Uri.encode(name)))
            .setTitle("RFP Manager " + name)
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(this, "updates", "rfp-manager.apk");
        updateDownload = dm.enqueue(r);
        Toast.makeText(this, "Downloading the update…", Toast.LENGTH_SHORT).show();
        if (downloadDone == null) {
            downloadDone = new BroadcastReceiver() {
                @Override public void onReceive(Context ctx, Intent i) {
                    if (i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -2) != updateDownload) return;
                    install(f);
                }
            };
            ContextCompat.registerReceiver(this, downloadDone, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED);
        }
    }

    private void install(File f) {
        if (!f.exists()) { Toast.makeText(this, "The update didn't download. Try again later.", Toast.LENGTH_LONG).show(); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(this, "Allow RFP Manager to install updates, then tap Update again", Toast.LENGTH_LONG).show();
            try { startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); } catch (ActivityNotFoundException ignored) { }
            App.get().prefs().edit().putLong("updateCheck", 0).apply();
            return;
        }
        Uri u = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); } catch (ActivityNotFoundException e) { openExternal(Uri.parse(SITE + "/app/rfp-manager.apk")); }
    }

    private static String hostOf(String url) {
        try { String h = Uri.parse(url).getHost(); return h == null ? "" : h.toLowerCase(); } catch (Exception e) { return ""; }
    }

    // ---- life cycle
    @Override protected void onSaveInstanceState(@NonNull Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onResume() { super.onResume(); web.onResume(); PushService.onMessage = () -> js("window.RFPNotifyUI&&RFPNotifyUI.unread().then(function(n){window.rfpUnread&&rfpUnread(n)})"); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onDestroy() {
        App.get().removeListener(this);
        PushService.onMessage = null;
        if (downloadDone != null) try { unregisterReceiver(downloadDone); } catch (Exception ignored) { }
        web.destroy();
        super.onDestroy();
    }
}

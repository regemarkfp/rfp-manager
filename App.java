package com.regemarkfp.rfpmanager;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * The app: notification channels (one per kind, so each can be tuned in Android's settings too) and Firebase.
 * Firebase is set up from the website (/api/push/android-config), so the app needs no google-services.json
 * built in: the site admin uploads it once in Settings → Server → Push notifications.
 */
public class App extends Application {
    static final String TAG = "RFPManager";
    static final String PREFS = "rfp";

    public interface TokenListener { void onToken(String token); }

    private static App self;
    private final List<TokenListener> listeners = new ArrayList<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean firebaseReady = false;

    public static App get() { return self; }

    @Override
    public void onCreate() {
        super.onCreate();
        self = this;
        channels();
        // what the website told us last time: Firebase starts straight away; then check for changes
        String cached = prefs().getString("firebase", null);
        if (cached != null) startFirebase(cached);
        new Thread(this::fetchConfig, "rfp-config").start();
    }

    SharedPreferences prefs() { return getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    // ---- notification channels
    private void channels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        String[][] list = {
            { "streams", "Streams", "Going live, ending, dropped signals and restreams", "high" },
            { "crew", "Crew & bookings", "Productions, call sheets, hiring, reminders, bookings and expenses", "high" },
            { "matches", "Matches", "Key moments and results from matches you follow", "high" },
            { "chat", "Chat & sales", "Live chat messages and tickets or passes sold", "default" },
        };
        for (String[] c : list) {
            NotificationChannel ch = new NotificationChannel(c[0], c[1], "high".equals(c[3]) ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(c[2]);
            ch.enableVibration(true);
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), aa);
            ch.setLightColor(0xff00ff82);
            ch.enableLights(true);
            nm.createNotificationChannel(ch);
        }
    }

    // ---- Firebase, from the website's settings
    private void fetchConfig() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.SITE + "/api/push/android-config").openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            if (c.getResponseCode() != 200) return;
            String body = read(c.getInputStream());
            JSONObject j = new JSONObject(body);
            if (j.optString("appId").isEmpty() || j.optString("apiKey").isEmpty()) return;
            String old = prefs().getString("firebase", null);
            if (body.equals(old)) return;
            prefs().edit().putString("firebase", body).apply();
            if (!firebaseReady) main.post(() -> startFirebase(body));
            // a changed project only takes effect after a restart of the app (Firebase starts once per process)
        } catch (Exception e) {
            Log.w(TAG, "Push settings: " + e.getMessage());
        }
    }

    private void startFirebase(String json) {
        if (firebaseReady) return;
        try {
            JSONObject j = new JSONObject(json);
            FirebaseOptions.Builder b = new FirebaseOptions.Builder()
                .setApiKey(j.getString("apiKey"))
                .setApplicationId(j.getString("appId"))
                .setProjectId(j.optString("projectId"));
            if (!j.optString("senderId").isEmpty()) b.setGcmSenderId(j.optString("senderId"));
            if (!j.optString("storageBucket").isEmpty()) b.setStorageBucket(j.optString("storageBucket"));
            if (FirebaseApp.getApps(this).isEmpty()) FirebaseApp.initializeApp(this, b.build());
            firebaseReady = true;
            FirebaseMessaging fm = FirebaseMessaging.getInstance();
            fm.setAutoInitEnabled(true);
            fm.getToken().addOnCompleteListener(t -> {
                if (t.isSuccessful() && t.getResult() != null) setToken(t.getResult());
                else Log.w(TAG, "No push token: " + (t.getException() != null ? t.getException().getMessage() : "?"));
            });
        } catch (Exception e) {
            Log.w(TAG, "Firebase: " + e.getMessage());
        }
    }

    // ---- the push token, for the website to register with the signed-in person
    public String token() { return prefs().getString("token", ""); }

    void setToken(String token) {
        prefs().edit().putString("token", token).apply();
        main.post(() -> { for (TokenListener l : new ArrayList<>(listeners)) l.onToken(token); });
    }

    void addListener(TokenListener l) { listeners.add(l); }
    void removeListener(TokenListener l) { listeners.remove(l); }

    static String read(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }
}

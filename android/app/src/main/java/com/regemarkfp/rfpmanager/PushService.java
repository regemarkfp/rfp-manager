package com.regemarkfp.rfpmanager;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Push notifications from the website (FCM data messages: title, body, url, kind, channel, tag).
 * Each one is shown in its channel; tapping it opens that page in the app.
 */
public class PushService extends FirebaseMessagingService {
    static Runnable onMessage;          // the open screen refreshes its unread count

    @Override
    public void onNewToken(@NonNull String token) {
        App.get().setToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        String title = d.get("title"), body = d.get("body"), url = d.get("url"), channel = d.get("channel"), tag = d.get("tag");
        if (title == null && msg.getNotification() != null) { title = msg.getNotification().getTitle(); body = msg.getNotification().getBody(); }
        if (title == null || title.isEmpty()) return;
        if (channel == null || !channel.matches("streams|crew|matches|chat")) channel = "streams";

        Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (url != null && !url.isEmpty()) open.setData(Uri.parse(url));
        open.putExtra("fromPush", true);
        int id = (tag != null && !tag.isEmpty() ? tag : title + System.currentTimeMillis()).hashCode();
        PendingIntent pi = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder n = new NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(0xff00ff82)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setGroup(channel)
            .setPriority("chat".equals(channel) ? NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_HIGH)
            .setCategory("chat".equals(channel) ? NotificationCompat.CATEGORY_MESSAGE : NotificationCompat.CATEGORY_EVENT);

        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        try { NotificationManagerCompat.from(this).notify(id, n.build()); } catch (SecurityException ignored) { }
        Runnable r = onMessage;
        if (r != null) new android.os.Handler(android.os.Looper.getMainLooper()).post(r);
    }
}

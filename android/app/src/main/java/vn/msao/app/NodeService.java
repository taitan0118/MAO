package vn.msao.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.AssetManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;

/** Chế độ "máy chính": chạy máy chủ MSAO (Node.js nhúng) trong dịch vụ chạy nền, giữ WiFi và CPU thức. */
public class NodeService extends Service {
    static { System.loadLibrary("node"); System.loadLibrary("native-lib"); }
    public static native int startNode(String[] args);

    static volatile boolean started; // Node chỉ khởi động được một lần trong mỗi tiến trình
    static final String CHANNEL = "may-chu";
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    static void start(Context c) {
        Intent i = new Intent(c, NodeService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Máy chủ MSAO", NotificationManager.IMPORTANCE_LOW));
            b = new Notification.Builder(this, CHANNEL);
        } else b = new Notification.Builder(this);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = b.setSmallIcon(R.drawable.ic_stat).setContentTitle("MSAO đang chạy")
                .setContentText("Khách vẫn gọi món được. Đừng tắt app này.").setContentIntent(open).setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);

        if (wake == null) {
            wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "msao:may-chu");
            wake.acquire();
            wifi = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "msao:may-chu");
            wifi.acquire();
        }
        if (!started) {
            started = true;
            new Thread(null, this::runNode, "node", 8 * 1024 * 1024).start();
        }
        return START_STICKY;
    }

    private void runNode() {
        try {
            File project = new File(getFilesDir(), "nodejs-project");
            copyProjectIfUpdated(project);
            // ponytail: chờ tối đa 60 giây cho có WiFi lúc vừa bật máy; đổi mạng sau đó thì mở lại app để cập nhật địa chỉ QR
            String ip = "";
            for (int i = 0; i < 60 && ip.isEmpty(); i++) { ip = lanIp(this); if (ip.isEmpty()) Thread.sleep(1000); }
            File data = new File(getExternalFilesDir(null), "data");
            startNode(new String[]{"node", new File(project, "android-main.js").getAbsolutePath(), data.getAbsolutePath(), ip});
        } catch (Exception e) {
            Log.e("MSAO", "Không chạy được máy chủ", e);
        }
    }

    /** Địa chỉ IPv4 của máy trong mạng quán (WiFi hoặc dây mạng). */
    static String lanIp(Context c) {
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(CONNECTIVITY_SERVICE);
        Network net = cm.getActiveNetwork();
        LinkProperties lp = net == null ? null : cm.getLinkProperties(net);
        if (lp != null) for (LinkAddress a : lp.getLinkAddresses())
            if (a.getAddress() instanceof Inet4Address && !a.getAddress().isLoopbackAddress()) return a.getAddress().getHostAddress();
        return "";
    }

    /** Chép mã máy chủ từ assets ra bộ nhớ app, chỉ khi app vừa cài hoặc vừa cập nhật. */
    private void copyProjectIfUpdated(File project) throws Exception {
        long stamp = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
        SharedPreferences p = getSharedPreferences("msao", MODE_PRIVATE);
        if (project.exists() && p.getLong("projectStamp", 0) == stamp) return;
        deleteAll(project);
        copyAsset(getAssets(), "nodejs-project", project);
        p.edit().putLong("projectStamp", stamp).apply();
    }

    private static void copyAsset(AssetManager am, String path, File to) throws Exception {
        String[] kids = am.list(path);
        if (kids != null && kids.length > 0) {
            to.mkdirs();
            for (String k : kids) copyAsset(am, path + "/" + k, new File(to, k));
            return;
        }
        try (InputStream in = am.open(path); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    private static void deleteAll(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteAll(k);
        f.delete();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}

package vn.msao.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Một app, hai chế độ:
 *  - "server": máy này là máy chủ của quán (máy POS Android), chạy MAO bên trong và mở màn hình máy quầy.
 *  - "client": kết nối tới máy chủ có sẵn trong quán (máy tính hoặc POS khác), dùng cho chủ quán, nhân viên, máy quầy.
 * Giao diện là trang web của MAO; trang gọi window.msaoDesktop để in, báo đơn mới, lưu file Excel.
 */
public class MainActivity extends Activity {
    static final String LOCAL = "http://127.0.0.1:3000";
    private static final int PICK_FILE = 1;
    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCb;
    private boolean visible;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("msao", MODE_PRIVATE);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // tiếng chuông khi có đơn
        s.setAllowFileAccess(false);
        web.addJavascriptInterface(new Bridge(), "msaoDesktop");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) v.loadUrl("file:///android_asset/chon.html?loi=" + Uri.encode(base()));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try { startActivityForResult(p.createIntent(), PICK_FILE); }
                catch (Exception e) { fileCb = null; return false; }
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 0);
        route(prefs.getString("page", "/nhanvien"));
    }

    private String mode() { return prefs.getString("mode", ""); }
    private String base() { return "server".equals(mode()) ? LOCAL : prefs.getString("url", ""); }

    /** Mở đúng màn hình theo chế độ đã chọn; chưa chọn thì hiện trang chọn chế độ. */
    private void route(String page) {
        prefs.edit().putString("page", page).apply();
        if (mode().isEmpty()) { web.loadUrl("file:///android_asset/chon.html"); return; }
        if (!"server".equals(mode())) { web.loadUrl(base() + page); return; }
        NodeService.start(this);
        web.loadUrl("file:///android_asset/chon.html?dang-mo=1");
        new Thread(() -> { // chờ máy chủ khởi động xong (lần đầu mất vài giây)
            for (int i = 0; i < 90; i++) {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(LOCAL + "/").openConnection();
                    c.setConnectTimeout(1000); c.setReadTimeout(1000);
                    if (c.getResponseCode() == 200) { runOnUiThread(() -> web.loadUrl(LOCAL + page)); return; }
                } catch (Exception ignored) {}
                try { Thread.sleep(1000); } catch (InterruptedException e) { return; }
            }
            runOnUiThread(() -> web.loadUrl("file:///android_asset/chon.html?loi=may-chu"));
        }).start();
    }

    @Override public boolean onCreateOptionsMenu(Menu m) {
        m.add(0, 1, 0, "Máy quầy"); m.add(0, 2, 0, "Chủ quán");
        m.add(0, 3, 0, "Địa chỉ cho máy khác"); m.add(0, 4, 0, "Đổi chế độ / máy chủ");
        return true;
    }

    @Override public boolean onPrepareOptionsMenu(Menu m) {
        m.findItem(3).setVisible("server".equals(mode()));
        return true;
    }

    @Override public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case 1: route("/nhanvien"); return true;
            case 2: route("/chuquan"); return true;
            case 3:
                String u = "http://" + NodeService.lanIp(this) + ":3000";
                new AlertDialog.Builder(this).setTitle("Địa chỉ cho máy khác")
                        .setMessage("Máy khác phải bắt cùng WiFi với máy này.\n\nMáy quầy: " + u + "/nhanvien\nChủ quán: " + u + "/chuquan")
                        .setPositiveButton("Đóng", null).show();
                return true;
            case 4: changeMode(); return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void changeMode() {
        if (!"server".equals(mode())) { prefs.edit().remove("mode").apply(); route("/nhanvien"); return; }
        new AlertDialog.Builder(this).setTitle("Tắt máy chủ trên máy này?")
                .setMessage("Khách sẽ không gọi món được cho tới khi bật lại. Dữ liệu vẫn được giữ trên máy. Sau khi tắt, mở lại MAO để chọn chế độ.")
                .setNegativeButton("Không", null)
                .setPositiveButton("Tắt máy chủ", (d, w) -> {
                    prefs.edit().remove("mode").apply();
                    stopService(new Intent(this, NodeService.class));
                    finishAffinity();
                    android.os.Process.killProcess(android.os.Process.myPid()); // Node không dừng được giữa chừng
                }).show();
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
        } else super.onActivityResult(req, res, data);
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true); // không thoát hẳn: máy chủ vẫn chạy
    }

    @Override protected void onResume() { super.onResume(); visible = true; }
    @Override protected void onPause() { super.onPause(); visible = false; }

    /** Các hàm trang web gọi qua window.msaoDesktop. */
    class Bridge {
        @JavascriptInterface public void printReceipt() {
            // ponytail: in qua hệ thống in của Android (máy POS có dịch vụ in sẵn sẽ hiện trong danh sách);
            // máy POS chỉ có SDK riêng của hãng thì cần thêm cầu nối riêng cho hãng đó
            runOnUiThread(() -> ((PrintManager) getSystemService(PRINT_SERVICE))
                    .print("MAO hóa đơn", web.createPrintDocumentAdapter("MAO hóa đơn"), new PrintAttributes.Builder().build()));
        }

        @JavascriptInterface public void notify(String msg) {
            if (visible) return;
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new NotificationChannel("don-moi", "Đơn mới, gọi thanh toán", NotificationManager.IMPORTANCE_HIGH));
                b = new Notification.Builder(MainActivity.this, "don-moi");
            } else b = new Notification.Builder(MainActivity.this).setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
            PendingIntent open = PendingIntent.getActivity(MainActivity.this, 0,
                    new Intent(MainActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
            nm.notify((int) (System.currentTimeMillis() % 100000), b.setSmallIcon(R.drawable.ic_stat).setContentTitle("MAO")
                    .setContentText(msg).setContentIntent(open).setAutoCancel(true).build());
        }

        @JavascriptInterface public void saveFile(String name, String base64) {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String where;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) { out.write(bytes); }
                    where = "thư mục Tải xuống (Download)";
                } else {
                    File f = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), safe);
                    try (OutputStream out = new FileOutputStream(f)) { out.write(bytes); }
                    where = f.getParent();
                }
                toast("Đã lưu " + safe + " vào " + where);
            } catch (Exception e) {
                toast("Không lưu được file: " + e.getMessage());
            }
        }

        @JavascriptInterface public void chooseServer() {
            prefs.edit().putString("mode", "server").apply();
            runOnUiThread(() -> route("/nhanvien"));
        }

        @JavascriptInterface public void connect(String address, String page) {
            String a = address.trim().replaceAll("/+$", "");
            if (!a.matches("(?i)^https?://.*")) a = "http://" + a;
            if (!a.matches(".*:\\d+$")) a = a + ":3000";
            prefs.edit().putString("mode", "client").putString("url", a).apply();
            String target = "/chuquan".equals(page) ? "/chuquan" : "/nhanvien";
            runOnUiThread(() -> route(target));
        }

        @JavascriptInterface public void retry() { runOnUiThread(() -> route(prefs.getString("page", "/nhanvien"))); }
        @JavascriptInterface public void reset() { runOnUiThread(MainActivity.this::changeMode); }
        @JavascriptInterface public String savedAddress() { return prefs.getString("url", ""); }
    }

    private void toast(String s) { runOnUiThread(() -> Toast.makeText(this, s, Toast.LENGTH_LONG).show()); }
}

package vn.mao.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Máy POS làm máy chủ: bật máy là MAO tự chạy, khách quét QR gọi món được ngay. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())
                && "server".equals(c.getSharedPreferences("mao", Context.MODE_PRIVATE).getString("mode", "")))
            NodeService.start(c);
    }
}

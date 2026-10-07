// MAO bản ứng dụng desktop (Windows): chạy máy chủ ngay trong app, mở cửa sổ máy quầy / chủ quán,
// thu nhỏ xuống khay khi bấm X để khách vẫn gọi món được, in hóa đơn thẳng ra máy in đã chọn.
'use strict';
const { app, BrowserWindow, Menu, Tray, Notification, dialog, shell, ipcMain, clipboard, nativeImage } = require('electron');
const path = require('path'), fs = require('fs');

if (!app.requestSingleInstanceLock()) { app.quit(); return; } // mở lần hai: chỉ đưa cửa sổ đang chạy lên

// Dữ liệu để ở Documents\MAO\data: dễ tìm để chép sao lưu, gỡ app không mất
process.env.DATA_DIR = process.env.DATA_DIR || path.join(app.getPath('documents'), 'MAO', 'data');
const MAC = process.platform === 'darwin';
const ICON = path.join(__dirname, MAC ? 'icon.png' : 'icon.ico'); // Mac không đọc được .ico
const GUIDE = app.isPackaged ? path.join(process.resourcesPath, 'HUONG-DAN.pdf') : path.join(__dirname, '..', 'HUONG-DAN.pdf');
const CFG_FILE = path.join(app.getPath('userData'), 'msao-desktop.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch {}
const saveCfg = () => { fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg)); };

let srv, win, tray, quitting = false, hintShown = false, printers = [];
const base = () => 'http://127.0.0.1:' + srv.PORT; // 127.0.0.1 = "trên máy chủ": được tạo tài khoản quán, lấy lại mật khẩu
const open = p => { win.loadURL(base() + p); show(); };
function show() { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function quit() {
  const r = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Tắt MAO', 'Không tắt'], defaultId: 1, cancelId: 1, title: 'MAO',
    message: 'Tắt MAO?', detail: 'Khi tắt, khách quét mã QR sẽ không gọi món được và nhân viên không nhận được đơn. Dữ liệu đã được lưu.' });
  if (r === 0) { quitting = true; app.quit(); }
}

function phoneInfo() {
  const u = srv.lanUrl();
  const r = dialog.showMessageBoxSync(win, { type: 'info', buttons: ['Chép địa chỉ chủ quán', 'Đóng'], title: 'Địa chỉ cho máy khác',
    message: 'Mở trên điện thoại hoặc máy tính khác (phải bắt WiFi quán)',
    detail: 'Máy quầy:  ' + u + '/nhanvien\nChủ quán:  ' + u + '/chuquan\n\nNhân viên phục vụ không cần địa chỉ này: quét mã vào ca ở mục Tài khoản.' });
  if (r === 0) clipboard.writeText(u + '/chuquan');
}

function buildMenu() {
  const pick = name => { cfg.printer = name; saveCfg(); buildMenu(); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(MAC ? [{ role: 'appMenu' }, { role: 'editMenu', label: 'Sửa' }] : []), // Mac: menu tên app, và Cmd+C/V cần menu Sửa
    { label: 'Màn hình', submenu: [
      { label: 'Máy quầy', accelerator: 'Ctrl+1', click: () => open('/nhanvien') },
      { label: 'Chủ quán', accelerator: 'Ctrl+2', click: () => open('/chuquan') },
      { type: 'separator' },
      { label: 'Tải lại', role: 'reload' }, { label: 'Chữ to hơn', role: 'zoomIn' }, { label: 'Chữ nhỏ hơn', role: 'zoomOut' },
      { label: 'Cỡ chữ mặc định', role: 'resetZoom' }, { label: 'Toàn màn hình', role: 'togglefullscreen' },
      { type: 'separator' }, { label: 'Thoát MAO', click: quit }] },
    { label: 'Máy in hóa đơn', submenu: [
      { label: 'Hỏi mỗi lần in (hiện hộp thoại)', type: 'radio', checked: !cfg.printer, click: () => pick('') },
      ...printers.map(p => ({ label: p.displayName || p.name, type: 'radio', checked: cfg.printer === p.name, click: () => pick(p.name) })),
      { type: 'separator' }, { label: 'Làm mới danh sách máy in', click: loadPrinters }] },
    { label: 'Dữ liệu', submenu: [
      { label: 'Mở thư mục dữ liệu', click: () => shell.openPath(srv.DATA) },
      { label: 'Mở thư mục sao lưu', click: () => shell.openPath(path.join(srv.DATA, 'saoluu')) }] },
    { label: 'Trợ giúp', submenu: [
      { label: 'Hướng dẫn sử dụng (PDF)', click: () => shell.openPath(GUIDE) },
      { label: 'Địa chỉ cho điện thoại, máy khác', click: phoneInfo },
      { label: 'Tự chạy khi bật máy', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
        click: m => app.setLoginItemSettings({ openAtLogin: m.checked }) },
      { label: 'Giới thiệu MAO', click: () => dialog.showMessageBox(win, { title: 'MAO', message: 'MAO · Missing App Order',
        detail: 'Phiên bản ' + app.getVersion() + '\nPhần mềm gọi món bằng mã QR.\nDữ liệu: ' + srv.DATA }) }] }]));
}
async function loadPrinters() { try { printers = await win.webContents.getPrintersAsync(); } catch { printers = []; } buildMenu(); }

// In hóa đơn: đã chọn máy in thì in thẳng, chưa chọn (hoặc máy in đã bị gỡ) thì hiện hộp thoại in
// ponytail: khổ giấy lấy theo @page 58mm trong trang và cài đặt driver; cần chỉnh lề thì sửa ở driver máy in
ipcMain.handle('print-receipt', e => new Promise(done => {
  const dev = printers.some(p => p.name === cfg.printer) ? cfg.printer : '';
  e.sender.print({ silent: !!dev, deviceName: dev || undefined, printBackground: true, margins: { marginType: 'none' } },
    (ok, why) => { if (!ok && why && why !== 'cancelled') dialog.showErrorBox('Không in được', 'Máy in báo: ' + why + '\nKiểm tra máy in đã bật và còn giấy.'); done(ok); });
}));
ipcMain.on('notify', (_e, msg) => {
  if (win.isVisible() && win.isFocused() || !Notification.isSupported()) return;
  const n = new Notification({ title: 'MAO', body: String(msg).slice(0, 200), icon: ICON });
  n.on('click', show); n.show();
});

app.on('second-instance', () => win && show());
app.on('activate', () => win && show()); // Mac: bấm biểu tượng trên Dock
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {}); // không tự thoát: máy chủ phải chạy tiếp

app.whenReady().then(() => {
  app.setAppUserModelId('vn.msao.app'); // để thông báo Windows hiện tên MAO
  try { srv = require('../server.js'); } catch (e) {
    dialog.showErrorBox('MAO không mở được dữ liệu', String(e && e.message) + '\n\nThư mục dữ liệu: ' + process.env.DATA_DIR);
    return app.exit(1);
  }
  srv.server.on('error', e => {
    dialog.showErrorBox('MAO không chạy được', e.code === 'EADDRINUSE'
      ? 'Cổng ' + srv.PORT + ' đang bị chiếm, có thể MAO bản cũ (cửa sổ đen) đang chạy. Tắt nó rồi mở lại MAO.'
      : String(e.message));
    app.exit(1);
  });
  srv.server.listen(srv.PORT, '0.0.0.0', () => {
    if (cfg.autostart === undefined) { app.setLoginItemSettings({ openAtLogin: true }); cfg.autostart = true; saveCfg(); } // lần đầu: bật tự chạy
    win = new BrowserWindow({ width: 1280, height: 860, minWidth: 380, minHeight: 600, icon: ICON, title: 'MAO', backgroundColor: '#F8FAFC',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false } }); // thu nhỏ vẫn nhận đơn, kêu chuông
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.on('close', e => {
      if (quitting) return;
      e.preventDefault(); win.hide();
      if (!hintShown) {
        hintShown = true; const t = 'MAO vẫn đang chạy', c = 'Khách vẫn gọi món được. Bấm biểu tượng MAO ' + (MAC ? 'trên thanh menu hoặc Dock' : 'ở góc phải') + ' để mở lại.';
        if (MAC) new Notification({ title: t, body: c }).show(); else tray.displayBalloon({ title: t, content: c, iconType: 'info' });
      }
    });
    tray = new Tray(MAC ? nativeImage.createFromPath(ICON).resize({ width: 18 }) : ICON);
    tray.setToolTip('MAO đang chạy · khách vẫn gọi món được');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mở MAO', click: show }, { label: 'Máy quầy', click: () => open('/nhanvien') }, { label: 'Chủ quán', click: () => open('/chuquan') },
      { type: 'separator' }, { label: 'Thoát MAO', click: quit }]));
    tray.on('click', show);
    buildMenu();
    open('/nhanvien');
    win.webContents.once('did-finish-load', loadPrinters);
  });
});

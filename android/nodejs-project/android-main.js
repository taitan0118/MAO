// Chạy máy chủ MSAO trong app Android. App truyền vào: thư mục dữ liệu, địa chỉ WiFi của máy.
'use strict';
process.env.DATA_DIR = process.argv[2];
if (process.argv[3]) process.env.LAN_IP = process.argv[3];
const srv = require('./server.js');
srv.server.on('error', e => console.error('MSAO không chạy được:', e.message));
srv.server.listen(srv.PORT, '0.0.0.0', () => console.log('MSAO đang chạy ' + srv.lanUrl()));

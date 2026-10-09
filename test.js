// Kiểm tra nhanh toàn bộ luồng chính của máy chủ: node test.js
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'goimon-'));
const { server, netKind, db: _ } = require('./server');
const S = require('./server');

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const jar = { owner: '', lan: '', tuan: '' };
  async function call(name, body, who) {
    const r = await fetch(base + '/api/a/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar[who] || '' }, body: JSON.stringify(body || {}) });
    const sc = r.headers.get('set-cookie'); if (sc && who) jar[who] = sc.split(';')[0];
    return Object.assign({ status: r.status }, await r.json());
  }
  const state = async (q, who) => (await fetch(base + '/api/state?' + q, { headers: { Cookie: jar[who] || '' } })).json();
  try {
    // mạng
    assert.equal(netKind('::ffff:192.168.1.20'), 'lan'); assert.equal(netKind('100.101.1.2'), 'tailscale');
    assert.equal(netKind('8.8.8.8'), 'out'); assert.equal(netKind('127.0.0.1'), 'local'); assert.equal(netKind('172.40.0.1'), 'out');

    assert.equal((await state('as=owner')).hasOwner, false);
    const setup = await call('owner-setup', { shop: 'Quán Test', name: 'Chủ Test', phone: '0900000001', pw: 'abc123' }, 'owner');
    assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(setup.recovery), 'mã khôi phục');
    assert.equal((await call('owner-setup', { shop: 'X', name: 'Ai Đó', phone: '0900000002', pw: 'abc123' }, 'owner')).status, 400, 'không tạo chủ quán lần 2');

    assert.ok((await call('group-add', { name: 'Khai vị' }, 'owner')).ok);
    assert.ok((await call('item-save', { name: 'Gỏi cuốn', cat: 'Khai vị', price: 25000 }, 'owner')).ok);
    assert.ok((await call('item-save', { name: 'Cá kho', cat: 'Món chính', price: 60000, stock: false }, 'owner')).ok);
    assert.equal((await call('item-save', { name: 'Rẻ', cat: 'Món chính', price: 10 }, 'owner')).status, 400, 'giá sai');
    assert.ok((await call('staff-add', { name: 'Lan', phone: '0901111222', role: 'quay', pw: 'lan123' }, 'owner')).ok);
    assert.ok((await call('staff-add', { name: 'Tuấn', phone: '0902333444', role: 'nv', pw: 'tuan123' }, 'owner')).ok);
    assert.equal((await call('item-save', { name: 'Hack', cat: 'Khai vị', price: 5000 }, 'tuan')).status, 401, 'không đăng nhập thì không sửa menu');

    assert.ok((await call('staff-login', { phone: '0901111222', pw: 'lan123' }, 'lan')).ok);
    assert.ok((await call('staff-login', { phone: '0902333444', pw: 'tuan123' }, 'tuan')).ok);
    assert.equal((await call('staff-login', { phone: '0902333444', pw: 'sai' })).status, 400);

    // khách gọi món: giá lấy từ máy chủ, món hết bị chặn
    const g = await state('as=guest&ban=01');
    assert.equal(g.table, '01'); assert.ok(!g.invoices, 'khách không thấy hóa đơn');
    const goi = g.menu.find(m => m.name === 'Gỏi cuốn'), ca = g.menu.find(m => m.name === 'Cá kho');
    assert.equal((await call('order', { table: '01', name: 'Anh Minh', items: [{ id: ca.id, q: 1 }] })).status, 400, 'món hết');
    assert.equal((await call('order', { table: '99', name: 'Anh Minh', items: [{ id: goi.id, q: 1 }] })).status, 400, 'bàn sai');
    const od = await call('order', { table: '01', name: 'Anh Minh', items: [{ id: goi.id, q: 2, price: 1 }], notes: ['Ít cay'] });
    assert.ok(od.ok);

    // chỉ quầy xác nhận; phục vụ xong mới thanh toán
    assert.equal((await call('set-status', { id: od.id, to: 'lam' }, 'tuan')).status, 400);
    assert.equal((await call('pay', { table: '01' }, 'tuan')).status, 400, 'chưa phục vụ chưa thanh toán');
    assert.ok((await call('set-status', { id: od.id, to: 'lam' }, 'lan')).ok);
    assert.ok((await call('set-status', { id: od.id, to: 'xong' }, 'tuan')).ok);
    assert.ok((await call('pay-request', { table: '01' })).ok);
    const pay = await call('pay', { table: '01' }, 'tuan');
    assert.equal(pay.invoice.total, 50000); assert.equal(pay.invoice.confirmStaff, 'Lan'); assert.equal(pay.invoice.paidBy, 'Tuấn');

    // sửa hóa đơn: tạo bản mới, giữ bản cũ; nhân viên thường không sửa được; không chèn giá tùy ý
    const items = [{ name: 'Gỏi cuốn', price: 25000, q: 3 }];
    assert.equal((await call('invoice-edit', { no: pay.invoice.no, items, reason: 'Khách gọi thêm' }, 'tuan')).status, 401);
    assert.equal((await call('invoice-edit', { no: pay.invoice.no, items: [{ name: 'Gỏi cuốn', price: 1000, q: 1 }], reason: 'Đổi giá bậy' }, 'lan')).status, 400);
    const ed = await call('invoice-edit', { no: pay.invoice.no, items, reason: 'Khách gọi thêm' }, 'lan');
    assert.equal(ed.invoice.total, 75000); assert.deepEqual(ed.invoice.changes, ['Gỏi cuốn: 2 → 3']);
    const os2 = await state('as=owner', 'owner');
    assert.equal(os2.invoices.find(i => i.no === pay.invoice.no).replacedBy, ed.invoice.no);
    assert.ok(!JSON.stringify(os2).includes('"pw"'), 'không gửi mật khẩu đã mã hóa ra ngoài');

    // mã QR vào ca: dùng một lần
    const tuanId = os2.staff.find(s => s.name === 'Tuấn').id;
    const code = await call('staff-code', { id: tuanId }, 'lan');
    assert.equal((await call('code-check', { code: code.code })).name, 'Tuấn');
    assert.equal((await call('code-login', { code: code.code, pw: 'sai' })).status, 400);
    assert.ok((await call('code-login', { code: code.code, pw: 'tuan123' })).ok);
    assert.equal((await call('code-login', { code: code.code, pw: 'tuan123' })).status, 400, 'mã đã dùng');

    // khóa nhân viên thì phiên bị hủy
    assert.ok((await call('staff-toggle', { id: tuanId }, 'owner')).ok);
    assert.equal((await state('as=staff', 'tuan')).me, null);

    // khôi phục mật khẩu chủ quán bằng mã khôi phục
    assert.ok((await call('owner-recover', { phone: '0900000001', code: setup.recovery, pw: 'moi123' })).ok);
    assert.ok((await call('owner-login', { phone: '0900000001', pw: 'moi123' }, 'owner')).ok);

    // thông tin thiết bị: chỉ chủ quán xem được
    assert.equal((await fetch(base + '/api/device')).status, 401, 'chưa đăng nhập không xem được thông tin máy');
    const dev = await (await fetch(base + '/api/device', { headers: { Cookie: jar.owner } })).json();
    assert.ok(/^[A-Z0-9]{12}$/.test(dev.id) && dev.ip && dev.version && dev.freeMB > 0 && dev.lastData, 'thông tin thiết bị đủ trường');

    // logo quán: lưu thành file ảnh, ai cũng thấy (để in hóa đơn), bỏ được
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    assert.ok((await call('settings', { name: 'Quán Test', bank: 'Vietcombank', acc: '0123456789', logo: png }, 'owner')).ok);
    const logo = (await state('as=guest&ban=01')).shop.logo;
    assert.ok(logo.startsWith('/anh/'), 'logo quán');
    assert.equal((await fetch(base + logo)).status, 200);
    assert.ok((await call('settings', { name: 'Quán Test', bank: 'Vietcombank', acc: '0123456789', logo: '' }, 'owner')).ok);
    assert.equal((await state('as=guest&ban=01')).shop.logo, '');

    // khuyến mãi: engine tính đúng từng loại (dữ liệu giả, không qua máy chủ)
    const KM = require('./khuyenmai');
    const M = [[1, 'Bò', 'Thịt', 150000], [2, 'Bia', 'Uống', 20000], [3, 'Trà', 'Uống', 30000], [4, 'Bánh mì', 'Bánh', 25000], [5, 'Cà phê', 'Uống', 25000]].map(([id, name, cat, price]) => ({ id, name, cat, price }));
    const P = o => Object.assign({ id: 1, name: 'p', on: true, quota: 0, used: 0, days: [], h1: null, h2: null }, o);
    const Q = (promos, lines, o, cfg) => KM.quote({ menu: M, promos, cfg: cfg || {}, stamps: {} }, lines, Object.assign({ at: Date.UTC(2026, 9, 7, 8, 0) }, o)); // thứ Tư 15:00 giờ VN
    const L = (n, q) => ({ name: n, q, price: M.find(m => m.name === n).price });
    assert.equal(Q([P({ type: 'bxy', bi: 2, bx: 2, by: 1 })], [L('Bia', 3)]).disc, 20000, 'mua 2 tính 1');
    assert.equal(Q([P({ type: 'bab', a: 1, m: 1, b: 2, p: 100, k: 0 })], [L('Bò', 1), L('Bia', 2)]).disc, 20000, 'mua A tặng B');
    assert.equal(Q([P({ type: 'nth', cat: 'Uống', n: 2, p: 50 })], [L('Bia', 1), L('Trà', 1)]).disc, 10000, 'món thứ 2 giảm món rẻ nhất');
    const cb = Q([P({ type: 'combo', items: [{ id: 4, q: 1 }, { id: 5, q: 1 }], price: 35000 })], [L('Bánh mì', 1), L('Cà phê', 1)]);
    assert.equal(cb.disc, 15000); assert.equal(cb.total, 35000, 'combo giá cố định');
    const gf = Q([P({ type: 'gift', min: 200000, gi: 2, gq: 2 })], [L('Bò', 2)]);
    assert.equal(gf.gifts[0].q, 2); assert.equal(gf.total, 300000, 'tặng món, không đổi tiền');
    assert.equal(Q([P({ type: 'gift', min: 400000, gi: 2, gq: 2 })], [L('Bò', 2)]).gifts.length, 0, 'chưa đủ mức bill');
    assert.equal(Q([P({ id: 1, type: 'pct', p: 20, min: 0, cap: 0 }), P({ id: 2, type: 'amt', a: 50000, min: 0 })], [L('Bò', 2)]).disc, 60000, 'hóa đơn chọn 1 chương trình lợi nhất');
    const cap = Q([P({ type: 'item', tgt: 'c:Uống', mode: 'pct', v: 100 })], [L('Bia', 2)]);
    assert.equal(cap.total, 20000, 'trần 50%'); assert.equal(Q([P({ type: 'item', tgt: 'c:Uống', mode: 'pct', v: 100 })], [L('Bia', 2)], {}, { holiday: true }).total, 0, 'dịp Tết/lễ bỏ trần');
    assert.equal(Q([P({ type: 'pct', p: 10, min: 0, days: [3] })], [L('Bò', 1)]).disc, 15000, 'đúng thứ Tư');
    assert.equal(Q([P({ type: 'pct', p: 10, min: 0, days: [2] })], [L('Bò', 1)]).disc, 0, 'sai thứ');
    assert.equal(Q([P({ type: 'pct', p: 10, min: 0, h1: 14, h2: 16 })], [L('Bò', 1)]).disc, 15000, 'trong khung giờ');
    assert.equal(Q([P({ type: 'pct', p: 10, min: 0, h1: 16, h2: 18 })], [L('Bò', 1)]).disc, 0, 'ngoài khung giờ');
    assert.equal(Q([P({ type: 'pct', p: 10, min: 0, h1: 14, h2: 2 })], [L('Bò', 1)]).disc, 15000, 'khung giờ qua nửa đêm');
    assert.equal(Q([P({ type: 'pct', p: 10, min: 0, quota: 1, used: 1 })], [L('Bò', 1)]).disc, 0, 'hết lượt N đơn đầu');
    assert.equal(Q([P({ type: 'pct', p: 10, min: 0, quota: 1, used: 1 })], [L('Bò', 1)], { ignoreQuota: true }).disc, 15000);
    const cd = [P({ id: 1, type: 'pct', p: 20, min: 0, cap: 0 }), P({ id: 2, type: 'code', code: 'ABC', mode: 'pct', v: 10, min: 0, stack: false })];
    assert.equal(Q(cd, [L('Bò', 1)], { code: 'abc' }).disc, 30000, 'mã không cộng dồn: giữ cái lợi hơn');
    cd[1].stack = true; assert.equal(Q(cd, [L('Bò', 1)], { code: 'abc' }).disc, 30000 + 12000, 'mã cộng dồn');
    assert.ok(Q(cd, [L('Bò', 1)], { code: 'sai' }).codeMsg.includes('không tồn tại'));

    // khuyến mãi qua máy chủ: chỉ chủ quán tạo; thanh toán tự áp, ghi lên hóa đơn, tính lượt dùng
    const own = (n, b) => call(n, b, 'owner');
    assert.equal((await call('promo-save', { type: 'pct', name: 'Lén giảm', p: 10, min: 0 }, 'lan')).status, 401, 'nhân viên không tạo khuyến mãi');
    assert.equal((await own('promo-save', { type: 'combo', name: 'Combo sai', items: [{ id: goi.id, q: 1 }, { id: goi.id, q: 1 }], price: 99999 })).status, 400, 'giá combo phải thấp hơn giá lẻ');
    assert.equal((await own('promo-save', { type: 'item', name: 'Sai danh mục', tgt: 'c:Không có', mode: 'pct', v: 10 })).status, 400);
    assert.equal((await own('promo-save', { type: 'pct', name: 'Giờ lệch', p: 10, min: 0, h1: 14 })).status, 400, 'phải nhập đủ cặp giờ');
    assert.ok((await own('promo-save', { type: 'item', name: 'Giảm 20% khai vị', tgt: 'c:Khai vị', mode: 'pct', v: 20 })).ok);
    assert.ok((await own('promo-save', { type: 'code', name: 'Mã VUI10', code: 'vui10', mode: 'pct', v: 10, min: 0 })).ok);
    assert.equal((await own('promo-save', { type: 'code', name: 'Trùng mã', code: 'VUI10', mode: 'pct', v: 5, min: 0 })).status, 400, 'mã trùng');
    assert.equal((await own('promo-cfg', { holiday: false, manualMax: 60 })).status, 400);
    const goOrder = async (t, q) => { const o = await call('order', { table: t, name: 'Anh Minh', items: [{ id: goi.id, q }] }); await call('set-status', { id: o.id, to: 'lam' }, 'lan'); await call('set-status', { id: o.id, to: 'xong' }, 'lan'); };
    await goOrder('02', 4);
    const g2 = await state('as=guest&ban=02');
    assert.equal(g2.quote.total, 80000, 'khách thấy ưu đãi tự áp'); assert.equal(g2.quote.applied.length, 1); assert.ok(!JSON.stringify(g2).includes('VUI10'), 'khách không thấy mã giảm giá');
    assert.equal((await call('promo-quote', { table: '02', code: 'vui10' }, 'lan')).quote.total, 72000);
    assert.equal((await call('promo-quote', { table: '02', manual: { pct: 20, reason: 'Khách quen' } }, 'lan')).status, 400, 'giảm thủ công quá mức cho phép');
    assert.equal((await call('promo-quote', { table: '02', manual: { pct: 5, reason: 'Vui' } }, 'lan')).status, 400, 'phải chọn lý do có sẵn');
    const p2 = await call('pay', { table: '02', code: 'vui10', manual: { pct: 5, reason: 'Khách quen' } }, 'lan');
    assert.equal(p2.invoice.total, 68400); assert.equal(p2.invoice.sub, 100000); assert.equal(p2.invoice.manual.v, 3600); assert.equal(p2.invoice.promos.length, 2);
    const ow = await state('as=owner', 'owner');
    assert.deepEqual(ow.promos.map(p => p.used), [1, 1], 'đã tính lượt dùng sau khi thanh toán');
    const e2 = await call('invoice-edit', { no: p2.invoice.no, items: [{ name: 'Gỏi cuốn', price: 25000, q: 5 }], reason: 'Khách gọi thêm' }, 'lan');
    assert.equal(e2.invoice.total, 85500, 'sửa hóa đơn tính lại khuyến mãi');
    assert.deepEqual((await state('as=owner', 'owner')).promos.map(p => p.used), [1, 1], 'sửa hóa đơn không đổi số lượt dùng');
    // hủy hóa đơn: chỉ chủ quán, cần lý do, hoàn lượt khuyến mãi, không tính doanh thu
    assert.equal((await call('invoice-void', { no: e2.invoice.no, reason: 'Khách bỏ về' }, 'lan')).status, 401, 'quầy không được hủy');
    assert.equal((await own('invoice-void', { no: e2.invoice.no, reason: 'ngắn' })).status, 400);
    assert.equal((await own('invoice-void', { no: p2.invoice.no, reason: 'Hóa đơn đã bị thay thế' })).status, 400, 'bản cũ đã thay thế không hủy');
    assert.ok((await own('invoice-void', { no: e2.invoice.no, reason: 'Khách bỏ về không trả' })).ok);
    assert.equal((await own('invoice-void', { no: e2.invoice.no, reason: 'Hủy lần hai' })).status, 400, 'không hủy hai lần');
    const ov = await state('as=owner', 'owner');
    assert.deepEqual(ov.promos.map(p => p.used), [0, 0], 'hoàn lại lượt khuyến mãi');
    assert.equal(ov.invoices.find(i => i.no === e2.invoice.no).voided.reason, 'Khách bỏ về không trả');
    // trần 50% và dịp Tết/lễ
    assert.ok((await own('promo-save', { type: 'item', name: 'Tặng hết', tgt: 'c:Khai vị', mode: 'pct', v: 100 })).ok);
    await goOrder('03', 2);
    assert.equal((await call('promo-quote', { table: '03' }, 'lan')).quote.total, 25000, 'trần 50%');
    assert.ok((await own('promo-cfg', { holiday: true, manualMax: 10 })).ok);
    assert.equal((await call('promo-quote', { table: '03' }, 'lan')).quote.total, 0, 'dịp Tết/lễ');
    assert.ok((await own('promo-cfg', { holiday: false, manualMax: 10 })).ok);
    assert.equal((await state('as=owner', 'owner')).kitchen.mode, 'manual', 'mặc định in thủ công');
    assert.equal((await call('kitchen-cfg', { mode: 'auto' }, 'lan')).status, 401, 'quầy không đổi cách in');
    assert.equal((await own('kitchen-cfg', { mode: 'xx' })).status, 400);
    assert.ok((await own('kitchen-cfg', { mode: 'auto' })).ok);
    assert.equal((await state('as=staff', 'lan')).kitchen.mode, 'auto', 'nhân viên nhận được cài đặt');
    assert.ok((await own('kitchen-cfg', { mode: 'manual' })).ok);
    const allP = (await state('as=owner', 'owner')).promos;
    assert.ok((await own('promo-del', { id: allP.find(p => p.name === 'Tặng hết').id })).ok);
    // thẻ tích ly theo SĐT
    assert.ok((await own('promo-save', { type: 'card', name: 'Tích 2 ly', n: 2, ids: [goi.id] })).ok);
    assert.equal((await own('promo-save', { type: 'card', name: 'Thẻ thứ hai', n: 3, ids: [goi.id] })).status, 400, 'chỉ một thẻ tích ly');
    assert.equal((await call('pay', { table: '03', phone: '12345' }, 'lan')).status, 400, 'SĐT sai');
    const p3 = await call('pay', { table: '03', phone: '0912345678' }, 'lan');
    assert.equal(p3.invoice.total, 40000); assert.equal(S.db.stamps['0912345678'], 2, 'tích 2 ly');
    await goOrder('04', 1);
    const q4 = await call('promo-quote', { table: '04', phone: '0912345678' }, 'lan'); assert.equal(q4.quote.total, 0, 'đủ ly thì tặng ly');
    const p4 = await call('pay', { table: '04', phone: '0912345678' }, 'lan');
    assert.equal(p4.invoice.total, 0); assert.equal(S.db.stamps['0912345678'], undefined, 'đổi thẻ xong còn 0, xóa khỏi sổ');

    // dữ liệu đã nằm trên ổ đĩa, có bản sao lưu
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'quan.json'), 'utf8'));
    assert.equal(saved.invoices.length, 2 + 2 + 2);
    assert.ok(fs.readdirSync(path.join(process.env.DATA_DIR, 'saoluu')).length >= 2);
    console.log('OK: tất cả kiểm tra đều đạt');
  } catch (e) { console.error('LỖI:', e.message); process.exitCode = 1; }
  server.close(); process.exit();
});

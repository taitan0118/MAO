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

    // logo quán: lưu thành file ảnh, ai cũng thấy (để in hóa đơn), bỏ được
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    assert.ok((await call('settings', { name: 'Quán Test', bank: 'Vietcombank', acc: '0123456789', logo: png }, 'owner')).ok);
    const logo = (await state('as=guest&ban=01')).shop.logo;
    assert.ok(logo.startsWith('/anh/'), 'logo quán');
    assert.equal((await fetch(base + logo)).status, 200);
    assert.ok((await call('settings', { name: 'Quán Test', bank: 'Vietcombank', acc: '0123456789', logo: '' }, 'owner')).ok);
    assert.equal((await state('as=guest&ban=01')).shop.logo, '');

    // dữ liệu đã nằm trên ổ đĩa, có bản sao lưu
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'quan.json'), 'utf8'));
    assert.equal(saved.invoices.length, 2);
    assert.ok(fs.readdirSync(path.join(process.env.DATA_DIR, 'saoluu')).length >= 2);
    console.log('OK: tất cả kiểm tra đều đạt');
  } catch (e) { console.error('LỖI:', e.message); process.exitCode = 1; }
  server.close(); process.exit();
});

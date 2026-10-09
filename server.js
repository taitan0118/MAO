// Máy chủ phần mềm gọi món QR — chạy trên máy tính Windows đặt tại quán.
// Khách và nhân viên vào bằng trình duyệt qua WiFi quán; chủ quán vào được thêm qua Tailscale.
// Không cần thư viện ngoài cho phần máy chủ (chỉ Node.js 20+).
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');

const PORT = +process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const KM = require('./khuyenmai');
const DB_FILE = path.join(DATA, 'quan.json'), IMG_DIR = path.join(DATA, 'anh'), BAK_DIR = path.join(DATA, 'saoluu');
for (const d of [DATA, IMG_DIR, BAK_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- Lưu dữ liệu ----------
// ponytail: cả quán nằm trong một file JSON, ghi lại toàn bộ mỗi lần đổi. Ổn tới vài chục MB (vài năm hóa đơn của một quán);
// lớn hơn thì chuyển sang SQLite (node:sqlite có sẵn trong Node 22).
function emptyDb() {
  return { ver: 1, shop: { name: '', addr: '', phone: '', bank: 'Vietcombank', acc: '', holder: '' },
    owners: [], staff: [], groups: ['Món chính', 'Đồ uống'], menu: [], tables: ['01', '02', '03', '04', '05'],
    orders: [], invoices: [], payReq: {}, seq: { order: 100, inv: 1000, menu: 0, staff: 0, owner: 0, promo: 0 }, sessions: {}, codes: {},
    promos: [], stamps: {}, promoCfg: { holiday: false, manualMax: 10 }, kitchen: { mode: 'manual' } };
}
let db;
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
else { db = emptyDb(); if (process.argv.includes('--mau')) require('./du-lieu-mau')(db, hashPw); save(); }
for (const [k, v] of Object.entries(emptyDb())) if (db[k] === undefined) db[k] = v; // bản dữ liệu cũ chưa có khuyến mãi
db.seq.promo = db.seq.promo || 0;
for (const [t, x] of Object.entries(db.sessions)) if (x.exp < Date.now()) delete db.sessions[t]; // dọn phiên đã hết hạn

function save() { // ghi file tạm, ép xuống đĩa rồi mới đổi tên: mất điện giữa chừng không hỏng dữ liệu
  const tmp = DB_FILE + '.tmp', fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, JSON.stringify(db)); fs.fsyncSync(fd); fs.closeSync(fd);
  fs.renameSync(tmp, DB_FILE);
}
const clients = new Set();
function commit() { db.ver++; save(); for (const r of clients) r.write('data: ' + db.ver + '\n\n'); }

// Sao lưu: mỗi giờ một bản (giữ 72 bản), mỗi ngày một bản (giữ 90 bản), ngay trên ổ đĩa máy chủ.
function backup() {
  const d = new Date(), p2 = n => String(n).padStart(2, '0'), day = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  fs.copyFileSync(DB_FILE, path.join(BAK_DIR, 'gio-' + day + '-' + p2(d.getHours()) + '.json'));
  fs.copyFileSync(DB_FILE, path.join(BAK_DIR, 'ngay-' + day + '.json'));
  for (const [pre, keep] of [['gio-', 72], ['ngay-', 90]])
    fs.readdirSync(BAK_DIR).filter(f => f.startsWith(pre)).sort().reverse().slice(keep).forEach(f => fs.unlinkSync(path.join(BAK_DIR, f)));
}
setInterval(backup, 3600e3).unref(); backup();

// ---------- Mật khẩu, phiên đăng nhập ----------
function hashPw(pw) { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); }
function checkPw(pw, h) {
  if (!h || typeof pw !== 'string') return false;
  const [s, k] = h.split(':'), a = Buffer.from(k, 'hex'), b = crypto.scryptSync(pw, s, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const PW_RE = /^(?=.*[A-Za-z])(?=.*\d).{6,30}$/, PHONE_RE = /^0\d{9}$/, NAME_RE = /^[\p{L}\s.'-]{2,40}$/u;
const OWNER_TTL = 30 * 864e5, STAFF_TTL = 8 * 3600e3, STAFF_IDLE = 30 * 60e3;

function newSession(res, kind, id) {
  const t = crypto.randomBytes(24).toString('hex'), ttl = kind === 'owner' ? OWNER_TTL : STAFF_TTL;
  db.sessions[t] = { kind, id, exp: Date.now() + ttl, last: Date.now() };
  res.setHeader('Set-Cookie', (kind === 'owner' ? 'sid_o=' : 'sid_s=') + t + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + ttl / 1000);
}
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = c.slice(i + 1).trim(); }); return o; }
function getUser(req, kind) {
  const t = cookies(req)[kind === 'owner' ? 'sid_o' : 'sid_s'], s = t && db.sessions[t];
  if (!s || s.kind !== kind) return null;
  const now = Date.now();
  if (now > s.exp || (kind === 'staff' && now - s.last > STAFF_IDLE)) { delete db.sessions[t]; return null; }
  const u = (kind === 'owner' ? db.owners : db.staff).find(x => x.id === s.id);
  if (!u || u.active === false) { delete db.sessions[t]; return null; }
  s.last = now; // ponytail: thời gian thao tác cuối chỉ lưu khi có thay đổi khác, mất khi tắt máy cũng không sao
  return u;
}
function killSessions(kind, id) { for (const [t, s] of Object.entries(db.sessions)) if (s.kind === kind && s.id === id) delete db.sessions[t]; }

// ---------- Mạng: chỉ nhận kết nối trong WiFi quán (và Tailscale cho chủ quán) ----------
function netKind(ip) {
  ip = String(ip || '').replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return 'local';
  const ts = ip.match(/^100\.(\d+)\./);
  if ((ts && +ts[1] >= 64 && +ts[1] <= 127) || /^fd7a:115c:a1e0:/i.test(ip)) return 'tailscale';
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^fe80:/i.test(ip) || /^f[cd]/i.test(ip)) return 'lan';
  return 'out';
}
function lanUrl() {
  if (process.env.LAN_IP) return 'http://' + process.env.LAN_IP + ':' + PORT;
  let nets = {}; try { nets = os.networkInterfaces(); } catch {} // Android 11+ có thể chặn: app truyền LAN_IP vào
  const ips = Object.values(nets).flat().filter(a => a && a.family === 'IPv4' && !a.internal && netKind(a.address) === 'lan').map(a => a.address);
  const ip = ips.find(a => a.startsWith('192.168.')) || ips[0] || '127.0.0.1';
  return 'http://' + ip + ':' + PORT;
}

// Thông tin máy chủ cho chủ quán xem/xuất (mục Cài đặt → Thông tin thiết bị)
const VERSION = (() => { try { return require('./package.json').version || ''; } catch { return ''; } })();
const ID_FILE = path.join(DATA, 'may.id');
if (!fs.existsSync(ID_FILE)) fs.writeFileSync(ID_FILE, crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '').toUpperCase().padEnd(12, 'X').slice(0, 12));
function deviceInfo() {
  const t = f => { try { return f(); } catch { return null; } };
  const st = t(() => fs.statfsSync(DATA)), mb = n => Math.round(n / 1048576);
  const bak = t(() => fs.readdirSync(BAK_DIR).filter(f => f.startsWith('gio-')).sort().pop());
  return { id: fs.readFileSync(ID_FILE, 'utf8').trim(), name: t(() => os.hostname()) || '', ip: lanUrl().replace(/^http:\/\//, '').replace(/:\d+$/, ''), port: PORT,
    time: new Date().toISOString(), tz: -new Date().getTimezoneOffset(), version: VERSION, os: process.platform + ' ' + (t(() => os.release()) || ''), node: process.version,
    freeMB: st ? mb(st.bavail * st.bsize) : null, totalMB: st ? mb(st.blocks * st.bsize) : null, dataMB: +((t(() => fs.statSync(DB_FILE).size) || 0) / 1048576).toFixed(2),
    lastData: t(() => fs.statSync(DB_FILE).mtime.toISOString()), lastBackup: bak ? bak.slice(4, 14) + ' ' + bak.slice(15, 17) + 'h' : null,
    uptimeMin: Math.round(process.uptime() / 60), connected: clients.size, ver: db.ver };
}

// Chặn dò mật khẩu và gửi đơn dồn dập theo từng địa chỉ máy
const hits = new Map();
function limit(key, max, ms) {
  const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms);
  if (a.length >= max) throw new E('Thao tác quá nhanh, vui lòng thử lại sau ít phút', 429);
  a.push(now); hits.set(key, a);
}

// ---------- Tiện ích ----------
class E extends Error { constructor(m, code) { super(m); this.code = code || 400; } }
const need = (ok, msg) => { if (!ok) throw new E(msg); };
const p2 = n => String(n).padStart(2, '0');
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const isOpen = o => o.status === 'cho' || o.status === 'lam' || o.status === 'xong';
const tot = l => l.reduce((s, x) => s + x.q * x.price, 0);
const uniq = a => [...new Set(a.filter(Boolean))];
const REJECT = ['Hết món', 'Bếp quá tải', 'Khách gọi nhầm', 'Khác'];
const BANKS = ['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'TPBank', 'Sacombank', 'VIB', 'SHB', 'HDBank', 'OCB', 'MSB', 'SeABank', 'Eximbank', 'LPBank', 'Nam A Bank', 'Bac A Bank'];

function flat(orders) {
  const m = new Map();
  for (const o of orders) for (const l of o.lines) { const k = l.name + '|' + l.price; const x = m.get(k) || { name: l.name, price: l.price, q: 0 }; x.q += l.q; m.set(k, x); }
  return [...m.values()];
}
// ---------- Khuyến mãi ----------
const MANUAL_REASONS = ['Khách quen', 'Món ra chậm', 'Món lỗi / đổi món', 'Chủ quán duyệt'];
const kmCtx = () => ({ promos: db.promos, menu: db.menu, cfg: db.promoCfg, stamps: db.stamps });
const firstTime = list => Math.min(...list.map(o => Date.parse(o.time) || Date.now())); // chốt khung giờ theo giờ đặt món đầu tiên của bàn
function payQuote(list, b) { // tính tiền một bàn (các đơn đã phục vụ) kèm mã, SĐT, giảm thủ công do nhân viên nhập
  const code = str(b.code, 20).toUpperCase(), phone = str(b.phone, 10);
  need(!phone || PHONE_RE.test(phone), 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0');
  let manual = null;
  if (b.manual && b.manual.pct) {
    const pct = Number(b.manual.pct), max = db.promoCfg.manualMax;
    need(MANUAL_REASONS.includes(b.manual.reason), 'Chọn lý do giảm giá');
    need(Number.isInteger(pct) && pct >= 1 && pct <= max, 'Nhân viên chỉ được giảm tối đa ' + max + '%');
    manual = { pct, reason: b.manual.reason };
  }
  return KM.quote(kmCtx(), flat(list), { at: firstTime(list), code, phone, manual });
}
function invPromo(R, extra) { // phần khuyến mãi lưu trên hóa đơn
  return Object.assign({ sub: R.sub, disc: R.disc, promos: R.applied.map(a => ({ name: a.name, v: a.v })), promoIds: R.applied.map(a => a.id), gifts: R.gifts, itemDisc: R.itemDisc, capAdj: R.adj }, extra);
}
function diffItems(a, b) {
  const out = [], names = uniq(a.concat(b).map(l => l.name)), sum = (arr, n) => arr.filter(l => l.name === n).reduce((s, l) => s + l.q, 0);
  for (const n of names) { const qa = sum(a, n), qb = sum(b, n); if (qa === qb) continue;
    out.push(qa === 0 ? 'Thêm ' + n + ' × ' + qb : qb === 0 ? 'Bỏ ' + n + ' (× ' + qa + ')' : n + ': ' + qa + ' → ' + qb); }
  return out;
}
function cleanItem(b) {
  const name = str(b.name, 40), cat = str(b.cat, 30), price = Number(b.price);
  need(name.length >= 2, 'Tên món từ 2–40 ký tự');
  need(db.groups.includes(cat), 'Hãy chọn một nhóm món có sẵn');
  need(Number.isInteger(price) && price >= 1000 && price <= 1e7, 'Giá là số nguyên từ 1.000đ đến 10.000.000đ');
  return { name, cat, price, stock: b.stock !== false };
}
function saveImage(dataUrl, oldImg) {
  if (dataUrl === undefined) return oldImg || '';
  if (oldImg && oldImg.startsWith('/anh/')) { const f = path.join(IMG_DIR, path.basename(oldImg)); if (fs.existsSync(f)) fs.unlinkSync(f); }
  if (!dataUrl) return '';
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  need(m && m[2].length < 2e6, 'Ảnh không hợp lệ hoặc quá lớn');
  const name = crypto.randomBytes(8).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(IMG_DIR, name), Buffer.from(m[2], 'base64'));
  return '/anh/' + name;
}
function pruneOrders() { // đơn đã thanh toán/từ chối đã nằm trong hóa đơn, chỉ giữ 1 ngày để khách còn xem được
  const cut = Date.now() - 864e5;
  db.orders = db.orders.filter(o => isOpen(o) || Date.parse(o.time) > cut);
}
function newCode(staffId) {
  for (const [c, v] of Object.entries(db.codes)) if (v.staffId === staffId || v.exp < Date.now()) delete db.codes[c];
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = '';
  for (let i = 0; i < 6; i++) c += A[crypto.randomInt(A.length)];
  db.codes[c] = { staffId, exp: Date.now() + 5 * 60e3, fails: 0 };
  return { code: c, link: lanUrl() + '/nhanvien?nv=' + c, exp: db.codes[c].exp };
}

// ---------- Dữ liệu gửi về từng vai trò ----------
function stateFor(as, ctx, q) {
  const shop = { name: db.shop.name, addr: db.shop.addr, phone: db.shop.phone, logo: db.shop.logo || '' };
  const base = { ver: db.ver, shop, groups: db.groups, menu: db.menu, lanUrl: lanUrl(), net: ctx.net };
  if (as === 'owner') {
    const me = getUser(ctx.req, 'owner');
    if (!me) return Object.assign(base, { me: null, hasOwner: db.owners.length > 0 });
    const codeOf = id => Object.values(db.codes).find(c => c.staffId === id && c.exp > Date.now());
    return Object.assign(base, { me: { name: me.name, phone: me.phone, role: 'owner' }, hasOwner: true,
      shop: db.shop, tables: db.tables, orders: db.orders, invoices: db.invoices, payReq: db.payReq,
      staff: db.staff.map(s => ({ id: s.id, name: s.name, phone: s.phone, role: s.role, active: s.active, codeExp: (codeOf(s.id) || {}).exp || 0 })),
      promos: db.promos, promoCfg: db.promoCfg, kitchen: db.kitchen, manualReasons: MANUAL_REASONS });
  }
  if (as === 'staff') {
    const me = getUser(ctx.req, 'staff');
    if (!me) return Object.assign(base, { me: null });
    const st = Object.assign(base, { me: { id: me.id, name: me.name, role: me.role }, shop: db.shop, tables: db.tables,
      orders: db.orders.filter(isOpen), payReq: db.payReq, promoCfg: db.promoCfg, kitchen: db.kitchen, manualReasons: MANUAL_REASONS });
    if (me.role === 'quay') { st.invoices = db.invoices; st.staff = db.staff.map(s => ({ id: s.id, name: s.name, role: s.role, active: s.active })); }
    return st;
  }
  const t = str(q.get('ban'), 6).toUpperCase(); // khách: chỉ thấy thực đơn và đơn của bàn mình
  const mine = db.orders.filter(o => o.table === t && o.status !== 'tra'), live = mine.filter(isOpen);
  let quote = null; // ưu đãi tự áp cho bàn (chưa có mã, chưa có SĐT), khách chỉ xem
  if (live.length && db.promos.some(p => p.on)) { const R = KM.quote(kmCtx(), flat(live), { at: firstTime(live) });
    quote = { sub: R.sub, total: R.total, disc: R.disc, applied: R.applied.map(a => ({ name: a.name, v: a.v })), gifts: R.gifts, lines: R.lines, hint: R.hint, adj: R.adj }; }
  return Object.assign(base, { table: db.tables.includes(t) ? t : null, tables: [t], orders: mine, payReq: { [t]: !!db.payReq[t] }, quote });
}

// ---------- Thao tác (who: ai được phép) ----------
const A = {};
const act = (name, who, fn) => { A[name] = { who, fn }; };

// Khách và nhân viên gọi món
act('order', 'guest', (b, c) => {
  limit('order:' + c.ip, 8, 60e3);
  const table = str(b.table, 6).toUpperCase(), staff = b.asStaff ? getUser(c.req, 'staff') : null;
  need(db.tables.includes(table), 'Bàn không tồn tại. Hãy quét lại mã QR trên bàn.');
  need(!b.asStaff || staff, 'Phiên nhân viên đã hết, hãy đăng nhập lại');
  const name = staff ? 'Khách tại bàn' : str(b.name, 40);
  need(staff || NAME_RE.test(name), 'Tên từ 2–40 ký tự, chỉ gồm chữ cái');
  need(Array.isArray(b.items) && b.items.length >= 1 && b.items.length <= 40, 'Giỏ hàng đang trống');
  const lines = b.items.map(it => {
    const m = db.menu.find(x => x.id === Number(it.id)), q = Number(it.q);
    need(m, 'Có món không còn trong thực đơn, hãy tải lại trang');
    need(m.stock, m.name + ' vừa tạm hết, hãy bỏ món này');
    need(Number.isInteger(q) && q >= 1 && q <= 20, 'Mỗi món từ 1 đến 20 phần');
    return { name: m.name, q, price: m.price }; // giá lấy từ thực đơn trên máy chủ, không tin giá gửi lên
  });
  const notes = (Array.isArray(b.notes) ? b.notes : []).slice(0, 8).map(n => str(n, 80)).filter(Boolean);
  const o = { id: ++db.seq.order, table, name, by: staff ? 'Nhân viên' : 'Khách', takenBy: staff ? staff.name : 'Khách',
    lines, notes, status: 'cho', time: new Date().toISOString() };
  db.orders.push(o);
  return { id: o.id };
});
act('pay-request', 'guest', (b, c) => {
  limit('pay:' + c.ip, 6, 60e3);
  const t = str(b.table, 6).toUpperCase();
  need(db.orders.some(o => o.table === t && o.status === 'xong'), 'Chưa có món nào đã được phục vụ để thanh toán');
  db.payReq[t] = true;
});

// Đăng nhập nhân viên
act('staff-login', 'guest', (b, c) => {
  limit('login:' + c.ip, 10, 600e3);
  const s = db.staff.find(x => x.phone === str(b.phone, 10));
  need(s && checkPw(b.pw, s.pw), 'Số điện thoại hoặc mật khẩu không đúng');
  need(s.active, 'Tài khoản này đã bị khóa');
  newSession(c.res, 'staff', s.id);
  return { name: s.name };
});
act('code-check', 'guest', (b, c) => { // quét mã QR: cho biết mã của ai để hiện lời chào, chưa đăng nhập
  limit('code:' + c.ip, 20, 600e3);
  const k = str(b.code, 9).toUpperCase().replace(/^NV-?/, ''), v = db.codes[k];
  need(v && v.exp > Date.now(), 'Mã không đúng, đã dùng hoặc đã hết hạn. Hãy xin mã mới.');
  const s = db.staff.find(x => x.id === v.staffId);
  need(s && s.active, 'Tài khoản này đã bị khóa');
  return { name: s.name };
});
act('code-login', 'guest', (b, c) => {
  limit('login:' + c.ip, 10, 600e3);
  const k = str(b.code, 9).toUpperCase().replace(/^NV-?/, ''), v = db.codes[k];
  need(v && v.exp > Date.now(), 'Mã không đúng, đã dùng hoặc đã hết hạn. Hãy xin mã mới.');
  const s = db.staff.find(x => x.id === v.staffId);
  need(s && s.active, 'Tài khoản này đã bị khóa');
  if (!checkPw(b.pw, s.pw)) {
    if (++v.fails >= 5) { delete db.codes[k]; throw new E('Nhập sai 5 lần, mã đã bị hủy. Hãy xin mã mới.'); }
    throw new E('Mật khẩu không đúng (còn ' + (5 - v.fails) + ' lần thử)');
  }
  delete db.codes[k];
  newSession(c.res, 'staff', s.id);
  return { name: s.name };
});
act('staff-logout', 'guest', (b, c) => { const t = cookies(c.req).sid_s; if (t) delete db.sessions[t]; c.res.setHeader('Set-Cookie', 'sid_s=; Path=/; Max-Age=0'); });
act('staff-pw', 'staff', (b, c) => {
  need(checkPw(b.cur, c.user.pw), 'Mật khẩu hiện tại không đúng');
  need(PW_RE.test(b.np || ''), 'Mật khẩu 6–30 ký tự, gồm cả chữ và số');
  need(b.np !== b.cur, 'Mật khẩu mới phải khác mật khẩu cũ');
  c.user.pw = hashPw(b.np);
});

// Đơn và thanh toán
act('set-status', 'staff', (b, c) => {
  const o = db.orders.find(x => x.id === Number(b.id)), to = b.to;
  need(o, 'Không tìm thấy đơn');
  if (to === 'lam' || to === 'huy') {
    need(c.user.role === 'quay', 'Chỉ nhân viên quầy mới được xác nhận hoặc từ chối đơn');
    need(o.status === 'cho', 'Đơn này đã được xử lý');
    if (to === 'huy') { need(REJECT.includes(b.reason), 'Chọn một lý do từ chối'); o.rejectReason = b.reason; }
    else o.confirmedBy = c.user.name;
  } else if (to === 'xong') { need(o.status === 'lam', 'Đơn phải được xác nhận trước khi phục vụ'); o.servedBy = c.user.name; }
  else throw new E('Trạng thái không hợp lệ');
  o.status = to;
});
act('promo-quote', 'staff', (b, c) => { // xem trước tiền phải trả trước khi bấm thanh toán (không ghi gì)
  limit('quote:' + c.ip, 90, 60e3);
  const t = str(b.table, 6), list = db.orders.filter(o => o.table === t && o.status === 'xong');
  need(list.length, 'Bàn chưa có món nào đã phục vụ');
  return { quote: payQuote(list, b) };
});
act('pay', 'staff', (b, c) => {
  const t = str(b.table, 6), list = db.orders.filter(o => o.table === t && o.status === 'xong');
  need(list.length, 'Bàn chưa có món nào đã phục vụ');
  const items = flat(list), names = k => uniq(list.map(o => o[k])), R = payQuote(list, b);
  const inv = { no: 'HD' + (++db.seq.inv), table: t, time: new Date().toISOString(), items, total: R.total,
    paidBy: c.user.name, orderStaff: names('takenBy').join(', '), confirmStaff: names('confirmedBy').join(', '), servedStaff: names('servedBy').join(', '), prints: 0 };
  Object.assign(inv, invPromo(R, { code: (R.applied.find(a => a.code) || {}).code, phone: R.stamp ? R.stamp.phone : undefined, stampHave: R.stamp ? R.stamp.have : undefined, stampDelta: R.stamp ? R.stamp.after - R.stamp.have : undefined,
    manual: b.manual && R.manualV ? { pct: Number(b.manual.pct), reason: b.manual.reason, v: R.manualV, by: c.user.name } : undefined }));
  R.applied.forEach(a => { const p = db.promos.find(x => x.id === a.id); if (p) p.used++; }); // chỉ tính lượt khi đơn đã thanh toán
  if (R.stamp) { if (R.stamp.after > 0) db.stamps[R.stamp.phone] = R.stamp.after; else delete db.stamps[R.stamp.phone]; }
  db.invoices.push(inv);
  list.forEach(o => { o.status = 'tra'; });
  db.payReq[t] = false;
  pruneOrders();
  return { invoice: inv };
});
act('print-mark', 'staffOrOwner', b => { const i = db.invoices.find(x => x.no === b.no); need(i, 'Không tìm thấy hóa đơn'); i.prints = (i.prints || 0) + 1; });
act('invoice-edit', 'quayOrOwner', (b, c) => {
  const orig = db.invoices.find(x => x.no === b.no), reason = str(b.reason, 120);
  need(orig && !orig.replacedBy, 'Hóa đơn không tồn tại hoặc đã được thay thế');
  need(reason.length >= 5, 'Ghi lý do sửa từ 5–120 ký tự');
  need(Array.isArray(b.items) && b.items.length >= 1 && b.items.length <= 60, 'Hóa đơn phải có ít nhất một món');
  const items = b.items.map(l => {
    const q = Number(l.q), known = orig.items.concat(db.menu).some(x => x.name === l.name && x.price === l.price);
    need(known, 'Món "' + str(l.name, 40) + '" không có trong hóa đơn cũ hoặc thực đơn');
    need(Number.isInteger(q) && q >= 1 && q <= 99, 'Số lượng từ 1 đến 99');
    return { name: l.name, q, price: l.price };
  });
  const changes = diffItems(orig.items, items);
  need(changes.length, 'Chưa có thay đổi nào so với hóa đơn cũ');
  const R = KM.quote({ promos: db.promos, menu: db.menu, cfg: db.promoCfg, stamps: orig.phone && orig.stampHave != null ? { [orig.phone]: orig.stampHave } : {} }, items,
    { at: Date.parse(orig.time), code: orig.code, phone: orig.phone, ignoreQuota: true, manual: orig.manual ? { pct: orig.manual.pct, reason: orig.manual.reason } : null }); // tính lại theo giờ lúc thanh toán, không đụng số lượt đã dùng
  const nv = Object.assign({}, orig, invPromo(R, { promoIds: orig.promoIds, manual: orig.manual ? Object.assign({}, orig.manual, { v: R.manualV }) : undefined }),
    { no: 'HD' + (++db.seq.inv), items, total: R.total, from: orig.no, note: reason, changes,
    editedBy: c.user.name, editedAt: new Date().toISOString(), prints: 0, replacedBy: undefined });
  orig.replacedBy = nv.no;
  db.invoices.push(nv);
  return { invoice: nv };
});
act('invoice-void', 'owner', (b, c) => { // hủy hóa đơn: giữ lại trong sổ, trừ doanh thu, hoàn lượt khuyến mãi và điểm tích
  const inv = db.invoices.find(x => x.no === b.no), reason = str(b.reason, 120);
  need(inv && !inv.replacedBy && !inv.voided, 'Hóa đơn không tồn tại, đã được thay thế hoặc đã hủy');
  need(reason.length >= 5, 'Ghi lý do hủy từ 5–120 ký tự');
  inv.voided = { by: c.user.name, at: new Date().toISOString(), reason };
  (inv.promoIds || []).forEach(id => { const p = db.promos.find(x => x.id === id); if (p && p.used > 0) p.used--; });
  if (inv.phone && inv.stampDelta) { const n = Math.max(0, (db.stamps[inv.phone] || 0) - inv.stampDelta); if (n > 0) db.stamps[inv.phone] = n; else delete db.stamps[inv.phone]; }
  return { invoice: inv };
});
act('staff-code', 'quayOrOwner', b => {
  const s = db.staff.find(x => x.id === Number(b.id));
  need(s && s.active, 'Tài khoản không tồn tại hoặc đã bị khóa');
  return newCode(s.id);
});

// Chủ quán: tạo tài khoản lần đầu và khôi phục mật khẩu chỉ làm được ngay trên máy chủ
act('owner-setup', 'local', (b, c) => {
  need(!db.owners.length, 'Quán đã có tài khoản chủ quán');
  const shop = str(b.shop, 40), name = str(b.name, 40), phone = str(b.phone, 10);
  need(/^[\p{L}\p{N}\s&.'-]{2,40}$/u.test(shop), 'Tên quán từ 2–40 ký tự');
  need(NAME_RE.test(name), 'Họ tên từ 2–40 ký tự');
  need(PHONE_RE.test(phone), 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0');
  need(PW_RE.test(b.pw || ''), 'Mật khẩu 6–30 ký tự, gồm cả chữ và số');
  const A2 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let rc = '';
  for (let i = 0; i < 12; i++) rc += A2[crypto.randomInt(A2.length)] + (i % 4 === 3 && i < 11 ? '-' : '');
  const o = { id: ++db.seq.owner, name, phone, pw: hashPw(b.pw), recovery: hashPw(rc) };
  db.owners.push(o); db.shop.name = shop;
  newSession(c.res, 'owner', o.id);
  return { recovery: rc };
});
act('owner-recover', 'local', b => {
  limit('recover', 10, 600e3);
  const o = db.owners.find(x => x.phone === str(b.phone, 10));
  need(o && checkPw(str(b.code, 14).toUpperCase(), o.recovery), 'Số điện thoại hoặc mã khôi phục không đúng');
  need(PW_RE.test(b.pw || ''), 'Mật khẩu 6–30 ký tự, gồm cả chữ và số');
  o.pw = hashPw(b.pw); killSessions('owner', o.id);
});
act('owner-login', 'owner-net', (b, c) => {
  limit('login:' + c.ip, 10, 600e3);
  const o = db.owners.find(x => x.phone === str(b.phone, 10));
  need(o && checkPw(b.pw, o.pw), 'Số điện thoại hoặc mật khẩu không đúng');
  newSession(c.res, 'owner', o.id);
  return { name: o.name };
});
act('owner-logout', 'owner-net', (b, c) => { const t = cookies(c.req).sid_o; if (t) delete db.sessions[t]; c.res.setHeader('Set-Cookie', 'sid_o=; Path=/; Max-Age=0'); });
act('owner-pw', 'owner', (b, c) => {
  need(checkPw(b.cur, c.user.pw), 'Mật khẩu hiện tại không đúng');
  need(PW_RE.test(b.np || ''), 'Mật khẩu 6–30 ký tự, gồm cả chữ và số');
  c.user.pw = hashPw(b.np);
});

// Chủ quán: cài đặt
act('settings', 'owner', b => {
  const name = str(b.name, 40), acc = str(b.acc, 20).replace(/\s/g, ''), phone = str(b.phone, 12).replace(/[\s.]/g, '');
  need(/^[\p{L}\p{N}\s.&'-]{2,40}$/u.test(name), 'Tên quán từ 2–40 ký tự');
  need(!acc || /^\d{6,20}$/.test(acc), 'Số tài khoản gồm 6–20 chữ số');
  need(!phone || /^0\d{9,10}$/.test(phone), 'Số điện thoại 10–11 chữ số, bắt đầu bằng 0');
  need(BANKS.includes(b.bank), 'Hãy chọn ngân hàng trong danh sách');
  Object.assign(db.shop, { name, addr: str(b.addr, 80), phone, bank: b.bank, acc, holder: str(b.holder, 40).toUpperCase() });
  if (b.logo !== undefined) db.shop.logo = saveImage(b.logo, db.shop.logo); // logo riêng của quán, in ở đầu hóa đơn
});

// Chủ quán: nhóm món, món, nhập menu
const GROUP_RE = /^[\p{L}\p{N}\s&'-]{2,30}$/u;
act('group-add', 'owner', b => {
  const n = str(b.name, 30);
  need(GROUP_RE.test(n), 'Tên nhóm từ 2–30 ký tự');
  need(!db.groups.some(g => g.toLowerCase() === n.toLowerCase()), 'Nhóm này đã có');
  db.groups.push(n);
});
act('group-rename', 'owner', b => {
  const i = db.groups.indexOf(b.old), n = str(b.name, 30);
  need(i >= 0, 'Không tìm thấy nhóm');
  need(GROUP_RE.test(n), 'Tên nhóm từ 2–30 ký tự');
  need(!db.groups.some((g, k) => k !== i && g.toLowerCase() === n.toLowerCase()), 'Nhóm này đã có');
  db.menu.forEach(m => { if (m.cat === b.old) m.cat = n; });
  db.groups[i] = n;
});
act('group-del', 'owner', b => {
  const n = db.menu.filter(m => m.cat === b.name).length;
  need(!n, 'Nhóm còn ' + n + ' món. Hãy chuyển món sang nhóm khác trước khi xóa.');
  db.groups = db.groups.filter(g => g !== b.name);
});
act('item-save', 'owner', b => {
  const it = cleanItem(b);
  if (b.id) {
    const m = db.menu.find(x => x.id === Number(b.id));
    need(m, 'Không tìm thấy món');
    Object.assign(m, it, { img: saveImage(b.img, m.img) });
  } else db.menu.push(Object.assign({ id: ++db.seq.menu, emoji: '🍽' }, it, { img: saveImage(b.img, '') }));
});
act('item-del', 'owner', b => {
  const m = db.menu.find(x => x.id === Number(b.id));
  need(m, 'Không tìm thấy món');
  saveImage('', m.img);
  db.menu = db.menu.filter(x => x !== m);
});
act('item-stock', 'owner', b => { const m = db.menu.find(x => x.id === Number(b.id)); need(m, 'Không tìm thấy món'); m.stock = !m.stock; });
act('menu-import', 'owner', b => {
  need(Array.isArray(b.items) && b.items.length && b.items.length <= 1000, 'File không có món hợp lệ');
  const keep = [];
  for (const raw of b.items) {
    const cat = str(raw.cat, 30);
    if (GROUP_RE.test(cat) && !db.groups.includes(cat)) db.groups.push(cat);
    const it = cleanItem(raw);
    const m = (raw.id && db.menu.find(x => x.id === Number(raw.id))) || db.menu.find(x => x.name.toLowerCase() === it.name.toLowerCase());
    if (m) { Object.assign(m, it); keep.push(m); }
    else { const n = Object.assign({ id: ++db.seq.menu, emoji: '🍽', img: '' }, it); db.menu.push(n); keep.push(n); }
  }
  if (b.mode === 'replace') { db.menu.filter(m => !keep.includes(m)).forEach(m => saveImage('', m.img)); db.menu = keep; }
  return { count: keep.length };
});

// Chủ quán: khuyến mãi
act('promo-save', 'owner', b => {
  const old = b.id ? db.promos.find(x => x.id === Number(b.id)) : null;
  need(!b.id || old, 'Không tìm thấy chương trình');
  const p = KM.clean(Object.assign({}, b, { id: old ? old.id : 0 }), db, need, str);
  if (old) { const id = old.id, used = old.used; for (const k of Object.keys(old)) delete old[k]; Object.assign(old, p, { id, used }); }
  else db.promos.push(Object.assign({ id: ++db.seq.promo, used: 0 }, p));
});
act('promo-toggle', 'owner', b => { const p = db.promos.find(x => x.id === Number(b.id)); need(p, 'Không tìm thấy chương trình'); p.on = !p.on; });
act('promo-del', 'owner', b => { need(db.promos.some(x => x.id === Number(b.id)), 'Không tìm thấy chương trình'); db.promos = db.promos.filter(x => x.id !== Number(b.id)); });
act('kitchen-cfg', 'owner', b => { // phiếu in cho bếp: tắt / bấm tay / tự in khi xác nhận đơn
  need(['off', 'manual', 'auto'].includes(b.mode), 'Chọn Tắt, Thủ công hoặc Tự động');
  db.kitchen = { mode: b.mode };
});
act('promo-cfg', 'owner', b => {
  const m = Number(b.manualMax); need(Number.isInteger(m) && m >= 0 && m <= 50, 'Mức giảm thủ công của nhân viên từ 0 đến 50%');
  db.promoCfg = { holiday: !!b.holiday, manualMax: m };
});

// Chủ quán: bàn
act('table-add', 'owner', b => {
  let t = str(b.t, 6).toUpperCase(); if (/^\d$/.test(t)) t = '0' + t;
  need(/^[A-Z0-9]{1,6}$/.test(t), 'Số bàn chỉ gồm chữ hoặc số, tối đa 6 ký tự');
  need(!db.tables.includes(t), 'Bàn ' + t + ' đã có');
  db.tables.push(t);
  db.tables.sort((a, b2) => { const x = +a, y = +b2; return isNaN(x) || isNaN(y) ? (isNaN(x) - isNaN(y) || a.localeCompare(b2)) : x - y; });
});
act('table-del', 'owner', b => {
  need(!db.orders.some(o => o.table === b.t && isOpen(o)), 'Bàn còn đơn chưa thanh toán');
  db.tables = db.tables.filter(t => t !== b.t); delete db.payReq[b.t];
});

// Chủ quán: nhân viên
act('staff-add', 'owner', b => {
  const name = str(b.name, 40), phone = str(b.phone, 10);
  need(NAME_RE.test(name), 'Họ tên từ 2–40 ký tự');
  need(PHONE_RE.test(phone), 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0');
  need(PW_RE.test(b.pw || ''), 'Mật khẩu 6–30 ký tự, gồm cả chữ và số');
  need(!db.staff.concat(db.owners).some(x => x.phone === phone), 'Số này đã có tài khoản');
  db.staff.push({ id: ++db.seq.staff, name, phone, role: b.role === 'quay' ? 'quay' : 'nv', active: true, pw: hashPw(b.pw) });
});
act('staff-toggle', 'owner', b => {
  const s = db.staff.find(x => x.id === Number(b.id)); need(s, 'Không tìm thấy nhân viên');
  s.active = !s.active;
  if (!s.active) { killSessions('staff', s.id); for (const [k, v] of Object.entries(db.codes)) if (v.staffId === s.id) delete db.codes[k]; }
});
act('staff-reset-pw', 'owner', b => {
  const s = db.staff.find(x => x.id === Number(b.id)); need(s, 'Không tìm thấy nhân viên');
  need(PW_RE.test(b.pw || ''), 'Mật khẩu 6–30 ký tự, gồm cả chữ và số');
  s.pw = hashPw(b.pw); killSessions('staff', s.id);
});
act('staff-revoke', 'owner', b => { for (const [k, v] of Object.entries(db.codes)) if (v.staffId === Number(b.id)) delete db.codes[k]; });

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const VENDOR = { 'qrcode.js': 'qrcode-generator/qrcode.js', 'xlsx.js': 'xlsx/dist/xlsx.full.min.js', 'exceljs.js': 'exceljs/dist/exceljs.min.js' };

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Không tìm thấy'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((ok, no) => {
    const parts = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > 3e6) { no(new E('Dữ liệu gửi lên quá lớn', 413)); req.destroy(); } else parts.push(d); });
    req.on('end', () => { try { ok(n ? JSON.parse(Buffer.concat(parts)) : {}); } catch (e) { no(new E('Dữ liệu không hợp lệ')); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname, net = netKind(req.socket.remoteAddress);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (net === 'out') { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Chỉ dùng được trong WiFi của quán.'); }
  try {
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: ' + db.ver + '\n\n'); clients.add(res);
      const hb = setInterval(() => res.write(': hb\n\n'), 25e3);
      return req.on('close', () => { clearInterval(hb); clients.delete(res); });
    }
    if (p === '/api/device') {
      if (!getUser(req, 'owner')) throw new E('Chỉ chủ quán xem được', 401);
      return json(res, 200, deviceInfo());
    }
    if (p === '/api/state') {
      const as = url.searchParams.get('as');
      if (net === 'tailscale' && as !== 'owner') throw new E('Ngoài quán chỉ chủ quán đăng nhập được', 403);
      return json(res, 200, stateFor(as, { req, net }, url.searchParams));
    }
    if (p.startsWith('/api/a/') && req.method === 'POST') {
      const a = A[p.slice(7)];
      if (!a) throw new E('Không có thao tác này', 404);
      const c = { req, res, ip: String(req.socket.remoteAddress), net };
      if (net === 'tailscale' && !['owner', 'owner-net', 'staffOrOwner', 'quayOrOwner'].includes(a.who)) throw new E('Ngoài quán chỉ chủ quán dùng được', 403);
      if (a.who === 'local') need(net === 'local', 'Chỉ làm được ngay trên máy tính của quán');
      if (a.who === 'staff' || a.who === 'staffOrOwner' || a.who === 'quayOrOwner') c.user = getUser(req, 'staff');
      if (a.who === 'quayOrOwner' && c.user && c.user.role !== 'quay') c.user = null;
      if (a.who === 'owner' || ((a.who === 'staffOrOwner' || a.who === 'quayOrOwner') && !c.user)) c.user = getUser(req, 'owner');
      if (['staff', 'owner', 'staffOrOwner', 'quayOrOwner'].includes(a.who) && !c.user) throw new E('Phiên đăng nhập đã hết hoặc không có quyền. Hãy đăng nhập lại.', 401);
      if (a.who === 'quayOrOwner' && net === 'tailscale' && c.user.role) throw new E('Ngoài quán chỉ chủ quán dùng được', 403);
      const body = await readBody(req);
      const out = a.fn(body, c) || {};
      commit();
      return json(res, 200, Object.assign({ ok: true }, out));
    }
    if (p.startsWith('/vendor/')) { const v = VENDOR[path.basename(p)]; return v ? sendFile(res, path.join(ROOT, 'node_modules', v)) : json(res, 404, {}); }
    if (p.startsWith('/anh/')) return sendFile(res, path.join(IMG_DIR, path.basename(p)));
    if (p === '/manifest.webmanifest') return sendFile(res, path.join(ROOT, 'public', 'manifest.webmanifest'));
    if (/^\/(icon(-180|-512)?\.(svg|png)|missing-logo\.js)$/.test(p)) return sendFile(res, path.join(ROOT, 'public', p.slice(1)));
    if (p === '/' || p === '/nhanvien' || p === '/chuquan') return sendFile(res, path.join(ROOT, 'public', 'index.html'));
    res.writeHead(404); res.end('Không tìm thấy');
  } catch (e) {
    if (!(e instanceof E)) console.error(e);
    json(res, e.code || 500, { error: e instanceof E ? e.message : 'Lỗi máy chủ, hãy thử lại' });
  }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  MAO · Missing App Order — phần mềm gọi món QR đang chạy');
    console.log('  Máy quầy (nhân viên):  ' + lanUrl() + '/nhanvien');
    console.log('  Chủ quán:              ' + lanUrl() + '/chuquan');
    console.log('  Dữ liệu lưu tại:       ' + DB_FILE);
    console.log('\n  Giữ cửa sổ này mở trong giờ bán. Đóng cửa sổ là tắt phần mềm.\n');
  });
}
module.exports = { server, netKind, diffItems, flat, lanUrl, PORT, DATA, get db() { return db; } };

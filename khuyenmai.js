'use strict';
// Khuyến mãi MAO. Không phụ thuộc gói ngoài, không sửa dữ liệu: chỉ nhận chương trình + thực đơn + các dòng món, trả kết quả tính.
// 3 tầng: (1) giá món, (2) hóa đơn: chọn 1 chương trình lợi nhất, (3) mã giảm giá và thẻ tích ly. Tổng giảm không quá 50% giá gốc, trừ dịp Tết/lễ.
const TYPES = ['item', 'bxy', 'bab', 'nth', 'combo', 'gift', 'pct', 'amt', 'code', 'card'];
const T1 = ['item', 'bxy', 'bab', 'nth', 'combo'], T2 = ['gift', 'pct', 'amt'];
const VN = 7 * 3600e3; // giờ Việt Nam (UTC+7), không cần ICU nên chạy được cả trên Android
const vn = at => new Date(at + VN);
const dayStr = at => vn(at).toISOString().slice(0, 10);

function timeOk(p, at) {
  const d = vn(at), t = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (p.days && p.days.length && !p.days.includes(d.getUTCDay())) return false;
  if (p.h1 == null || p.h2 == null) return true;
  return p.h1 < p.h2 ? t >= p.h1 && t < p.h2 : t >= p.h1 || t < p.h2;
}
const live = (p, o) => p.on && (o.ignoreQuota || !p.quota || p.used < p.quota) && (!p.until || p.until >= dayStr(o.at));

function quote(ctx, lines, o) {
  o = Object.assign({ at: Date.now() }, o);
  const { menu, cfg } = ctx, promos = ctx.promos || [], mi = id => menu.find(x => x.id === id);
  const ok = p => ({ gift: () => mi(p.gi), bxy: () => mi(p.bi), bab: () => mi(p.a) && mi(p.b), item: () => p.tgt[0] === 'c' || mi(+p.tgt.slice(2)),
    combo: () => p.items.every(i => mi(i.id)), card: () => p.ids.some(mi) }[p.type] || (() => true))();
  const el = p => ok(p) && live(p, o) && timeOk(p, o.at);

  const U = [];
  lines.forEach((l, li) => { const m = menu.find(x => x.name === l.name); for (let i = 0; i < l.q; i++) U.push({ li, id: m ? m.id : 0, p: l.price, cat: m ? m.cat : '', d: 0, by: null }); });
  const sub = U.reduce((a, u) => a + u.p, 0), free = f => U.filter(u => u.by === null && f(u));
  const R = { sub, gifts: [], applied: [], codeMsg: '', adj: 0, manualV: 0, hint: '', stamp: null };

  const t1 = (p, V) => { // các dòng được giảm của một chương trình tầng 1: [{u, d}]
    const out = [], f = (V || U).filter(u => u.by === null);
    if (p.type === 'item') f.filter(u => p.tgt[0] === 'c' ? u.cat === p.tgt.slice(2) : u.id === +p.tgt.slice(2)).forEach(u => {
      const d = p.mode === 'pct' ? Math.round(u.p * p.v / 100) : Math.max(0, u.p - p.v); if (d > 0) out.push({ u, d }); });
    if (p.type === 'bxy') { const A = f.filter(u => u.id === p.bi); A.slice(0, Math.floor(A.length / p.bx) * (p.bx - p.by)).forEach(u => out.push({ u, d: u.p })); }
    if (p.type === 'bab' && p.a !== p.b) { const A = f.filter(u => u.id === p.a), B = f.filter(u => u.id === p.b); let s = Math.floor(A.length / p.m); if (p.k) s = Math.min(s, p.k);
      B.slice(0, s).forEach(u => out.push({ u, d: Math.round(u.p * p.p / 100) })); }
    if (p.type === 'nth') { const C = f.filter(u => u.cat === p.cat).sort((x, y) => y.p - x.p); for (let i = p.n - 1; i < C.length; i += p.n) out.push({ u: C[i], d: Math.round(C[i].p * p.p / 100) }); }
    if (p.type === 'combo') {
      const P = p.items.map(it => f.filter(u => u.id === it.id)), s = Math.min(...p.items.map((it, i) => Math.floor(P[i].length / it.q)));
      const list = p.items.reduce((a, it) => a + mi(it.id).price * it.q, 0), save = list - p.price;
      if (s > 0 && save > 0) p.items.forEach((it, i) => P[i].slice(0, s * it.q).forEach(u => out.push({ u, d: Math.round(u.p * save / list) })));
    }
    return out;
  };
  const val = (p, V) => t1(p, V).reduce((a, x) => a + x.d, 0);
  const fresh = () => U.map(u => ({ id: u.id, p: u.p, cat: u.cat, by: null }));

  // thẻ tích ly: ly miễn phí lợi hơn giảm %, nên lấy trước
  const cp = promos.find(p => p.type === 'card' && el(p)), have = (o.phone && ctx.stamps && ctx.stamps[o.phone]) || 0;
  if (cp && o.phone && have >= cp.n) {
    const cu = free(u => cp.ids.includes(u.id)).sort((a, b) => a.p - b.p)[0];
    if (cu) { cu.d = cu.p; cu.by = cp; }
  }
  // tầng 1: chương trình lợi nhất áp trước, mỗi ly/món chỉ nhận 1 chương trình
  promos.filter(p => T1.includes(p.type) && el(p)).map(p => ({ p, v: val(p, fresh()) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v)
    .forEach(({ p }) => t1(p).forEach(({ u, d }) => { u.d = d; u.by = p; }));
  const by = {}; U.filter(u => u.by).forEach(u => { const k = u.by.id; (by[k] = by[k] || { id: k, name: u.by.name, v: 0 }).v += u.d; });
  R.applied.push(...Object.values(by));
  const t1v = U.reduce((a, u) => a + u.d, 0), base = sub - t1v;

  // tầng 2: hóa đơn, chọn 1
  let best = null;
  if (base > 0) promos.filter(p => T2.includes(p.type) && el(p) && base >= (p.min || 0)).forEach(p => {
    const v = Math.round(p.type === 'gift' ? mi(p.gi).price * p.gq : p.type === 'pct' ? Math.min(base * p.p / 100, p.cap || 1e12) : Math.min(p.a, base));
    if (!best || v > best.v) best = { p, v };
  });
  const t2m = best && best.p.type !== 'gift' ? best.v : 0;

  // tầng 3: mã giảm giá (mặc định không cộng dồn với tầng 2, lấy cái lợi hơn)
  let codeV = 0, codeP = null;
  const code = String(o.code || '').trim().toUpperCase();
  if (code) {
    const p = promos.find(x => x.type === 'code' && x.code === code);
    if (!p) R.codeMsg = 'Mã không tồn tại.';
    else if (!live(p, o)) R.codeMsg = 'Mã đã hết lượt hoặc hết hạn.';
    else if (!timeOk(p, o.at)) R.codeMsg = 'Mã chưa tới khung giờ hoặc ngày áp dụng.';
    else if (base < p.min) R.codeMsg = 'Mã dùng cho bill từ ' + p.min.toLocaleString('vi-VN') + 'đ, còn thiếu ' + (p.min - base).toLocaleString('vi-VN') + 'đ.';
    else {
      const v = Math.round(p.mode === 'pct' ? (base - t2m) * p.v / 100 : Math.min(p.v, base - t2m));
      if (p.stack || !best) { codeV = v; codeP = p; if (p.stack) R.codeMsg = 'Mã được cộng dồn.'; }
      else if (v > best.v) { codeV = v; codeP = p; R.codeMsg = 'Mã lợi hơn "' + best.p.name + '", dùng mã thay cho chương trình đó.'; best = null; }
      else R.codeMsg = 'Mã không cộng dồn, "' + best.p.name + '" lợi hơn nên giữ chương trình đó.';
    }
  }
  const t2fin = best && best.p.type !== 'gift' ? best.v : 0;
  if (best) { R.applied.push({ id: best.p.id, name: best.p.name, v: best.p.type === 'gift' ? 0 : best.v });
    if (best.p.type === 'gift') R.gifts.push({ name: mi(best.p.gi).name, q: best.p.gq, by: best.p.name }); }
  if (codeP) R.applied.push({ id: codeP.id, name: 'Mã ' + codeP.code, v: codeV, code: codeP.code });

  // trần 50% giá gốc (Thông tư 39/2025/TT-BCT), trừ dịp Tết/lễ do chủ quán bật
  // ly đổi bằng thẻ tích ly là phần thưởng khách hàng thân thiết, không tính vào trần
  const cardV = U.filter(u => cp && u.by === cp).reduce((a, u) => a + u.d, 0), money = t1v - cardV + t2fin + codeV;
  R.adj = !(cfg && cfg.holiday) && money > sub * .5 ? Math.round(money - sub * .5) : 0;
  const after = money - R.adj + cardV;
  if (o.manual) {
    R.manualV = Math.round((sub - after) * o.manual.pct / 100);
    if (!(cfg && cfg.holiday)) R.manualV = Math.min(R.manualV, Math.max(0, Math.round(sub * .5 - (after - cardV))));
  }
  R.disc = after + R.manualV; R.total = sub - R.disc;
  R.lines = lines.map((l, li) => { const m = {}; U.filter(u => u.li === li && u.by).forEach(u => { (m[u.by.id] = m[u.by.id] || { id: u.by.id, name: u.by.name, d: 0 }).d += u.d; });
    return { name: l.name, q: l.q, price: l.price, disc: Object.values(m) }; });
  R.itemDisc = t1v;
  // thẻ tích ly: số ly tích thêm sau đơn này
  if (cp && o.phone) { const redeem = U.some(u => u.by === cp) ? cp.n : 0, earn = U.filter(u => cp.ids.includes(u.id) && u.by !== cp).length;
    R.stamp = { phone: o.phone, have, n: cp.n, earn, redeem, after: have + earn - redeem, promo: cp.id }; }
  // gợi ý "mua thêm … để được …"
  const nx = promos.filter(p => T2.includes(p.type) && el(p) && (p.min || 0) > base).sort((a, b) => a.min - b.min)[0];
  if (nx) R.hint = 'Mua thêm ' + (nx.min - base).toLocaleString('vi-VN') + 'đ để được ' + (nx.type === 'gift' ? 'tặng ' + nx.gq + ' ' + mi(nx.gi).name : nx.type === 'pct' ? 'giảm ' + nx.p + '%' : 'giảm ' + nx.a.toLocaleString('vi-VN') + 'đ');
  return R;
}

// Kiểm tra và làm sạch chương trình từ giao diện chủ quán. need(đúng, lời báo lỗi) và str(giá trị, độ dài) do server truyền vào.
function clean(b, db, need, str) {
  const int = (v, lo, hi, msg) => { const n = Number(v); need(Number.isInteger(n) && n >= lo && n <= hi, msg); return n; };
  const mid = (v, msg) => { const n = Number(v); need(db.menu.some(m => m.id === n), msg || 'Món không còn trong thực đơn'); return n; };
  const type = b.type; need(TYPES.includes(type), 'Loại khuyến mãi không hợp lệ');
  const name = str(b.name, 60); need(name.length >= 2, 'Tên chương trình từ 2–60 ký tự');
  const p = { type, name, on: b.on !== false, quota: int(b.quota || 0, 0, 100000, 'Số đơn áp dụng từ 0 đến 100.000'), until: str(b.until, 10) };
  need(!p.until || /^\d{4}-\d{2}-\d{2}$/.test(p.until), 'Ngày hết hạn không hợp lệ');
  p.days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))]; need(p.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6), 'Ngày trong tuần không hợp lệ');
  const hv = v => v === '' || v == null ? null : int(v, 0, 24, 'Giờ từ 0 đến 24');
  p.h1 = hv(b.h1); p.h2 = hv(b.h2);
  need((p.h1 == null) === (p.h2 == null), 'Hãy nhập đủ cả giờ bắt đầu và giờ kết thúc, hoặc để trống cả hai');
  need(p.h1 == null || p.h1 !== p.h2, 'Giờ bắt đầu và kết thúc không được trùng nhau');
  const money = (v, msg) => int(v, 0, 1e8, msg || 'Số tiền từ 0 đến 100.000.000đ'), pct = v => int(v, 1, 100, 'Phần trăm từ 1 đến 100');
  if (T2.includes(type)) p.min = money(b.min, 'Mức bill tối thiểu không hợp lệ');
  if (type === 'gift') { p.gi = mid(b.gi, 'Chọn món để tặng'); p.gq = int(b.gq, 1, 20, 'Số phần tặng từ 1 đến 20'); }
  if (type === 'pct') { p.p = pct(b.p); p.cap = money(b.cap || 0); }
  if (type === 'amt') { p.a = int(b.a, 1000, 1e8, 'Số tiền giảm từ 1.000đ'); }
  if (type === 'item') { const t = str(b.tgt, 40); need(/^(c:.+|i:\d+)$/.test(t), 'Chọn món hoặc danh mục'); if (t[0] === 'c') need(db.groups.includes(t.slice(2)), 'Danh mục không tồn tại'); else mid(t.slice(2));
    p.tgt = t; p.mode = b.mode === 'fix' ? 'fix' : 'pct'; p.v = p.mode === 'pct' ? pct(b.v) : money(b.v); }
  if (type === 'bxy') { p.bi = mid(b.bi); p.bx = int(b.bx, 2, 20, 'Số lượng mua từ 2 đến 20'); p.by = int(b.by, 1, p.bx - 1, 'Số lượng tính tiền phải nhỏ hơn số lượng mua'); }
  if (type === 'bab') { p.a = mid(b.a); p.b = mid(b.b); need(p.a !== p.b, 'Món A và món B phải khác nhau (muốn cùng món thì dùng "Mua X tính Y")'); p.m = int(b.m, 1, 20, 'Số lượng món A từ 1 đến 20'); p.p = pct(b.p); p.k = int(b.k || 0, 0, 20, 'Số lần tối đa từ 0 đến 20'); }
  if (type === 'nth') { need(db.groups.includes(str(b.cat, 30)), 'Danh mục không tồn tại'); p.cat = str(b.cat, 30); p.n = int(b.n, 2, 20, 'Món thứ N từ 2 đến 20'); p.p = pct(b.p); }
  if (type === 'combo') { need(Array.isArray(b.items) && b.items.length >= 2 && b.items.length <= 6, 'Combo gồm 2 đến 6 món');
    p.items = b.items.map(i => ({ id: mid(i.id), q: int(i.q, 1, 20, 'Số lượng mỗi món trong combo từ 1 đến 20') })); p.price = money(b.price);
    const list = p.items.reduce((a, i) => a + db.menu.find(m => m.id === i.id).price * i.q, 0); need(p.price > 0 && p.price < list, 'Giá combo phải nhỏ hơn tổng giá lẻ (' + list.toLocaleString('vi-VN') + 'đ)'); }
  if (type === 'code') { p.code = str(b.code, 20).toUpperCase(); need(/^[A-Z0-9]{3,20}$/.test(p.code), 'Mã gồm 3–20 chữ cái không dấu hoặc số');
    need(!db.promos.some(x => x.type === 'code' && x.code === p.code && x.id !== b.id), 'Mã này đã có');
    p.mode = b.mode === 'amt' ? 'amt' : 'pct'; p.v = p.mode === 'pct' ? pct(b.v) : int(b.v, 1000, 1e8, 'Số tiền giảm từ 1.000đ'); p.min = money(b.min || 0); p.stack = !!b.stack; }
  if (type === 'card') { need(!db.promos.some(x => x.type === 'card' && x.id !== b.id), 'Quán chỉ dùng được một thẻ tích ly'); p.n = int(b.n, 2, 50, 'Số ly để đổi từ 2 đến 50');
    need(Array.isArray(b.ids) && b.ids.length >= 1, 'Chọn các món được tích'); p.ids = [...new Set(b.ids.map(Number))]; p.ids.forEach(i => mid(i)); }
  return p;
}
module.exports = { quote, clean, timeOk, TYPES };

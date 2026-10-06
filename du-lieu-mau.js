// Dữ liệu mẫu để chạy thử: node server.js --mau (chỉ dùng khi chưa có dữ liệu)
'use strict';
module.exports = function (db, hashPw) {
  let a = 20261006; // số ngẫu nhiên cố định: lần nào tạo cũng ra cùng một bộ dữ liệu
  const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = x => x[Math.floor(r() * x.length)], rint = (x, y) => x + Math.floor(r() * (y - x + 1)), p2 = n => String(n).padStart(2, '0');
  const tot = l => l.reduce((s, x) => s + x.q * x.price, 0);

  db.shop = { name: 'Quán Demo', addr: '12 Lê Lợi, Tây Ninh', phone: '0900000000', bank: 'Vietcombank', acc: '0123456789', holder: 'NGUYEN VAN A' };
  db.groups = ['Khai vị', 'Món chính', 'Cơm', 'Bún & Phở', 'Lẩu', 'Đồ uống', 'Tráng miệng'];
  const M = [['Khai vị', 'Gỏi cuốn', 25000, '🥗'], ['Khai vị', 'Chả giò', 35000, '🥟'], ['Khai vị', 'Khoai tây chiên', 30000, '🍟'], ['Khai vị', 'Gỏi ngó sen', 45000, '🥗'],
    ['Món chính', 'Gà nướng muối ớt', 120000, '🍗'], ['Món chính', 'Cá kho tộ', 60000, '🐟'], ['Món chính', 'Sườn nướng', 85000, '🍖'], ['Món chính', 'Mực xào sa tế', 95000, '🦑'], ['Món chính', 'Bò lúc lắc', 110000, '🥩'],
    ['Cơm', 'Cơm gà xối mỡ', 45000, '🍗'], ['Cơm', 'Cơm tấm sườn bì chả', 50000, '🍛'], ['Cơm', 'Cơm chiên dương châu', 45000, '🍚'], ['Cơm', 'Cơm bò lúc lắc', 65000, '🍛'],
    ['Bún & Phở', 'Bún bò Huế', 50000, '🍜'], ['Bún & Phở', 'Phở bò tái', 55000, '🍜'], ['Bún & Phở', 'Bún chả Hà Nội', 50000, '🍜'], ['Bún & Phở', 'Hủ tiếu Nam Vang', 50000, '🍜'],
    ['Lẩu', 'Lẩu thái hải sản', 250000, '🍲'], ['Lẩu', 'Lẩu gà lá é', 220000, '🍲'], ['Lẩu', 'Lẩu bò nhúng giấm', 280000, '🍲'],
    ['Đồ uống', 'Trà đá', 5000, '🧊'], ['Đồ uống', 'Nước cam', 30000, '🍊'], ['Đồ uống', 'Cà phê sữa đá', 25000, '☕'], ['Đồ uống', 'Trà đào cam sả', 35000, '🍑'], ['Đồ uống', 'Nước ngọt lon', 15000, '🥤'], ['Đồ uống', 'Bia lon', 20000, '🍺'], ['Đồ uống', 'Sinh tố bơ', 40000, '🥑'],
    ['Tráng miệng', 'Chè khúc bạch', 30000, '🍮'], ['Tráng miệng', 'Bánh flan', 15000, '🍮'], ['Tráng miệng', 'Trái cây dĩa', 45000, '🍉']];
  db.menu = M.map((x, i) => ({ id: i + 1, cat: x[0], name: x[1], price: x[2], emoji: x[3], stock: ![5, 19, 26].includes(i), img: '' }));
  db.seq.menu = M.length;
  db.tables = Array.from({ length: 15 }, (_, i) => p2(i + 1));

  db.owners = [{ id: 1, name: 'Chủ quán', phone: '0900000000', pw: hashPw('chu123456'), recovery: hashPw('DEMO-DEMO-DEMO') }];
  db.seq.owner = 1;
  const S = [['Lan', '0901111222', 'quay', 'lan123456', true], ['Tuấn', '0902333444', 'nv', 'tuan123456', true], ['Hùng', '0903555666', 'quay', 'hung123456', true],
    ['Mai', '0904777888', 'nv', 'mai123456', true], ['Phúc', '0905999000', 'nv', 'phuc123456', false]];
  db.staff = S.map((s, i) => ({ id: i + 1, name: s[0], phone: s[1], role: s[2], pw: hashPw(s[3]), active: s[4] }));
  db.seq.staff = S.length;

  const quay = ['Lan', 'Hùng'], nv = ['Tuấn', 'Mai', 'Lan', 'Hùng'];
  const drinks = db.menu.filter(m => m.cat === 'Đồ uống'), food = db.menu.filter(m => m.cat !== 'Đồ uống');
  const items = () => {
    const it = {};
    for (let k = rint(1, 4); k > 0; k--) { const m = pick(food); it[m.id] = (it[m.id] || 0) + rint(1, 2); }
    for (let k = rint(0, 3); k > 0; k--) { const w = pick(drinks); it[w.id] = (it[w.id] || 0) + rint(1, 4); }
    return Object.keys(it).map(id => { const m = db.menu[id - 1]; return { name: m.name, q: it[id], price: m.price }; });
  };
  const list = [], today = new Date(); today.setHours(0, 0, 0, 0);
  for (let d = 420; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 864e5), wk = day.getDay();
    const n = d <= 120 ? rint(5, 11) + (wk === 0 || wk === 6 ? rint(3, 6) : 0) : (r() < .35 ? rint(1, 4) : 0);
    for (let k = 0; k < n; k++) {
      const tm = new Date(day.getTime() + (600 + rint(0, 690)) * 60e3);
      if (tm > new Date()) continue;
      const its = items();
      list.push({ table: pick(db.tables), time: tm.toISOString(), items: its, total: tot(its), paidBy: pick(nv),
        orderStaff: r() < .7 ? 'Khách' : pick(nv), confirmStaff: pick(quay), servedStaff: pick(nv), prints: 1 });
    }
  }
  list.sort((x, y) => x.time < y.time ? -1 : 1);
  let no = 1000; list.forEach(i => { i.no = 'HD' + (++no); });
  db.invoices = list;
  for (const ix of [list.length - 3, list.length - 9, list.length - 25]) {
    const o = list[ix]; if (!o) continue;
    const ni = o.items.map(l => Object.assign({}, l)); ni[0].q += 1;
    const rev = Object.assign({}, o, { no: 'HD' + (++no), items: ni, total: tot(ni), from: o.no, note: 'Khách gọi thêm món sau khi tính tiền',
      changes: [ni[0].name + ': ' + (ni[0].q - 1) + ' → ' + ni[0].q], editedBy: 'Lan', editedAt: new Date(Date.parse(o.time) + 15 * 60e3).toISOString() });
    o.replacedBy = rev.no; db.invoices.push(rev);
  }
  db.seq.inv = no;

  db.orders = []; let seq = 500; const now = Date.now();
  [['02', 'cho', 3, 'Anh Minh'], ['03', 'lam', 12, 'Chị Hoa'], ['05', 'xong', 35, 'Anh Long'], ['07', 'xong', 48, 'Gia đình Tâm'], ['07', 'lam', 9, 'Gia đình Tâm'],
    ['09', 'cho', 1, 'Bạn Vy'], ['11', 'xong', 25, 'Anh Khoa'], ['12', 'lam', 15, 'Chị Ngọc']].forEach(x => {
    db.orders.push({ id: ++seq, table: x[0], name: x[3], by: 'Khách', takenBy: 'Khách', lines: items(),
      notes: r() < .4 ? [pick(['Ít cay', 'Không hành', 'Thêm đá', 'Không rau'])] : [], status: x[1], time: new Date(now - x[2] * 60e3).toISOString(),
      confirmedBy: x[1] !== 'cho' ? pick(quay) : undefined, servedBy: x[1] === 'xong' ? pick(nv) : undefined });
  });
  db.seq.order = seq;
  db.payReq = { '07': true, '11': true };
};

# MAO (Missing App Order) — Phần mềm gọi món QR

Hướng dẫn đầy đủ cho quán (có hình): **HUONG-DAN.pdf**. File này dành cho người bán và sửa phần mềm.

Có hai cách chạy:
- **Ứng dụng desktop** (giao cho quán): bộ cài `MAO-Setup.exe`, xem mục *Tạo bộ cài ứng dụng desktop* ở cuối.
- **Chạy bằng file .bat** (mục 1 bên dưới): cần cài Node.js, dùng để thử nhanh.

Phần mềm chạy trên **một máy tính Windows đặt tại quán** (máy chủ). Khách, nhân viên và chủ quán dùng **trình duyệt** trên điện thoại, máy tính bảng hoặc máy tính, không cần cài app.

- **Khách** quét mã QR trên bàn → xem thực đơn, gọi món, xem món đã gọi, báo thanh toán.
- **Nhân viên** quét mã vào ca ở máy quầy rồi nhập mật khẩu → nhận đơn, phục vụ, thanh toán, gọi món hộ khách.
- **Nhân viên quầy** có thêm quyền xác nhận/từ chối đơn, sửa hóa đơn, cấp mã vào ca cho nhân viên khác.
- **Chủ quán** quản lý menu, bàn, nhân viên, doanh thu, hóa đơn; dùng được cả khi ở ngoài quán (qua Tailscale).

Khách và nhân viên **bắt buộc dùng WiFi của quán**. Dữ liệu chỉ nằm trên máy tính của quán và **tự lưu ngay** sau mỗi thao tác.

---

## 1. Cài đặt (làm một lần, cần Internet)

1. Cài **Node.js bản LTS** tại https://nodejs.org (bấm Next đến hết).
2. Giải nén thư mục phần mềm vào ổ đĩa, ví dụ `D:\GoiMonQR`. Nên để ở ổ D: thay vì Desktop.
3. Bấm đúp **`chay-phan-mem.bat`**. Lần đầu sẽ tự tải thư viện (1–2 phút).
4. Nếu Windows hỏi cho phép qua tường lửa: chọn **Cho phép**, tích **Mạng riêng tư (Private)**.
   Nếu lỡ bấm từ chối: bấm chuột phải **`mo-tuong-lua.bat`** → *Run as administrator*.
5. Trình duyệt tự mở. Vào **Chủ quán đăng nhập** → **Tạo tài khoản quán** (chỉ làm được ngay trên máy này).
6. **Chép lại mã khôi phục** hiện ra và cất kỹ. Quên mật khẩu chủ quán thì cần mã này.

Cửa sổ màu đen phải **luôn mở** trong giờ bán. Đóng cửa sổ là tắt phần mềm.

## 2. Thiết lập quán

Trong **Chủ quán**:
1. **Cài đặt**: tên quán, **logo quán** (tùy chọn, in ở đầu hóa đơn), địa chỉ, số điện thoại (in trên hóa đơn), ngân hàng, số tài khoản, chủ tài khoản (để tạo mã chuyển khoản VietQR).
   → In thử một hóa đơn và **quét thử bằng app ngân hàng** để chắc chắn đúng tài khoản (đừng bấm chuyển).
2. **Menu**: tạo nhóm món, thêm món (có ảnh), hoặc **Nhập từ Excel** (bấm *Tải file mẫu* để có file mẫu).
3. **Bàn & QR**: tạo bàn, bấm **Xem / In QR** để in thẻ QR dán lên từng bàn.
4. **Nhân viên**: thêm nhân viên, chọn vai trò *Nhân viên* hoặc *Nhân viên quầy*, đặt mật khẩu ban đầu.

## 3. Cấu hình mạng (quan trọng)

- **Giữ địa chỉ IP cố định cho máy chủ**: vào trang quản lý router, mục *DHCP Reservation / Address Reservation*, gán cố định địa chỉ cho máy tính này. Nếu địa chỉ đổi, mã QR đã in sẽ không mở được. Địa chỉ hiện tại hiện trong cửa sổ đen (ví dụ `http://192.168.1.10:3000`).
- **Không để máy ngủ**: Settings → System → Power → *Sleep: Never*. Trong Device Manager → card mạng → Power Management: bỏ tích *Allow the computer to turn off this device*.
- Trên Windows, đặt mạng WiFi của quán là **Private (Riêng tư)**.
- **Khách và máy chủ phải chung một mạng WiFi.** Nếu router có WiFi khách (Guest) chặn các máy thấy nhau, hãy cho khách dùng chung mạng với máy chủ hoặc tắt "cách ly thiết bị" (AP/Client isolation).
- Nếu máy có nhiều card mạng và phần mềm hiện sai địa chỉ, đặt cố định bằng cách sửa dòng `node server.js` trong `chay-phan-mem.bat` thành `set LAN_IP=192.168.1.10&& node server.js %*`.

## 4. Sử dụng hằng ngày

| Ai | Mở địa chỉ | Ghi chú |
|---|---|---|
| Máy quầy | `http://localhost:3000/nhanvien` | Nhân viên quầy đăng nhập bằng số điện thoại + mật khẩu |
| Nhân viên | Quét **mã vào ca** ở máy quầy (mục *Tài khoản*) | Nhập mật khẩu của mình. Mã dùng 1 lần, hết hạn sau 5 phút |
| Khách | Quét mã QR trên bàn | Phải bắt WiFi quán |
| Chủ quán | `http://<địa chỉ máy chủ>:3000/chuquan` | Nên **Thêm vào màn hình chính** để dùng như app |

Luồng một bàn: khách gọi → **quầy xác nhận** → mang món ra, bấm **Đã phục vụ** → khách bấm **Thanh toán** (quầy nhận thông báo 🔔) → nhân viên **Thanh toán và in hóa đơn** (có mã QR chuyển khoản đúng số tiền). Chỉ món đã phục vụ mới được tính tiền.

In hóa đơn: hộp thoại in của trình duyệt sẽ hiện ra, chọn máy in nhiệt, khổ giấy 58mm.

## 5. Chủ quán dùng từ xa (Tailscale)

1. Cài **Tailscale** (https://tailscale.com) trên máy chủ và trên điện thoại chủ quán, đăng nhập **cùng một tài khoản**.
2. Trên máy chủ, mở Tailscale xem địa chỉ dạng `100.x.y.z`.
3. Trên điện thoại (bật Tailscale) mở `http://100.x.y.z:3000/chuquan` rồi **Thêm vào màn hình chính**. Địa chỉ này dùng được cả trong và ngoài quán.
- Qua Tailscale **chỉ chủ quán** đăng nhập được; khách và nhân viên luôn phải ở trong WiFi quán.
- Không bật chế độ *Exit node* trên máy chủ.

## 6. Dữ liệu và sao lưu

- Dữ liệu: `data\quan.json` (mọi thứ), ảnh món: `data\anh\`.
- Sao lưu tự động trên ổ đĩa máy chủ: `data\saoluu\` — mỗi giờ một bản (giữ 3 ngày) và mỗi ngày một bản (giữ 90 ngày).
- **Nên chép thư mục `data` ra USB hoặc Google Drive mỗi tuần.** Hỏng ổ cứng hay mất máy thì bản sao lưu trên cùng máy cũng mất theo.
- **Khôi phục**: tắt phần mềm, chép một file trong `data\saoluu\` đè lên `data\quan.json`, chạy lại.
- **Chuyển sang máy khác**: cài như mục 1 rồi chép cả thư mục `data` sang.

## 7. Chạy thử với dữ liệu mẫu

Bấm đúp **`chay-voi-du-lieu-mau.bat`** khi **chưa có** thư mục `data` (30 món, 15 bàn, hơn 1.300 hóa đơn). Tài khoản mẫu:

| Vai trò | Số điện thoại | Mật khẩu |
|---|---|---|
| Chủ quán | 0900000000 | chu123456 (mã khôi phục: `DEMO-DEMO-DEMO`) |
| Lan — quầy | 0901111222 | lan123456 |
| Hùng — quầy | 0903555666 | hung123456 |
| Tuấn — nhân viên | 0902333444 | tuan123456 |
| Mai — nhân viên | 0904777888 | mai123456 |

Thử xong, **xóa thư mục `data`** trước khi dùng thật.

## 8. Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Điện thoại quét QR không mở được | Kiểm tra điện thoại bắt đúng WiFi quán; máy chủ đang chạy; tường lửa đã cho phép (mục 1.4); IP máy chủ không đổi (mục 3) |
| Trang báo "Không kết nối được máy chủ" | Cửa sổ đen trên máy chủ bị tắt hoặc máy ngủ. Mở lại `chay-phan-mem.bat` |
| Không hiện mã QR / không xuất được Excel | Thư viện chưa tải xong: xóa thư mục `node_modules`, chạy lại `chay-phan-mem.bat` khi có Internet |
| Nhân viên bị đăng xuất | Phiên nhân viên hết hạn sau 8 tiếng hoặc 30 phút không có hoạt động; quét mã vào ca lại |
| Quên mật khẩu chủ quán | Trên máy chủ, mở `/chuquan` → *Quên mật khẩu* → nhập mã khôi phục |
| Quên mật khẩu nhân viên | Chủ quán vào *Nhân viên* → *Đặt lại MK* |

---

## Bộ cài tự động trên GitHub (Windows, macOS, Android)

Mỗi lần đẩy mã lên nhánh `main` của repo, GitHub Actions (`.github/workflows/bo-cai.yml`) tự chạy kiểm tra rồi tạo:
- `MAO-Setup-<phiên bản>.exe` (Windows, POS Windows)
- `MAO-<phiên bản>-mac-arm64.dmg`, `MAO-<phiên bản>-mac-x64.dmg` (macOS, chưa có chữ ký Apple)
- `MAO-<phiên bản>-android.apk` (Android, POS Android; Node.js nhúng bằng nodejs-mobile)

Tải ở mục **Releases → ban-moi-nhat** của repo. Đổi phiên bản: sửa `version` trong `package.json` và `versionCode`/`versionName` trong `android/app/build.gradle`.

App Android (`android/`): chế độ *máy chính* chạy `server.js` trong dịch vụ chạy nền (giữ WiFi, tự chạy khi bật máy), chế độ *kết nối* mở trang của máy chính. Khóa ký `android/app/mao-release.jks` phải giữ nguyên để bản sau cài đè được; giữ repo ở chế độ Private.

iPhone/iPad: không có app, dùng Safari → Thêm vào MH chính (Apple không cho chạy máy chủ ngầm và app ngoài App Store). Hướng dẫn chi tiết ở mục 11 của HUONG-DAN.pdf.

## Tạo bộ cài ứng dụng desktop (MAO-Setup.exe)

Làm trên một máy Windows có Internet, đã cài Node.js LTS:

1. Giải nén MAO.zip, bấm đúp **`tao-bo-cai.bat`** (lần đầu tải Electron, mất vài phút).
2. Xong, thư mục `dist` mở ra, có file **`MAO-Setup-1.1.0.exe`**. Đây là file giao cho quán.
3. Thử ngay trên máy đó: cài, mở MAO, tạo tài khoản, quét QR bằng điện thoại cùng WiFi, chọn máy in ở menu *Máy in hóa đơn* rồi in thử.

Chạy thử không cần tạo bộ cài: `npm install` rồi `npm run app`.

Ứng dụng desktop (thư mục `desktop/`):
- Chạy `server.js` ngay trong app, mở cửa sổ ở `http://127.0.0.1:3000/nhanvien` (được coi là "trên máy chủ").
- Dữ liệu ở `Documents\MAO\data` (gỡ app không mất). Dữ liệu mẫu: `"C:\Program Files\MAO\MAO.exe" --mau` khi chưa có thư mục đó.
- Bấm X chỉ thu xuống khay; thoát bằng menu *Thoát MAO* (có hỏi lại). Chỉ chạy một bản cùng lúc.
- Tự chạy khi bật máy (bật sẵn lần đầu). Bộ cài tự mở tường lửa (mạng Private/Domain) và xóa luật khi gỡ.
- In hóa đơn: chọn máy in trong menu thì in thẳng, không thì hiện hộp thoại. Đơn mới hiện thông báo Windows khi cửa sổ đang ẩn.
- Chưa có chữ ký số nên Windows hiện "Windows protected your PC" khi cài: *More info* → *Run anyway*. Muốn bỏ cảnh báo cần mua chứng thư ký mã (code signing) rồi khai báo trong `build.win` của `package.json`.

## Dành cho người sửa mã nguồn

```
server.js          Máy chủ (Node.js, không thư viện ngoài): lưu dữ liệu, đăng nhập, phân quyền, chặn ngoài WiFi, cập nhật tức thời (SSE)
public/index.html  Toàn bộ giao diện (khách /?ban=XX, nhân viên /nhanvien, chủ quán /chuquan)
du-lieu-mau.js     Bộ dữ liệu mẫu
test.js            Kiểm tra tự động luồng chính: node test.js
desktop/           Ứng dụng desktop (Electron): main.js, preload.js, icon
build/             Icon và script tường lửa cho bộ cài (electron-builder)
android/           App Android (Java + Node.js nhúng)
.github/workflows/ Tạo bộ cài tự động
tao-bo-cai.bat     Tạo MAO-Setup.exe
```

- Mọi quyền được kiểm tra **trên máy chủ** (`act(tên, ai_được_phép, ...)` trong `server.js`); giá món luôn lấy từ thực đơn trên máy chủ.
- Mật khẩu lưu dạng băm scrypt; phiên đăng nhập bằng cookie HttpOnly.
- Đổi cổng: `set PORT=8080` trước `node server.js`.
- Thư viện chỉ dùng ở trình duyệt (QR, Excel) được cài bằng `npm install` và phục vụ tại `/vendor/`, nên quán không cần Internet khi bán hàng.
- Giới hạn đã biết: dữ liệu là một file JSON ghi lại toàn bộ mỗi lần thay đổi, phù hợp một quán trong nhiều năm; nếu file vượt vài chục MB nên chuyển sang SQLite.

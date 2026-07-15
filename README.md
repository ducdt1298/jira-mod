# Jira Mod — Ẩn trường không bắt buộc

Chrome extension (Manifest V3) cho Jira Data Center (`insight.fsoft.com.vn/jiradc`). Khi mở dialog chuyển trạng thái (Resolve, Close, Reopen...), extension **mặc định chỉ hiện các trường bắt buộc (required)** và thêm một nút để bung các trường không bắt buộc khi cần — không phải scroll qua hàng loạt trường optional để tìm input required tiếp theo.

## Tính năng

- Tự động ẩn mọi trường **không bắt buộc** trong dialog transition.
- Nút **"Hiện các trường không bắt buộc (N)"** để bung/thu các trường optional.
- Tự động hiện lại trường vừa trở thành **bắt buộc động** (Jira Behaviours plugin) — không bao giờ để trường required bị ẩn.
- **Tự động điền mặc định khi Resolve bug**: nếu trường còn trống (chưa chọn) sẽ tự điền — Resolution = `Fixed`, Defect Origin = `Coding`, Defect Type = `Cod_Coding Standard`, Cause Category = `CAR_Carelessness`, Direct Cause of Defect = `Design thiếu mô tả hoặc mô tả chưa rõ`, Correction Action = `Check và fix theo đúng yêu cầu mô tả`. Chỉ áp dụng cho dialog có các trường defect (bug), điền **một lần** và **không** ghi đè giá trị bạn tự sửa. Sửa danh sách này ở mảng `AUTO_FILL` trong `content.js`.
- **Bố cục 2 cột khi Resolve bug**: nới rộng dialog và xếp `Direct Cause of Defect` + `Correction Action` ngang hàng (label nằm trên khung nhập).
- **✨ Gợi ý bằng AI**: nút trong hàng 2 cột gọi AI adapter cục bộ (mặc định `http://127.0.0.1:4924`) để sinh nội dung 2 trường `Direct Cause of Defect` và `Correction Action` (tiếng Việt, ngắn gọn) dựa trên Summary/Description của bug + Resolution/Defect Origin/Defect Type/Cause Category đang chọn. Bấm là **ghi đè** 2 trường. Trước mỗi lần gọi, extension **dò `/health`** (timeout ~5s) — nếu adapter chưa chạy hoặc chưa đăng nhập sẽ báo ngay dưới nút thay vì chờ hết timeout chat. Vì adapter không có CORS, mọi request đi qua **background service worker** (`background.js`) — cần `host_permissions` loopback `http://127.0.0.1/*` + `http://localhost/*` (đã khai trong `manifest.json`).
- **Popup — bảng điều khiển**: công tắc bật/tắt (lưu trạng thái, áp dụng ngay), cấu hình **Adapter URL** + **Timeout** cho AI, và nút **Kiểm tra kết nối** hiện trạng thái (đã kết nối / chưa đăng nhập / lỗi).

## Cài đặt (Load unpacked)

1. Mở Chrome, vào `chrome://extensions`.
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** → chọn thư mục `jira-mod` này.
4. Mở một issue trên Jira và bấm **Resolve** (hoặc transition khác).

## Cách hoạt động

- Nhận diện dialog transition qua nút submit `#issue-workflow-transition-submit` (nút này nằm ở footer, ngoài `<form>`, nên phải tìm form qua container dialog).
- Mỗi trường nằm trong `div.field-group`; trường **bắt buộc** là field-group chứa `span.icon-required`.
- Các trường không bắt buộc bị ẩn bằng CSS (`display:none`) — **không** disable input, nên validation và dữ liệu submit không bị ảnh hưởng.
- Một `MutationObserver` theo dõi DOM để xử lý dialog load qua AJAX và re-sync khi Behaviours đổi trạng thái required.

## Cấu trúc file

| File | Vai trò |
|------|---------|
| `manifest.json` | Manifest V3: content script, popup, background SW, icons, quyền `storage` + `host_permissions` loopback |
| `content.js` | Logic ẩn trường, nút toggle, re-sync động, auto-fill, bố cục 2 cột, pre-flight `/health` + nút AI, bật/tắt |
| `content.css` | Class ẩn trường + style nút toggle, bố cục 2 cột, thanh nút AI |
| `background.js` | Service worker: transport gọi AI adapter — chat (`aiSuggest`) + health (`aiHealth`), fetch/timeout/map lỗi, tránh CORS |
| `popup.html` / `popup.css` / `popup.js` | Popup bảng điều khiển: bật/tắt, cấu hình adapter URL/timeout, kiểm tra kết nối |
| `icons/` | Icon 16/32/48/128 px |

## Tác giả

DucDT15 — phiên bản 0.0.2

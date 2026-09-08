# Jira Mod

Chrome extension (Manifest V3) cho Jira Data Center. Hai việc chính:

1. **Dialog** (transition, Edit, Create) — mặc định chỉ hiện các trường **bắt buộc**, kèm nút bung các trường optional; trên dialog Resolve bug của FSOFT còn có auto-fill, bố cục 2 cột và gợi ý bằng AI.
2. **Agile board** — thêm thanh **lọc đầy đủ** (tìm kiếm + facet nhiều lựa chọn) bên cạnh Quick Filters vốn chỉ có vài option do board admin cấu hình sẵn.

Hỗ trợ nhiều instance Jira cùng lúc. Mỗi instance là một **site profile** (dữ liệu thuần) khai báo cần xử lý gì; phần logic không hề biết tới hostname.

| Instance | Dialog | Board |
|---|---|---|
| `insight.fsoft.com.vn` | transition — ẩn trường + auto-fill + 2 cột + nút mặc định + AI | tắt (bật bằng 1 block config) |
| `jira.fci.vn` | transition, Edit, Create — ẩn trường | **bật** — 5 facet + ẩn Done |

> **Vì sao FCI không có auto-fill/AI?** Toàn bộ instance FCI **không có transition screen nào** (dò REST `/transitions?expand=transitions.fields` trên SDC và các project bug nhiều nhất — XMO, FSEC, XDPAAS, XK8S, CTM: mọi transition đều 0 field, Jira chuyển thẳng không mở dialog), và các trường phân loại lỗi (`Defect Origin`, `Defect Type`, `Direct Cause of Defect`, `Correction Action`) **không tồn tại** trong field list của instance này. Chi tiết + cách bổ sung recipe: xem đầu file [`src/profiles/fci.js`](src/profiles/fci.js).

## Thanh lọc board

Jira chỉ cho lọc bằng các **Quick Filter** mà *board admin* đã tạo (board SDC có đúng 2: *Only My Issues*, *Recently Updated*), và thêm filter mới đòi quyền admin trên board dùng chung cả team. Thanh lọc này bù phần còn lại, chạy hoàn toàn phía client:

- **Ô tìm kiếm** theo issue key hoặc tiêu đề.
- **Facet nhiều lựa chọn**: Người nhận · Loại · Ưu tiên · Trạng thái · Epic. Mỗi giá trị kèm số lượng thẻ; trong một facet là **OR**, giữa các facet là **AND**.
- **Ẩn Done** một chạm, nút **Xoá lọc**, và bộ đếm `Hiện X/Y`.
- Swimlane không còn thẻ nào sẽ tự thu lại.

Nguyên tắc:

- **Chỉ lọc những gì board đang hiển thị** — nó *cộng dồn* với Quick Filter của Jira chứ không thay thế. Muốn thấy toàn bộ issue thì tắt Quick Filter của Jira như bình thường.
- **Không đụng vào cấu hình board.** Thẻ chỉ bị ẩn bằng CSS class; không sửa issue, sprint, hay board config — nên không ảnh hưởng ai khác trong team.
- Dữ liệu facet lấy từ chính endpoint board đang dùng (`/rest/greenhopper/1.0/xboard/work/allData.json`), một request GET cho mỗi board. Nếu request lỗi, thanh lọc **tự hạ cấp** xuống tìm kiếm theo key/tiêu đề thay vì biến mất.
- Thẻ chưa có trong index (issue vừa được thêm) **không bao giờ bị facet ẩn nhầm** — fail-open.

Phạm vi hiện tại: chế độ **Active sprints** (`#ghx-work`). Backlog dùng DOM và endpoint khác nên thanh lọc không xuất hiện ở đó.

## Cài đặt (Load unpacked)

1. Mở Chrome, vào `chrome://extensions`.
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** → chọn thư mục `jira-mod` này.
4. Mở một board, hoặc mở issue rồi bấm **Resolve** / **Edit** / **Create**.

Sau khi sửa `manifest.json`, phải bấm **Reload** ở `chrome://extensions`.

## Tính năng dialog

Lớp chung (mọi instance):

- Tự động ẩn mọi trường **không bắt buộc**; nút **"Hiện các trường không bắt buộc (N)"** để bung/thu.
- Tự động hiện lại trường vừa trở thành **bắt buộc động** (Jira Behaviours plugin).
- Không ẩn gì khi dialog **không có trường bắt buộc nào** (nếu bật `skipIfNoRequired`), tránh để lại form trống.

Lớp theo recipe (hiện chỉ FSOFT, dialog Resolve bug):

- **Auto-fill mặc định**: Resolution = `Fixed`, Defect Origin = `Coding`, Defect Type = `Cod_Coding Standard`, Cause Category = `CAR_Carelessness`, Direct Cause of Defect / Correction Action = câu mẫu. Chỉ điền khi trường còn trống, **một lần**, **không** ghi đè giá trị bạn tự sửa. Sửa ở `autoFill` trong [`src/profiles/fsoft.js`](src/profiles/fsoft.js).
- **Bố cục 2 cột** cho `Direct Cause of Defect` + `Correction Action`, dialog được nới rộng.
- **Nút "mặc định"** cạnh từng dropdown phân loại (ghi đè đúng trường đó).
- **✨ Gợi ý bằng AI**: gọi AI adapter cục bộ (mặc định `http://127.0.0.1:4924`) sinh giá trị cho 6 trường dựa trên Summary/Description. Trước mỗi lần gọi có **pre-flight `/health`** (~5s) để báo ngay nếu adapter chưa chạy / chưa đăng nhập. Adapter không có CORS nên mọi request đi qua **background service worker** ([`background.js`](background.js)).
- **Popup**: công tắc bật/tắt, Adapter URL + Timeout, nút Kiểm tra kết nối.

## Kiến trúc

```
profile (dữ liệu)  →  engine (điều phối)  →  features (hành vi)
```

Không có nhánh `if (site === ...)` ở bất kỳ đâu.

- **Surface** là *loại nơi* một feature sống: `dialog` (mỗi form đang mở) hoặc `board` (agile board). Engine biết cách tìm instance của từng surface và dựng context cho nó.
- **Feature** là object có `surface` + ba hàm: `config(ctx)` trả về cấu hình của nó **hoặc `null` để tự bỏ qua**, `apply(ctx, cfg)` (idempotent, chạy lại mỗi lần DOM đổi), `revert(root)`. Engine chỉ duyệt danh sách theo surface. **Một feature không chạy đơn giản vì profile không cấu hình nó** — đó là chỗ thay cho if/else.
- **Profile** khai báo `hosts`, `dialogs`, `hideOptional`, `board`, và `recipes`. Recipe là gói tự động hoá cho *một loại màn hình* (ví dụ "bug resolve"), khớp với form qua `markerLabels`.

Nguyên tắc quan trọng: **mọi trường được tìm theo label trước, `selector` chỉ là fallback.** Custom field ID không dùng chung được giữa các instance — trên FCI, đúng ba ID mà FSOFT dùng lại mang nghĩa hoàn toàn khác (`customfield_10219` = *Operational categorization*, không phải *Defect Origin*). Tìm theo ID trước sẽ ghi nhầm dữ liệu.

### Cấu trúc file

| File | Vai trò |
|------|---------|
| `manifest.json` | MV3: content scripts (**đúng thứ tự nạp**), popup, background SW, `host_permissions` loopback |
| `src/core/dom.js` | Lớp DOM site-agnostic: label, control, required, set/read giá trị, gom nhóm field |
| `src/core/profiles.js` | Registry profile, spec dialog dùng chung, khớp recipe với form |
| `src/core/features.js` | Registry feature (`register` / `bySurface`) |
| `src/core/ai.js` | AI: đọc context, dựng prompt từ `AiSpec`, parse/validate, ghi kết quả |
| `src/core/board.js` | Dữ liệu board: fetch `allData.json` → index `key → thuộc tính`, helper card/swimlane |
| `src/core/engine.js` | Surface (dialog/board), chạy pipeline, MutationObserver, công tắc bật/tắt |
| `src/features/dialog.js` | 6 feature dialog |
| `src/features/board.js` | Thanh lọc board |
| `src/profiles/fsoft.js` | Profile `insight.fsoft.com.vn` + recipe bug resolve |
| `src/profiles/fci.js` | Profile `jira.fci.vn` + cấu hình board |
| `src/boot.js` | Entry: chọn profile theo hostname rồi khởi động engine |
| `content.css` | Class ẩn trường, nút toggle, bố cục 2 cột, thanh AI, thanh lọc board |
| `background.js` | Service worker: gọi AI adapter — `aiSuggest` + `aiHealth` |
| `popup.html/.css/.js` | Popup |
| `test/smoke.js` | Test offline (Node, không cần trình duyệt) |

### Cách hoạt động

- Mỗi dialog nhận diện qua nút submit: `#issue-workflow-transition-submit`, `#issue-edit-submit`, `#issue-create-submit`. Với dialog transition, nút nằm ở footer **ngoài** `<form>`, nên phải đi ngược lên container dialog rồi mới lấy form.
- Container dialog khác nhau giữa các đời Jira DC (`.jira-dialog` ở 8.x, `.aui-dialog2`/`.jira-dialog2` ở bản mới) — khai báo **một lần** trong `dom.js`.
- Mỗi trường nằm trong `div.field-group`; trường **bắt buộc** chứa `span.icon-required`. Trường optional bị ẩn bằng CSS, **không** disable input, nên validation và dữ liệu submit không đổi.
- Board: thẻ là `.ghx-issue[data-issue-key]`, join với index từ `allData.json` để có assignee/type/priority/status/epic.
- Một `MutationObserver` (debounce 50ms) theo dõi DOM: xử lý dialog load qua AJAX, re-sync khi Behaviours đổi trạng thái required, và áp lại filter khi board vẽ lại.

## Thêm một Jira mới

Tạo `src/profiles/<ten>.js`, rồi thêm file đó vào `content_scripts.js` và host vào `matches` trong `manifest.json`:

```js
JiraMod.profiles.register({
  id: "acme",
  label: "ACME Jira",
  hosts: ["jira.acme.com"],
  dialogs: [D.transition, D.edit],
  hideOptional: { skipIfNoRequired: true },
  board: { facets: ["assignee", "type", "status"], hideDoneToggle: true },
  recipes: []   // thêm khi biết label/field thật của instance đó
});
```

Không cần sửa `engine.js`, `features/*` hay `dom.js`. Shape đầy đủ của profile/recipe ở đầu [`src/core/profiles.js`](src/core/profiles.js), của `AiSpec` ở đầu [`src/core/ai.js`](src/core/ai.js), danh sách facet ở `FACETS` trong [`src/features/board.js`](src/features/board.js).

## Test

```bash
node test/smoke.js
```

Chạy offline với DOM stub: phân giải profile theo host, hình dạng profile, khớp recipe, registry + cổng bật/tắt của từng feature, build index board, luật lọc (AND/OR, fail-open, fallback), prompt AI và validation. Không cần Chrome, không gọi mạng.

## Tác giả

DucDT15 — phiên bản 0.2.0

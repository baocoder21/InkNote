# InkNote - Các phase thực hiện

> Tài liệu để bạn duyệt trước khi bắt đầu. Mỗi phase nhỏ, có mục tiêu học rõ ràng, có kết quả chạy được và cách kiểm tra.
> Quy tắc: xong một phase thì **dừng lại**, tôi tóm tắt, bạn hỏi, rồi mới sang phase tiếp. Ghi chú học được lưu vào `docs/LEARNING.md`.
> Trạng thái: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong.

## Tổng quan

| Giai đoạn | Phase | Nội dung | Trạng thái |
|---|---|---|---|
| Nền tảng | 0 | Môi trường và khung dự án | [x] |
| MVP | 1 | Backend cơ bản: API + PostgreSQL | [x] |
| MVP | 2 | Frontend cơ bản: Angular + gọi API | [x] |
| MVP | 3 | Editor Markdown và preview | [x] |
| MVP | 4 | Notebook và Tag | [x] |
| MVP | 5 | Xác thực người dùng (Auth) | [x] |
| MVP | 6 | Tìm kiếm full-text | [~] chờ bạn kiểm tra |
| v1 | 7 | Local-first: lưu offline và hàng đợi đồng bộ | [ ] |
| v1 | 8 | Đồng bộ real-time bằng SignalR | [ ] |
| v1 | 9 | PWA (cài đặt như app desktop) | [ ] |
| v1 | 10 | File đính kèm | [ ] |
| v1 | 11 | Lịch sử phiên bản, thùng rác, import/export | [ ] |
| Hoàn thiện | 12 | Kiểm thử, Docker, CI/CD, nâng cấp .NET 10 | [ ] |
| v2 (tùy chọn) | 13+ | Chia sẻ link, cộng tác real-time (Yjs), E2EE, plugin/theme | [ ] |

Thứ tự được sắp để **mỗi phase dựa trên phase trước và luôn có thứ chạy được** để bạn thấy kết quả sớm. Auth để ở phase 5 (sau khi đã hiểu CRUD) để bạn học từng thứ một; đổi lại sẽ phải thêm lọc theo `UserId` vào code cũ, và đó cũng là một bài học về refactor.

---

## Phase 0 - Môi trường và khung dự án

- **Mục tiêu:** Máy chạy được cả backend và frontend, repo có cấu trúc đúng như `CLAUDE.md`.
- **Sẽ học:** Git cơ bản; .NET SDK, solution/project là gì; Angular CLI, workspace; Docker chạy PostgreSQL; khái niệm CORS.
- **Việc làm:**
  - Cài/kiểm tra: .NET 9 SDK, Node.js LTS, Angular CLI, Docker Desktop, Git.
  - `git init`, `.gitignore`, commit đầu tiên.
  - Tạo `src/backend` (solution + project API), `src/frontend` (Angular 22).
  - `docker-compose.yml` chạy PostgreSQL.
  - Endpoint `GET /api/health`; trang Angular gọi endpoint đó và hiển thị kết quả (bật CORS).
- **Kết quả:** Mở trang Angular thấy dòng "API OK" lấy từ backend.
- **Kiểm tra:** `dotnet run`, `ng serve`, `docker compose up -d`; truy cập hai địa chỉ.
- **Cập nhật:** `PROJECT_MAP.md`.

## Phase 1 - Backend cơ bản: API + PostgreSQL

- **Mục tiêu:** CRUD cho Note qua REST API, lưu trong PostgreSQL (chưa có auth, chưa có notebook/tag).
- **Sẽ học:** Minimal API, dependency injection, EF Core + Npgsql, migration, entity và DbContext, DTO, validation, ProblemDetails, OpenAPI; cấu trúc module `Notes` (Domain/Application/Infrastructure/Api) ở mức đơn giản.
- **Việc làm:**
  - Entity `Note` (Id, Title, Content, CreatedAt, UpdatedAt, Version, IsDeleted).
  - DbContext, migration đầu tiên, connection string qua user-secrets.
  - Endpoints: tạo, lấy danh sách, lấy theo id, sửa, xóa mềm.
  - FluentValidation, xử lý lỗi chuẩn, OpenAPI + Swagger UI.
  - Test đầu tiên với xUnit + Testcontainers.
- **Kết quả:** Gọi API bằng Swagger UI tạo và đọc được note, dữ liệu còn sau khi restart.
- **Kiểm tra:** `dotnet test`, thao tác thủ công qua Swagger, xem bảng trong PostgreSQL.

## Phase 2 - Frontend cơ bản: Angular + gọi API

- **Mục tiêu:** Giao diện danh sách note và form tạo/sửa/xóa, nối với API ở phase 1.
- **Sẽ học:** Standalone component, routing và lazy loading, Signals, `HttpClient`, NgRx SignalStore, template syntax; chọn UI library.
- **Việc làm:**
  - Chọn thư viện UI: đã dùng ng-zorro (PrimeNG 22 bị loại vì yêu cầu license key; xem `DECISIONS.md`).
  - Layout cơ bản (sidebar + danh sách + khung nội dung).
  - `NotesStore` (SignalStore) + service gọi API.
  - Trang danh sách, tạo, sửa (textarea thường), xóa.
- **Kết quả:** Tạo, sửa, xóa note từ trình duyệt.
- **Kiểm tra:** Thao tác trên UI và đối chiếu dữ liệu trong DB; test Vitest cho store.

## Phase 3 - Editor Markdown và preview

- **Mục tiêu:** Viết Markdown với editor xịn và xem preview đẹp, an toàn.
- **Sẽ học:** CodeMirror 6 (state, extensions), pipeline unified/remark, KaTeX, Mermaid, Shiki, vì sao phải sanitize (XSS) và DOMPurify.
- **Việc làm:**
  - Thay textarea bằng CodeMirror (syntax highlight Markdown, phím tắt cơ bản).
  - Preview: remark (GFM) → HTML → DOMPurify.
  - Công thức KaTeX, sơ đồ Mermaid, highlight code bằng Shiki.
  - Chế độ chia đôi màn hình, đồng bộ cuộn (nếu kịp).
  - Autosave có debounce (RxJS).
- **Kết quả:** Gõ Markdown có công thức và sơ đồ, preview cập nhật ngay, lưu tự động.
- **Kiểm tra:** Thử chèn `<script>` và HTML độc hại để chắc chắn bị chặn; test cho hàm render.

## Phase 4 - Notebook và Tag

- **Mục tiêu:** Tổ chức note bằng notebook (lồng nhau) và tag.
- **Sẽ học:** Quan hệ 1-n và n-n trong EF Core, cấu trúc cây (ParentId), thiết kế API theo tài nguyên, tách module Notebooks/Tags.
- **Việc làm:**
  - Entity `Notebook`, `Tag`, `NoteTag`; migration; API CRUD.
  - Sidebar hiển thị cây notebook và danh sách tag; lọc note theo notebook/tag.
  - Ghim note (`IsPinned`).
- **Kết quả:** Tạo notebook, gắn tag, lọc note.
- **Kiểm tra:** Test API cho quan hệ; thao tác UI.

## Phase 5 - Xác thực người dùng (Auth)

- **Mục tiêu:** Mỗi người dùng chỉ thấy dữ liệu của mình.
- **Sẽ học:** Authentication vs Authorization, ASP.NET Core Identity, JWT, access/refresh token (xoay vòng), password hashing, HTTP interceptor và route guard trong Angular, vì sao không lưu token tùy tiện.
- **Việc làm:**
  - Module Auth: đăng ký, đăng nhập, refresh, đăng xuất.
  - Thêm `UserId` vào Note/Notebook/Tag; mọi query lọc theo user hiện tại; `[Authorize]` mặc định.
  - Angular: trang đăng nhập/đăng ký, interceptor gắn token và tự refresh, guard.
  - Rate limiting cho endpoint đăng nhập.
- **Kết quả:** Hai tài khoản khác nhau không thấy note của nhau.
- **Kiểm tra:** Test truy cập chéo user (phải bị từ chối); thử token hết hạn.

## Phase 6 - Tìm kiếm full-text

- **Mục tiêu:** Tìm note nhanh theo từ khóa, chịu được gõ sai nhẹ.
- **Sẽ học:** Full-text search PostgreSQL (`tsvector`, `GIN index`), `pg_trgm`, đánh đổi so với Elasticsearch; cấu hình tiếng Việt/không dấu.
- **Việc làm:** Cột `tsvector` (generated), index, endpoint tìm kiếm có phân trang; ô tìm kiếm với debounce; đánh dấu từ khóa khớp.
- **Kết quả:** Gõ từ khóa ra danh sách note liên quan.
- **Kiểm tra:** Test với dữ liệu mẫu; xem `EXPLAIN` để thấy index được dùng.

> **Mốc MVP:** hết phase 6 bạn có một ứng dụng ghi chú Markdown dùng được trên web.

## Phase 7 - Local-first: lưu offline và hàng đợi đồng bộ

- **Mục tiêu:** Ghi chú vẫn dùng được khi mất mạng; khi có mạng thì tự đồng bộ.
- **Sẽ học:** IndexedDB và Dexie, kiến trúc local-first, sync queue, `Version`/`UpdatedAt`, xử lý xung đột (last-write-wins có kiểm tra version), idempotency.
- **Việc làm:** Repository Dexie; mọi thao tác ghi đi qua Dexie trước; hàng đợi đẩy thay đổi lên server; endpoint sync (push/pull theo thời điểm); tạo `NoteRevision` khi có xung đột.
- **Kết quả:** Tắt mạng, sửa note, bật mạng lại thì dữ liệu lên server.
- **Kiểm tra:** Giả lập offline trong DevTools; test xung đột hai thiết bị.

## Phase 8 - Đồng bộ real-time bằng SignalR

- **Mục tiêu:** Sửa ở thiết bị này, thiết bị kia cập nhật ngay.
- **Sẽ học:** WebSocket và SignalR hub, group theo user, tích hợp với RxJS/Signals, xử lý kết nối lại.
- **Việc làm:** Hub thông báo "có thay đổi"; client nhận và kéo dữ liệu mới; tự kết nối lại.
- **Kết quả:** Mở hai tab, sửa ở tab này thì tab kia tự cập nhật.
- **Kiểm tra:** Thử hai trình duyệt; thử ngắt kết nối rồi nối lại.

## Phase 9 - PWA

- **Mục tiêu:** Cài đặt InkNote như app desktop và chạy offline.
- **Sẽ học:** Service Worker, Web App Manifest, chiến lược cache, `@angular/pwa`, cập nhật phiên bản.
- **Việc làm:** Thêm `@angular/pwa`, icon, manifest, cấu hình cache, thông báo khi có bản mới.
- **Kết quả:** Nút "Cài đặt" trong trình duyệt; mở app khi offline vẫn chạy.
- **Kiểm tra:** Lighthouse (mục PWA); thử build production.

## Phase 10 - File đính kèm

- **Mục tiêu:** Chèn ảnh/file vào note.
- **Sẽ học:** Upload multipart, object storage (S3/R2, dùng MinIO khi dev), presigned URL, kiểm tra loại và kích thước file, bảo mật tệp.
- **Việc làm:** Module Attachments; upload từ editor (dán/kéo thả ảnh); chèn link Markdown; giới hạn loại/kích thước.
- **Kết quả:** Dán ảnh vào editor thì hiện trong preview.
- **Kiểm tra:** Thử file quá lớn/sai loại; truy cập file của user khác (phải bị chặn).

## Phase 11 - Lịch sử phiên bản, thùng rác, import/export

- **Mục tiêu:** Không mất dữ liệu và dễ mang dữ liệu vào/ra.
- **Việc làm:** Xem và khôi phục `NoteRevision`; thùng rác (khôi phục/xóa vĩnh viễn); xuất Markdown/zip, nhập file `.md`.
- **Kết quả:** Khôi phục được bản cũ; xuất rồi nhập lại không lỗi.

## Phase 12 - Kiểm thử, Docker, CI/CD, nâng cấp .NET 10

- **Mục tiêu:** Dự án sẵn sàng triển khai và dễ bảo trì.
- **Sẽ học:** Docker multi-stage build, GitHub Actions, Playwright E2E, Serilog/OpenTelemetry, quy trình nâng cấp runtime.
- **Việc làm:** Dockerfile cho API và frontend; `docker-compose` đầy đủ; pipeline build + test; vài kịch bản E2E chính; nâng cấp lên .NET 10 LTS; thêm Redis chỉ khi cần chạy nhiều instance.
- **Kết quả:** Một lệnh dựng được cả hệ thống; CI xanh.

## Phase 13+ (tùy chọn)

Chia sẻ note bằng link công khai · cộng tác real-time với Yjs · mã hóa đầu cuối (E2EE) · hệ thống plugin/theme.

---

## Ghi chú về thứ tự

- Phase 3 (editor) làm trước auth để bạn có niềm vui sớm với phần cốt lõi của app.
- Phase 7 (local-first) là phần khó nhất về tư duy; tôi sẽ chia nhỏ thành các bước và giải thích kỹ khi tới đó.
- Bạn có thể đổi thứ tự hoặc bỏ bớt phase; hãy cho tôi biết trước khi bắt đầu.

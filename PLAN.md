# InkNote - Ứng dụng hỗ trợ ghi chú Markdown

## 1. Giới thiệu & mục tiêu

- InkNote là ứng dụng giúp người dùng viết và quản lý ghi chú Markdown, chạy trên **web** và **desktop (PWA)**, tiện lợi và dễ sử dụng. Ý tưởng lấy từ [Inkdrop](https://www.inkdrop.app/).
- Mục tiêu chính:
  - Trải nghiệm viết nhanh, mượt (editor + preview, công thức KaTeX, sơ đồ Mermaid, highlight code).
  - Hoạt động **offline** (local-first), đồng bộ giữa các thiết bị.
  - Tổ chức ghi chú bằng notebook và tag, tìm kiếm nhanh.

## 2. Công nghệ sử dụng

### Frontend
- **Angular 22**, **SASS**.
- UI: **ng-zorro** (giấy phép MIT, tương thích Angular 22 đã kiểm tra ở Phase 2). PrimeNG 22 đã thử nhưng bỏ vì yêu cầu license key (xem docs/DECISIONS.md).
- Editor: **CodeMirror 6**.
- Render Markdown: **unified/remark** (GFM), **KaTeX** (công thức), **Mermaid** (sơ đồ), **Shiki** (highlight code).
- Bảo mật khi render: **DOMPurify** để sanitize HTML.

### Quản lý state
- **Angular Signals + NgRx SignalStore** cho state của ứng dụng.
- **RxJS** dùng cho HTTP và các luồng sự kiện (SignalR, debounce autosave).
- **Local-first**: **IndexedDB (Dexie)** lưu note ở client, kèm hàng đợi đồng bộ (sync queue).

### Backend
- **.NET 9**, ASP.NET Core Web API.
- **EF Core + Npgsql** truy cập PostgreSQL.
- **SignalR**: đẩy thay đổi giữa các thiết bị/tab đang mở.
- **ASP.NET Core Identity + JWT** (access token + refresh token), có thể thêm OAuth Google/GitHub.
- **FluentValidation**, **ProblemDetails**, **OpenAPI** (Swagger UI), **Serilog**.

### Database, cache, lưu trữ
- **PostgreSQL thuần** (Docker khi phát triển).
- Tìm kiếm full-text: **tsvector + pg_trgm** (chưa cần Elasticsearch).
- File đính kèm: object storage (**Cloudflare R2 / S3**), không lưu trong DB.
- Cache: **IMemoryCache** ở giai đoạn đầu. Thêm **Redis** khi chạy nhiều instance (cache chung và SignalR backplane).

### Desktop
- **PWA**: cài đặt được trên desktop, hoạt động offline nhờ Service Worker (`@angular/pwa`) kết hợp IndexedDB.
- Nếu sau này cần tích hợp sâu với hệ điều hành (hệ thống file, phím tắt toàn cục), có thể đóng gói thêm bằng Tauri hoặc Electron.

### DevOps & kiểm thử
- **Docker Compose** (api, db, redis tùy chọn), **GitHub Actions** cho CI/CD.
- Test: **xUnit + Testcontainers** (backend), **Vitest** (frontend), **Playwright** (E2E).

### Kiểu service
- **Modular monolith** (xem mục 3).

## 3. Kiến trúc

- Một ứng dụng backend duy nhất (monolith) chia thành các module độc lập:
  - **Notes**, **Notebooks/Tags**, **Auth**, **Sync**, **Search**, **Attachments**.
  - Mỗi module có lớp Domain / Application / Infrastructure riêng (theo hướng Clean Architecture); module giao tiếp qua interface, tránh truy cập chéo vào DB của nhau.
- **Chiến lược đồng bộ (local-first)**:
  - Client ghi vào IndexedDB trước, sau đó đẩy thay đổi lên server qua sync queue.
  - Mỗi note có `version` / `updatedAt`; xung đột xử lý bằng last-write-wins có kiểm tra version, và giữ bản cũ trong NoteRevision.
  - SignalR thông báo cho các thiết bị khác để kéo thay đổi mới.
  - Nếu sau này làm cộng tác real-time: dùng **Yjs (CRDT)** với `y-codemirror.next`.

## 4. Mô hình dữ liệu

| Bảng | Mô tả chính |
|---|---|
| `User` | Thông tin tài khoản (Identity) |
| `Notebook` | Sổ tay, hỗ trợ lồng nhau (`ParentId`) |
| `Note` | Tiêu đề, nội dung Markdown, `NotebookId`, `Version`, `IsPinned`, `IsDeleted` (soft delete), `UpdatedAt`, cột `tsvector` để tìm kiếm |
| `Tag` | Nhãn của người dùng |
| `NoteTag` | Quan hệ nhiều-nhiều Note ↔ Tag |
| `Attachment` | Metadata file đính kèm (đường dẫn trong object storage, kích thước, loại) |
| `NoteRevision` | Lịch sử phiên bản của note |

## 5. Tính năng theo giai đoạn

**MVP**
- Đăng ký / đăng nhập.
- CRUD note, notebook, tag.
- Editor CodeMirror + preview (GFM, KaTeX, Mermaid, highlight code).
- Tìm kiếm full-text, ghim note, thùng rác.

**v1**
- Offline và đồng bộ đa thiết bị (Dexie + SignalR).
- Cài đặt dạng PWA.
- Đính kèm ảnh/file.
- Lịch sử phiên bản.
- Import / export (Markdown, zip).

**v2**
- Chia sẻ note công khai bằng link.
- Cộng tác real-time (Yjs).
- Mã hóa đầu cuối (E2EE) tùy chọn.
- Hệ thống plugin / theme.

## 6. Bảo mật

- Sanitize HTML khi render Markdown (DOMPurify) để chống XSS.
- Rate limiting cho API, đặc biệt các endpoint đăng nhập.
- Trả lỗi chuẩn bằng ProblemDetails, không lộ thông tin nội bộ.
- Quản lý token: access token ngắn hạn, refresh token xoay vòng và có thể thu hồi; lưu an toàn ở client.
- Kiểm tra quyền sở hữu dữ liệu ở mọi truy vấn (mỗi user chỉ truy cập note của mình).
- Giới hạn loại và kích thước file đính kèm.

## 7. Roadmap

Chi tiết từng phase: xem [docs/PHASES.md](docs/PHASES.md).

1. **Khởi tạo**: repo, cấu trúc solution .NET 9 và workspace Angular, Docker Compose (PostgreSQL), CI cơ bản.
2. **MVP**: auth, CRUD, editor + preview, tìm kiếm.
3. **v1**: local-first sync, PWA, đính kèm, lịch sử, import/export.
4. **Nâng cấp runtime**: chuyển từ **.NET 9 (STS)** lên **.NET 10 (LTS)** vì .NET 9 sắp hết thời hạn hỗ trợ (khoảng 11/2026).
5. **v2**: chia sẻ, cộng tác real-time, E2EE, plugin/theme.
6. **Vận hành**: thêm Redis và OpenTelemetry khi cần scale, theo dõi hiệu năng và lỗi.

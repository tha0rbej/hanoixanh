# Hà Nội Xanh Admin Agent trên n8n

Thư mục này chứa workflow Agent và các tool sub-workflow có thể import vào n8n.

## Thứ tự import và nối tool

1. Import tám file tool: `search-pollution-locations.json`, `get-pollution-finding.json`, `create-cleanup-post-draft.json`, `get-post-draft.json`, `revise-post-draft.json`, `approve-post-draft.json`, `publish-website-post.json`, `publish-threads-post.json`.
2. Chọn credential `HNX Supabase Server` trong tất cả Supabase nodes; chọn `HNX Tavily Search` và `HNX Threads Publisher` trong các HTTP nodes tương ứng.
3. Import `main-workflow.json`.
4. Mở từng Workflow Tool node trong main workflow, chọn đúng imported workflow. n8n sẽ đọc input schema từ `When Executed by Another Workflow`; đặt mỗi input thành “Let the model define this parameter” (`$fromAI`). Với `admin_user_id`, có thể map cố định từ `Verify Supabase User.id` thay vì cho model tự điền.
5. Chọn Gemini credential, test toàn bộ chuỗi, sau đó mới activate main workflow.

## Luồng chính

1. Admin Dashboard gửi `POST` đến webhook với `Authorization: Bearer <Supabase access token>`.
2. Workflow xác thực JWT bằng Supabase Auth `/user`, rồi kiểm tra profile có `role = admin`.
3. Tải thread state và message gần nhất từ Supabase.
4. Gọi Gemini AI Agent với system prompt tổng quát, metadata skill và toàn bộ tool descriptions.
5. Tool sub-workflow tự kiểm tra quyền, dữ liệu và approval; lịch sử thực thi chi tiết hiện xem trong n8n Executions.
6. Lưu message/state rồi trả JSON cho frontend.

## Credentials cần tạo trong n8n

- **Google Gemini:** tạo API key trong Google AI Studio, rồi tạo credential `Google Gemini(PaLM) API` trong n8n.
- **Supabase server (`HNX Supabase Server`):** ưu tiên Supabase Secret key mới. Nếu project cũ chưa hỗ trợ, dùng legacy service-role key. Cả hai đều chỉ nằm server-side và không được đưa vào frontend hoặc workflow export.
- **Tavily (`HNX Tavily Search`):** tạo credential chứa `TAVILY_API_KEY`. Tool search gọi Tavily Search với `include_images: true` và `include_image_descriptions: true`, đồng thời lưu URL nguồn, ngày và trạng thái quyền ảnh. Kết quả tìm kiếm không tự chứng minh quyền tái sử dụng ảnh.
- **Threads (`HNX Threads Publisher`):** tạo Meta app, cấp quyền Threads cho tài khoản tổ chức và lưu access token server-side. Lưu `THREADS_USER_ID` trong n8n Variable/Credential, không đưa vào frontend.

## Lấy từng thông tin ở đâu

1. **Supabase URL và Secret key:** Supabase Dashboard → Project Settings → API Keys. Sao chép Project URL và Secret key mới; project cũ có thể dùng `service_role` legacy. Frontend chỉ dùng anon/publishable key, tuyệt đối không dùng Secret key.
2. **Gemini key:** Google AI Studio → API keys → Create API key. Trong n8n tạo credential Google Gemini và chọn credential đó ở `Gemini Chat Model`.
3. **Tavily key:** Tavily Dashboard → API Keys. Trong n8n tạo Header Auth credential tên `HNX Tavily Search`, header `Authorization`, value `Bearer <TAVILY_API_KEY>`.
4. **Threads token:** Meta for Developers → tạo/chọn app → thêm Threads use case → cấu hình OAuth redirect → cấp quyền publish cho tài khoản Threads của tổ chức → lấy access token dài hạn. Tạo Header Auth credential `HNX Threads Publisher` với `Authorization: Bearer <token>`. Dùng Threads API `/me` với token đó để lấy ID và lưu vào n8n Variable `THREADS_USER_ID`.
5. **Webhook frontend:** sau khi activate main workflow, sao chép Production URL của `Admin Chat Webhook` vào `VITE_N8N_ADMIN_AGENT_WEBHOOK_URL`, rồi build/deploy lại website.

## Biến môi trường/variables phía n8n

```text
HNX_SUPABASE_URL
HNX_SUPABASE_SECRET_KEY
# Chỉ dùng fallback này cho project Supabase cũ: HNX_SUPABASE_SERVICE_ROLE_KEY
THREADS_USER_ID
HNX_SKILL_CONTENT
HNX_PUBLIC_SITE_URL
HNX_TIMEZONE=Asia/Ho_Chi_Minh
```

`HNX_SKILL_CONTENT` là nội dung đã kiểm duyệt của `skills/pollution-campaign-post/SKILL.md`. `HNX_SUPABASE_SECRET_KEY` hiện được main workflow dùng để gọi hai RPC server-only; nếu instance n8n hỗ trợ custom credential cho HTTP Request với cả `apikey` và `Authorization`, nên chuyển secret này sang credential trước production. Tavily và Threads đã dùng Header Auth credentials, không dùng Variables cho token.

## Tool search qua Tavily

Sub-workflow `search_pollution_locations` gọi Tavily bằng HTTP Request credential `HNX Tavily Search`. Payload tối thiểu:

```json
{
  "query": "điểm ô nhiễm rác thải Hà Nội gần đây",
  "topic": "news",
  "search_depth": "advanced",
  "include_images": true,
  "include_image_descriptions": true,
  "max_results": 8
}
```

Sau search, Code node chuẩn hóa kết quả rồi ghi `pollution_findings`. Tool phải gắn `license_status = unknown` nếu nguồn không nêu quyền sử dụng ảnh.

## Tool đăng Threads

`publish_threads_post` là một sub-workflow riêng:

1. Đọc đúng draft version đã duyệt và chọn ảnh có URL HTTPS public.
2. Tạo media container cho `THREADS_USER_ID` với text và `image_url`.
3. Chờ/kiểm tra container xử lý thành công.
4. Gọi endpoint `threads_publish` với creation/container ID.
5. Ghi provider post ID, URL hoặc lỗi vào `publication_jobs`.

Không nhúng access token vào nội dung node export; dùng credential `HNX Threads Publisher`.

## Payload frontend

```json
{
  "message": "Tìm điểm ô nhiễm gần đây ở Hà Nội",
  "thread_id": null,
  "client_message_id": "uuid",
  "timezone": "Asia/Ho_Chi_Minh"
}
```

Response tối thiểu:

```json
{
  "thread_id": "uuid",
  "message": "...",
  "state": "researching",
  "findings": [],
  "draft": null
}
```

## Guardrails bắt buộc

- Xác thực JWT và role admin trước Agent.
- Không truyền service-role key cho model.
- Tool xuất bản chỉ nhận draft/version đã duyệt.
- Im lặng không phải approval; `publish_now` cần confirmation text rõ.
- Dùng unique key trong `publication_jobs` để chống đăng trùng.
- Bảng `agent_tool_logs` đã được chuẩn bị cho audit cấp ứng dụng nhưng chưa được nối vào các tool workflow; hiện dùng n8n Executions để truy vết. Khi nối bảng này, phải loại bỏ token và bí mật khỏi arguments trước khi ghi.
- Website và Threads là hai publication job độc lập.
- Main workflow tạo/load thread, lưu user message qua `prepare_admin_agent_turn`, lưu assistant response qua `finalize_admin_agent_turn`, rồi trả findings/draft mới nhất cho UI.
- Workflow Tool IDs trong file export là placeholder vì n8n cấp ID mới khi import. Bắt buộc chọn lại tám sub-workflow trong UI trước khi activate.

## Frontend

Đặt URL production webhook vào `.env.local`:

```text
VITE_N8N_ADMIN_AGENT_WEBHOOK_URL=https://your-instance.n8n.cloud/webhook/hnx-admin-agent
```

Không dùng test webhook trong production vì URL test chỉ hoạt động khi workflow đang ở chế độ lắng nghe thủ công.

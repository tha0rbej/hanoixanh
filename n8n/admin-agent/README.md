# Hà Nội Xanh Admin Agent trên n8n

Thư mục này chứa workflow Agent, 15 tool sub-workflow (8 tool bài đăng + 7 tool thông báo cho người đăng ký sự kiện) và workflow đăng bài theo lịch, import được vào n8n 2.x bản Community tự host. Cách dựng n8n bằng Docker và lệnh import/bật toàn bộ nằm ở `n8n/README.md`; phần dưới giải thích thiết kế.

## Import và nối tool

0. Chạy migration trên Supabase theo thứ tự `20261119000000_admin_agent.sql` -> `20261123010000_claim_publication_job.sql` (RPC `claim_publication_job` cho tool đăng bài) -> `20261124000000_campaign_announcements.sql` (bảng và RPC thông báo; cần thêm `20261123000000_registration_confirmation_email.sql` trước nó). Chưa chạy migration thông báo thì bảy tool thông báo trả `service_unavailable` ("Báo admin chạy migration"), các tool bài đăng vẫn chạy.
1. Tạo bốn credential trước (tên đúng từng ký tự): `HNX OpenAI`, `HNX Supabase Server`, `HNX Tavily Search`, `HNX Threads Publisher`. Workflow tham chiếu credential theo tên và n8n nối lúc import.
2. Import 17 file: tám tool bài đăng (`search-pollution-locations`, `get-pollution-finding`, `create-cleanup-post-draft`, `get-post-draft`, `revise-post-draft`, `approve-post-draft`, `publish-website-post`, `publish-threads-post`), bảy tool thông báo (`find-announcement-events`, `get-event-registrants`, `save-announcement-draft`, `get-announcement-status`, `send-test-announcement`, `approve-and-send-announcement`, `cancel-announcement`), `scheduled-publisher.json` và `main-workflow.json`. Thứ tự không quan trọng.
3. Mỗi tool có `id` cố định (bài đăng: `hnxToolSearchPollution`, `hnxToolGetFinding`, `hnxToolCreateDraft`, `hnxToolGetDraft`, `hnxToolReviseDraft`, `hnxToolApproveDraft`, `hnxToolPublishWebsite`, `hnxToolPublishThreads`; thông báo: `hnxToolFindAnnouncementEvents`, `hnxToolGetEventRegistrants`, `hnxToolSaveAnnouncementDraft`, `hnxToolGetAnnouncementStatus`, `hnxToolSendTestAnnouncement`, `hnxToolApproveAndSendAnnouncement`, `hnxToolCancelAnnouncement`) và main workflow đã trỏ đúng id cùng sơ đồ input, nên không phải chọn lại tool bằng tay. `thread_id`, `admin_user_id`, và với các tool duyệt/đăng/gửi/hủy thêm `confirmation_text`, `turn_started_at`, `trigger_source` được gắn cố định; các input còn lại là `$fromAI` (xem “Lưu ý bảo mật” và “Xác nhận của admin”).
4. Bật (publish) cả 17 workflow, kể cả các tool: n8n 2.x không chạy sub-workflow chưa bật. Rồi restart container.

## Tool, skill và `load_skill`

Agent có 16 tool: `load_skill` và 15 tool workflow. Hai skill (thư mục `skills/`, mount chỉ đọc vào container tại `/skills`):

| Skill | Tool | Việc |
| --- | --- | --- |
| `pollution-campaign-post` | `search_pollution_locations`, `get_pollution_finding`, `create_cleanup_post_draft`, `get_post_draft`, `revise_post_draft`, `approve_post_draft`, `publish_website_post`, `publish_threads_post` | tìm điểm ô nhiễm, soạn/duyệt/đăng bài website và Threads |
| `campaign-announcement` | `find_announcement_events`, `get_event_registrants`, `save_announcement_draft`, `get_announcement_status`, `send_test_announcement`, `approve_and_send_announcement`, `cancel_announcement` | soạn, gửi thử, duyệt, theo dõi, hủy thông báo email tới người đăng ký một sự kiện |

- **Một agent duy nhất, đủ tool với schema đầy đủ.** System prompt KHÔNG chứa nội dung skill, chỉ chứa tên + mô tả ngắn của từng skill và hướng dẫn "trước khi dùng tool của một skill hãy gọi `load_skill`".
- **Node `Load Skills Metadata`** (Code, nằm giữa `Has Thread` và `Admin Agent`) đọc `/skills/*/SKILL.md` bằng `fs`, phân tích frontmatter `name` và `description` (YAML đơn giản: một dòng, hoặc nhiều dòng dạng `>`/`|`) và tạo `skills_metadata` (mỗi dòng `- tên: mô tả`). Chỉ nhận thư mục tên khớp `^[a-z0-9][a-z0-9-]{0,63}$`, `SKILL.md` là file thật (không symlink), không quá 64 KB, `name` trùng tên thư mục; skill thiếu `name`/`description` bị bỏ qua mà không làm sập luồng. System prompt của `Admin Agent` là biểu thức chèn `$('Load Skills Metadata').first().json.skills_metadata`. Thêm thư mục skill mới là hiện trong prompt ngay, không cần sửa workflow.
- **Tool `load_skill`** nhận `skill_name`. Allowlist ĐỘNG: các skill hợp lệ như trên, đọc lúc chạy. Tên sai regex hoặc không có trong allowlist (kể cả `../x`, `a/b`, byte null, tên rỗng, 65 ký tự, symlink ra ngoài) trả `{error:"unknown_skill", available:[...]}`; file lớn hơn 64 KB trả `skill_too_large`; lỗi đọc trả `skill_unreadable`. Thành công trả `{name, content}` là toàn bộ `SKILL.md`. Thư mục `references/` chỉ là tài liệu cho người phát triển và KHÔNG được tool trả về, nên mỗi `SKILL.md` phải tự chứa đủ quy trình.
- Thay đổi `SKILL.md` có hiệu lực ngay (không cần import lại), nhưng thêm/đổi tool thì vẫn phải sửa workflow.

## Thông báo cho người đăng ký sự kiện (7 tool)

Admin nhắn một câu ngắn ("báo mọi người đăng ký chiến dịch La Phù là dời sang 8h sáng Chủ nhật"); Agent làm theo skill `campaign-announcement`:

1. `find_announcement_events` tìm sự kiện (nhiều kết quả thì hỏi admin chọn), `get_event_registrants` cho số người nhận (0 hoặc vượt 1000 thì dừng).
2. `save_announcement_draft` lưu bản nháp văn bản thuần (nút `Sanitize Draft` tước HTML, gỡ ký tự điều khiển, tiêu đề một dòng tối đa 150, nội dung tối đa 5000, quá dài thì từ chối chứ không cắt). Mỗi lần sửa tạo version mới.
3. `send_test_announcement` (tùy chọn) gửi thư thử tới chính admin, tối đa 5 lần mỗi giờ.
4. `approve_and_send_announcement` ở một tin nhắn riêng sau khi admin đã đọc: cổng `Validate Send` chỉ cho gọi RPC `approve_announcement` khi tin nhắn thật của admin là xác nhận gửi rõ ràng; RPC còn chặn `needs_admin_review` nếu version tạo trong chính lượt chat.
5. `get_announcement_status` xem tiến độ; `cancel_announcement` hủy khi tin nhắn thật của admin có ý hủy rõ ràng (`Validate Cancel`).
6. Việc gửi thư thật do `mailer/` (không LLM, không n8n) thực hiện: khoảng 20 thư mỗi phút, tối đa theo hạn mức mỗi ngày; thông báo lớn có thể kéo dài. Người không có tài khoản không nhận được. Khối thông tin sự kiện trong thư lấy giờ/địa điểm từ bảng chiến dịch, nên khi thông báo dời giờ/đổi địa điểm phải cập nhật chiến dịch trước.

Mỗi tool thông báo là một sub-workflow cùng một khuôn: trigger -> node kiểm tra đầu vào (`Validate Input`/`Sanitize Draft`/`Validate Send`/`Validate Cancel`) -> `Validation Passed` -> `Call RPC` (HTTP POST `$env.HNX_SUPABASE_URL/rest/v1/rpc/<hàm>`, khóa từ `$env`) -> `Return Result`; không qua kiểm tra thì `Return Validation Result` trả `{status, message}` (`invalid_input`, `needs_content`, `needs_admin_confirmation`). `Return Result` chuyển mọi `status` của hợp đồng RPC (comment đầu migration `20261124000000`) kèm `message` hướng dẫn bước tiếp theo cho model; lỗi HTTP/mạng hoặc RPC chưa có (`PGRST202`/404) trả `service_unavailable` thay vì làm execution lỗi. Không trường email nào được chuyển về model.

Từ khóa xác nhận gửi nằm trong regex của node `Validate Send` (xem comment trong node): cần một từ hành động (`gửi`, `duyệt`, `chốt`, `approve`, `send`...), không bị phủ định liền trước, không phải câu hỏi, không phải yêu cầu gửi thử, không phải lệnh soạn thông báo ("báo mọi người..."), tối đa 200 ký tự. "ok"/"đồng ý" đơn thuần chưa đủ vì không rõ đang đồng ý điều gì; chỉnh bộ từ khóa tại đó nếu cần.

## Luồng chính

1. Admin Dashboard gửi `POST` đến webhook với `Authorization: Bearer <Supabase access token>`.
2. Workflow xác thực JWT bằng Supabase Auth `/user`, rồi kiểm tra profile có `role = admin`.
3. Tải thread state và message gần nhất từ Supabase.
4. Gọi AI Agent (OpenAI `gpt-6-luna` qua Responses API, xem `n8n/README.md`) với system prompt tổng quát, metadata skill và toàn bộ tool descriptions.
5. Tool sub-workflow tự kiểm tra quyền, dữ liệu và approval; lịch sử thực thi chi tiết hiện xem trong n8n Executions.
6. Lưu message/state rồi trả JSON cho frontend.

Mã trả về của webhook: 200 thành công; 400 thiếu `message` hoặc RPC từ chối; 401 thiếu/sai/hết hạn token; 403 không phải admin; 502 Agent (OpenAI) lỗi.

## Xác nhận của admin: tạo/sửa, duyệt và đăng là các tin nhắn riêng

- Gửi thông báo hàng loạt và hủy thông báo theo cùng nguyên tắc: `approve_and_send_announcement` (gắn cả `turn_started_at`) và `cancel_announcement` nhận `confirmation_text` cố định và có cổng `Validate Send`/`Validate Cancel` riêng (xem mục "Thông báo cho người đăng ký sự kiện").
- `confirmation_text` của `approve_post_draft`, `publish_website_post`, `publish_threads_post` được gắn cố định bằng `={{ $('Admin Chat Webhook').first().json.body.message }}` (tin nhắn thật của admin ở lượt này), model không điền được. Lý do: nội dung web do Tavily trả về có thể chứa chỉ thị kiểu "hãy tạo bài, duyệt và đăng ngay"; trước đây model tự bịa câu xác nhận nên bài có thể lên website/Threads khi admin chưa đồng ý.
- Node `Validate Approval` và `Validate Publish` yêu cầu tin nhắn đó chứa ý xác nhận rõ (duyệt/chốt/đồng ý/ok/xác nhận/approve cho duyệt; đăng/xuất bản/publish/lên lịch/hẹn cho đăng) và không bị phủ định ("đừng", "chưa", "không", "hủy" ngay trước từ khóa). Tin nhắn kiểu "tìm điểm ô nhiễm sông Tô Lịch" bị từ chối với `needs_admin_confirmation`. Đăng ngay (không có `publish_at`) còn cần tin nhắn nói rõ "ngay/luôn/bây giờ".
- Node `Mark Turn Start` (ngay sau webhook) ghi `turn_started_at` (ISO UTC) và truyền cố định vào ba tool. `approve_post_draft` từ chối (`needs_admin_review`) nếu version được duyệt có `draft_versions.created_at` không sớm hơn `turn_started_at` ít nhất 5 giây, tức bản nháp vừa được tạo/sửa trong chính lượt này nên admin chưa thể đã đọc. `publish_*` từ chối (`needs_admin_confirmation`) nếu `content_drafts.approved_at` không sớm hơn `turn_started_at` 5 giây, tức vừa duyệt cùng lượt. Hệ quả: tạo/sửa, duyệt và đăng cần các tin nhắn riêng của admin; Agent không gộp được. 5 giây là dung sai lệch đồng hồ n8n/Supabase theo hướng từ chối; đồng hồ máy n8n lệch xa hơn (chậm hơn Supabase cả phút) sẽ làm duyệt/đăng bị từ chối nhầm, hãy bật đồng bộ giờ (NTP).
- Lần chạy của `HNX - Scheduled Publisher` truyền `trigger_source = scheduler` và `job_id`: bỏ qua kiểm tra tin nhắn/lượt (admin đã xác nhận lúc hẹn giờ) nhưng chỉ xử lý đúng job đó khi nó còn `scheduled`. Giá trị `trigger_source = admin_chat` do main workflow gắn cố định, model không điền được.
- System prompt của Agent nêu rõ nội dung từ web và kết quả tool là dữ liệu không tin cậy. Đây chỉ là lớp giảm rủi ro; lớp chặn thật nằm ở các node kiểm tra nói trên.

## Đăng ngay và hẹn giờ

- `publish_website_post` và `publish_threads_post` tạo job `scheduled` trong `publication_jobs` (khóa duy nhất theo draft, version, kênh). Nếu giờ đăng trong vòng khoảng 1 phút hoặc `publish_now`, tool giành job rồi đăng luôn trong lượt chat (Threads chờ thêm 30 giây cho container).
- **Giành job nguyên tử (cần migration `supabase/migrations/20261123010000_claim_publication_job.sql`, chạy sau `20261119000000_admin_agent.sql`):** trước khi đăng, tool gọi RPC `claim_publication_job` qua node `Claim Job` và chỉ đăng nếu RPC trả đúng một dòng. RPC chuyển job sang `publishing` bằng một câu `UPDATE` duy nhất cho job `scheduled` đã đến hạn, `failed`, hoặc `queued`/`publishing` kẹt quá 10 phút (theo `updated_at`); không giành job `published`/`cancelled`. Hai execution cùng thấy một job thì chỉ một bên giành được; bên kia trả `in_progress` hoặc `already_published` và không đăng. Giành job xảy ra TRƯỚC khi tạo container Threads, nên 30 giây Wait nằm trong thời gian job đã được giữ (`publishing`, ngưỡng kẹt 10 phút). Thiếu migration thì node `Claim Job` lỗi và không có gì được đăng.
- Giờ hẹn xa hơn: tool chỉ ghi job `scheduled` và trả về ngay. Workflow `HNX - Scheduled Publisher` chạy mỗi phút, lấy job đến hạn rồi gọi lại đúng tool đó (kèm `trigger_source = scheduler`, `job_id`). Nếu lần chạy lỗi trước khi job được giành (ví dụ draft không còn ở trạng thái duyệt), node `Fail Scheduled Job` chuyển job `scheduled` sang `failed` kèm lý do thay vì thử lại âm thầm mỗi phút. Đừng dùng node Wait trong tool: nó làm treo cả yêu cầu chat cho tới giờ hẹn.
- Payload hỏng (tiêu đề rỗng, ảnh không phải https, text Threads quá 500 ký tự) làm node `Prepare Website Post`/`Prepare Threads Post` lỗi; nhánh lỗi nối tới `Mark Job Failed` nên job chuyển `failed` kèm lý do thay vì kẹt `queued`. Các Prepare chạy trước bước giành job.
- Gọi lại cho kênh đã đăng/đã hẹn trả `already_published`/`already_scheduled`; job `failed` hoặc kẹt quá 10 phút được thử lại, job `cancelled` trả `job_cancelled` (không tự đăng lại). Thời gian không kèm múi giờ được hiểu là +07:00; giờ đã qua quá 5 phút bị từ chối.
- Hạn chế còn lại: nếu một execution chết sau khi đã đăng nhưng trước khi ghi `published`, sau 10 phút job có thể bị giành lại và đăng lần nữa (không có cách chống tuyệt đối khi API ngoài không idempotent). Hai lượt chat tạo job cùng lúc cho một kênh sẽ va khóa duy nhất và một bên báo lỗi, không đăng trùng.
- Máy tắt hoặc n8n dừng thì không có bài nào được đăng theo lịch; bật lại, job đến hạn được đăng ở lần chạy kế tiếp.

## Credentials cần tạo trong n8n

- **OpenAI (`HNX OpenAI`):** tạo API key trong platform.openai.com, rồi tạo credential loại `OpenAI API` trong n8n. Model chọn bằng `OPENAI_MODEL` trong `n8n/.env`; tài khoản cần có số dư dương mới gọi được model.
- **Supabase server (`HNX Supabase Server`):** ưu tiên Supabase Secret key mới. Nếu project cũ chưa hỗ trợ, dùng legacy service-role key. Cả hai đều chỉ nằm server-side và không được đưa vào frontend hoặc workflow export.
- **Tavily (`HNX Tavily Search`):** tạo credential chứa `TAVILY_API_KEY`. Tool search gọi Tavily Search với `include_images: true` và `include_image_descriptions: true`, đồng thời lưu URL nguồn, ngày và trạng thái quyền ảnh. Kết quả tìm kiếm không tự chứng minh quyền tái sử dụng ảnh. Tavily trả danh sách ảnh chung, không gắn với từng bài, nên node `Normalize Findings` không còn ghép `images[i]` vào `results[i]`: mỗi finding nhận tối đa 3 ảnh đầu của danh sách chung với `source_url = null`, `license_status = unknown` và chú thích "Ảnh từ kết quả tìm kiếm — chưa xác minh nguồn/quyền". Admin phải tự kiểm tra nguồn và quyền trước khi dùng ảnh để đăng.
- **Threads (`HNX Threads Publisher`):** tạo Meta app, cấp quyền Threads cho tài khoản tổ chức và lưu access token server-side. `THREADS_USER_ID` đặt trong `n8n/.env`, không đưa vào frontend.

## Lấy từng thông tin ở đâu

1. **Supabase URL và Secret key:** Supabase Dashboard → Project Settings → API Keys. Sao chép Project URL và Secret key mới; project cũ có thể dùng `service_role` legacy. Frontend chỉ dùng anon/publishable key, tuyệt đối không dùng Secret key. Cùng giá trị này điền cả vào `n8n/.env` (`HNX_SUPABASE_URL`, `HNX_SUPABASE_SECRET_KEY`) lẫn credential `HNX Supabase Server` (Host, Service Role Secret).
2. **OpenAI key:** platform.openai.com → API keys → Create new secret key. Trong n8n tạo credential `OpenAI API` tên `HNX OpenAI` (nhập trên giao diện n8n, không ghi vào `.env`).
3. **Tavily key:** Tavily Dashboard → API Keys. Trong n8n tạo Header Auth credential tên `HNX Tavily Search`, header `Authorization`, value `Bearer <TAVILY_API_KEY>`.
4. **Threads token:** Meta for Developers → tạo/chọn app → thêm Threads use case → cấu hình OAuth redirect → cấp quyền publish cho tài khoản Threads của tổ chức → lấy access token dài hạn. Tạo Header Auth credential `HNX Threads Publisher` với `Authorization: Bearer <token>`. Dùng Threads API `/me` với token đó để lấy ID và đặt vào `THREADS_USER_ID` trong `n8n/.env`.
5. **Webhook frontend:** sau khi bật main workflow, sao chép Production URL của `Admin Chat Webhook` vào `VITE_N8N_ADMIN_AGENT_WEBHOOK_URL`, rồi build/deploy lại website.

## Biến môi trường phía n8n

n8n Variables chỉ có ở gói trả phí, bản Community từ chối tạo (kiểm chứng trên 2.48.8), nên workflow đọc biến môi trường của container qua `$env`. `docker-compose.yml` đặt `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` vì n8n 2.x chặn `$env` theo mặc định. Giá trị khai trong `n8n/.env` (mẫu: `n8n/env.example`):

```text
HNX_SUPABASE_URL
HNX_SUPABASE_SECRET_KEY
# Chỉ dùng fallback này cho project Supabase cũ: HNX_SUPABASE_SERVICE_ROLE_KEY
THREADS_USER_ID
HNX_PUBLIC_SITE_URL
```

Nội dung skill không còn là biến: node `Load Skills Metadata` và tool `load_skill` đọc `/skills/<tên>/SKILL.md`, thư mục `skills/` của repo được mount chỉ đọc vào container (cần `NODE_FUNCTION_ALLOW_BUILTIN=fs`; thiếu biến này báo "Module 'fs' is disallowed" và lượt chat lỗi). Sửa SKILL.md là Agent dùng bản mới ngay. `HNX_SUPABASE_SECRET_KEY` được main workflow dùng để gọi hai RPC server-only và kiểm tra quyền admin; Tavily và Threads dùng Header Auth credentials, không nằm trong biến môi trường.

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
- Im lặng không phải approval; xác nhận lấy từ tin nhắn thật của admin (không phải do model điền) và duyệt/đăng nằm ở các lượt chat khác nhau (xem mục "Xác nhận của admin").
- Dùng unique key trong `publication_jobs` và RPC `claim_publication_job` để chống đăng trùng.
- `create_cleanup_post_draft` kiểm `finding_id` thuộc đúng `thread_id` hiện tại (node `Get Finding`/`Check Finding`), nếu không báo `finding_not_found`.
- Tool tạo/sửa draft không tạo file HTML hay `preview_url`/`file_url`; bản xem trước hiển thị trên Admin Dashboard, nên Agent không được báo link xem trước.
- Bảng `agent_tool_logs` đã được chuẩn bị cho audit cấp ứng dụng nhưng chưa được nối vào các tool workflow; hiện dùng n8n Executions để truy vết. Khi nối bảng này, phải loại bỏ token và bí mật khỏi arguments trước khi ghi.
- Website và Threads là hai publication job độc lập.
- Main workflow tạo/load thread, lưu user message qua `prepare_admin_agent_turn`, lưu assistant response qua `finalize_admin_agent_turn`, rồi trả findings/draft mới nhất cho UI.
- Tool sub-workflow có `id` cố định ở cấp workflow trong file JSON, nên import lại luôn ra đúng id và main workflow không cần chọn lại.

## Lưu ý bảo mật

- `admin_user_id` (có ở `create_cleanup_post_draft`, `revise_post_draft`, `approve_post_draft`, `publish_website_post`, `publish_threads_post`, `save_announcement_draft`, `send_test_announcement`, `approve_and_send_announcement`, `cancel_announcement`) được map cố định bằng `={{ $('Verify Supabase User').first().json.id }}` trong Workflow Tool node, không dùng `$fromAI`. Nếu để model tự điền, nội dung chat có thể khiến Agent thao tác dưới danh nghĩa admin khác. Đã thử trên n8n 2.48.8: cả `.first()` và `.item` đều chạy được; dùng `.first()` vì workflow luôn chỉ có một item. Thử model trả thêm `admin_user_id`/`thread_id` giả trong tool call: bị bỏ qua, giá trị cố định vẫn được dùng.
- `thread_id` cũng được gắn cố định từ `Prepare Agent Turn` (`$('Prepare Agent Turn').first().json.thread_id`), nên model không thể đọc hay sửa draft của thread khác.
- Nội dung bài website do Agent soạn (có thể chứa HTML từ nguồn web) được loại bỏ mọi thẻ HTML ở node `Prepare Website Post` trong `publish-website-post.json` trước khi ghi vào bảng `posts`. Giữ bước này khi chỉnh sửa workflow.
- Import lại main workflow giữ nguyên cấu hình tool vì sơ đồ input (`workflowInputs`) nằm trong file JSON. Chỉ khi đổi tham số của một tool (thêm/bớt input ở node `When Executed by Another Workflow`) mới cần cập nhật `workflowInputs` và `schema` của node tool tương ứng trong main workflow cho khớp.
- Model truyền `website_payload`, `threads_payload`, `images`, `sources` dưới dạng chuỗi JSON; các tool tự parse và kiểm tra (ví dụ Threads tối đa 500 ký tự, ảnh phải là URL https).

## Frontend

Đặt URL production webhook vào `.env.local`:

```text
# n8n chạy local (chỉ dùng được khi mở web từ chính máy này):
VITE_N8N_ADMIN_AGENT_WEBHOOK_URL=http://localhost:5678/webhook/hnx-admin-agent
# n8n sau tunnel/domain HTTPS:
# VITE_N8N_ADMIN_AGENT_WEBHOOK_URL=https://n8n.example.com/webhook/hnx-admin-agent
```

Không dùng test webhook trong production vì URL test chỉ hoạt động khi workflow đang ở chế độ lắng nghe thủ công.

## Kiểm thử

- `pnpm test:n8n` (Node 20+, không cần cài thêm; `node:test` + `vm`; file đặt tên `*-test.js` để vitest của giao diện không nhặt nhầm) chạy thật các node Code của workflow với biến n8n giả (`$input`, `$('Node')`, `$env`, `fs` trỏ vào thư mục tạm): cổng xác nhận gửi/hủy, làm sạch HTML của bản nháp, `Load Skills Metadata`, `load_skill`, mọi mã status của hợp đồng RPC qua các node `Return Result`, `service_unavailable`, cấu trúc workflow (id/tên node, connection, schema tool khớp trigger, trường nhạy cảm gắn cố định và không dùng `$fromAI`, khóa Supabase lấy từ `$env`, không dùng n8n Variables hay nhà cung cấp model cũ), docker-compose, tên tool trong `SKILL.md`, không có chuỗi giống khóa thật. Test chỉ kiểm luồng và chốt chặn, không khóa câu chữ thông điệp/prompt/skill.
- `RUN_E2E=1 pnpm test:n8n` hoặc `bash n8n/admin-agent/tests/e2e/run-e2e.sh` chạy thêm kịch bản đầu-cuối trên n8n 2.48.8 thật trong Docker với mock OpenAI/Supabase/Tavily/Threads (xem `tests/e2e/README.md`). Mặc định bỏ qua.
- Hợp đồng RPC giai đoạn 1 chỉ được kiểm bằng mock; chưa chạy trên Postgres thật.

## Chạy thử khi chưa có key

Không cần key thật cho các bước sau (xem lệnh ở `n8n/README.md`, mục 7):

- Import và bật đủ 17 workflow chỉ cần bốn credential có giá trị tạm; n8n không gọi dịch vụ ngoài lúc import hay bật.
- Gọi webhook không kèm token trả 401; preflight `OPTIONS` trả 204 kèm header CORS.
- Muốn thử cả chuỗi tool, trỏ `HNX_SUPABASE_URL` và Base URL của credential OpenAI và host của credential Supabase tới một server giả lập; các URL Tavily và Threads (`api.tavily.com`, `graph.threads.com`) viết cứng trong node nên chỉ thử được bằng bản sao workflow đã đổi URL.
- Chưa kiểm chứng được nếu thiếu key thật: `gpt-6-luna` gọi tool đúng tham số với model thật (tài khoản OpenAI cần nạp tiền), Secret key kiểu `sb_secret_...` với Supabase node, Tavily trả dữ liệu thật, Threads tạo/đăng container thật.

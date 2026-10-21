-- Bổ sung nơi lưu nhiều ảnh cho báo cáo ô nhiễm.
-- Migration này chỉ thêm cột nếu chưa có; không xóa hoặc sửa dữ liệu hiện tại.
alter table public.pollution_reports
  add column if not exists photo_urls jsonb not null default '[]'::jsonb;

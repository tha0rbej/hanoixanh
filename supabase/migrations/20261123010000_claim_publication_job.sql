-- Giành job đăng bài một cách nguyên tử để hai execution (scheduler và đăng tay,
-- hoặc hai lượt scheduler) không cùng đăng một job.
-- PHẢI chạy sau 20261119000000_admin_agent.sql (bảng public.publication_jobs).

create or replace function public.claim_publication_job(
  p_job_id uuid,
  p_stale_after interval default '10 minutes'
) returns setof public.publication_jobs
language sql
security definer
set search_path = public
as $$
  -- Một câu UPDATE duy nhất: chỉ một người gọi thấy được dòng thỏa điều kiện,
  -- người đến sau thấy trạng thái đã đổi sang 'publishing' (updated_at mới) nên không giành được.
  update public.publication_jobs j
     set status = 'publishing',
         attempts = j.attempts + 1,
         error_message = null,
         updated_at = now()
   where j.id = p_job_id
     and (
       -- Job hẹn giờ đã đến hạn (dung sai 1 phút, khớp với cách tool tính "đến hạn").
       (j.status = 'scheduled' and (j.publish_at is null or j.publish_at <= now() + interval '1 minute'))
       -- Job lỗi: cho thử lại.
       or j.status = 'failed'
       -- Job kẹt ở queued/publishing quá p_stale_after (execution trước chết giữa chừng).
       or (j.status in ('queued', 'publishing') and j.updated_at < now() - p_stale_after)
     )
  returning j.*;
$$;

revoke all on function public.claim_publication_job(uuid, interval) from public, anon, authenticated;
grant execute on function public.claim_publication_job(uuid, interval) to service_role;

comment on function public.claim_publication_job(uuid, interval) is
  'Giành nguyên tử một publication_job để đăng: trả đúng 1 dòng (đã chuyển sang publishing) hoặc không dòng nào. Không giành job published/cancelled. Chỉ service_role (n8n) gọi được.';

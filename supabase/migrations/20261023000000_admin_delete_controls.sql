create or replace function public.delete_user_account(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only administrators can delete accounts'; end if;
  if target_user_id = auth.uid() then raise exception 'The active administrator cannot delete their own account'; end if;
  delete from auth.users where id = target_user_id;
end;
$$;
revoke all on function public.delete_user_account(uuid) from public;
grant execute on function public.delete_user_account(uuid) to authenticated;

drop policy if exists reports_admin_write on public.pollution_reports;
create policy reports_admin_write on public.pollution_reports for all using (public.is_admin()) with check (public.is_admin());

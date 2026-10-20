-- Configurable green gifts and atomic point redemption.
create table if not exists public.green_rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  points_cost bigint not null check (points_cost > 0),
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.green_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_id uuid not null references public.green_rewards(id),
  reward_name text not null,
  points_spent bigint not null check (points_spent > 0),
  full_name text not null,
  phone text not null,
  delivery_address text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by uuid references public.profiles(id)
);

alter table public.green_rewards enable row level security;
alter table public.green_redemptions enable row level security;

grant select on table public.green_rewards to anon, authenticated;
grant insert, update, delete on table public.green_rewards to authenticated;
grant select on table public.green_redemptions to authenticated;
grant update on table public.green_redemptions to authenticated;

drop policy if exists green_rewards_public_read on public.green_rewards;
create policy green_rewards_public_read on public.green_rewards for select using (active = true or public.is_admin());
drop policy if exists green_rewards_admin_write on public.green_rewards;
create policy green_rewards_admin_write on public.green_rewards for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists green_redemptions_read on public.green_redemptions;
create policy green_redemptions_read on public.green_redemptions for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists green_redemptions_admin_update on public.green_redemptions;
create policy green_redemptions_admin_update on public.green_redemptions for update using (public.is_admin()) with check (public.is_admin());

insert into public.green_rewards (name, points_cost, description, sort_order)
values
  ('Găng tay', 30000, 'Găng tay hỗ trợ các hoạt động làm sạch và bảo vệ môi trường.', 1),
  ('Áo Hà Nội Xanh', 110000, 'Áo Hà Nội Xanh dành cho hành trình đồng hành cùng cộng đồng.', 2)
on conflict do nothing;

create or replace function public.redeem_green_reward(
  requested_reward_id uuid,
  requested_points bigint,
  recipient_name text,
  recipient_phone text,
  recipient_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reward public.green_rewards;
  redemption public.green_redemptions;
begin
  if auth.uid() is null then raise exception 'Bạn cần đăng nhập để đổi quà.'; end if;
  if nullif(trim(recipient_name), '') is null or nullif(trim(recipient_phone), '') is null or nullif(trim(recipient_address), '') is null then
    raise exception 'Vui lòng điền đầy đủ thông tin nhận quà.';
  end if;
  select * into reward from public.green_rewards where id = requested_reward_id and active = true;
  if not found then raise exception 'Phần quà này hiện không còn khả dụng.'; end if;
  if requested_points is null or requested_points <> reward.points_cost then
    raise exception 'Số điểm đổi chính xác cho phần quà này là % điểm.', reward.points_cost;
  end if;

  update public.profiles
    set points_balance = points_balance - requested_points
    where id = auth.uid() and points_balance >= requested_points;
  if not found then raise exception 'Số điểm hiện có không đủ để đổi phần quà này.'; end if;

  insert into public.green_redemptions (user_id, reward_id, reward_name, points_spent, full_name, phone, delivery_address)
  values (auth.uid(), reward.id, reward.name, requested_points, trim(recipient_name), trim(recipient_phone), trim(recipient_address))
  returning * into redemption;

  return jsonb_build_object(
    'id', redemption.id,
    'reward_name', redemption.reward_name,
    'points_spent', redemption.points_spent,
    'remaining_points', (select points_balance from public.profiles where id = auth.uid())
  );
end;
$$;

revoke all on function public.redeem_green_reward(uuid, bigint, text, text, text) from public;
grant execute on function public.redeem_green_reward(uuid, bigint, text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- Add editable catalog images for green rewards.
alter table public.green_rewards
  add column if not exists image_url text not null default '';

update public.green_rewards
set image_url = '/source/rewards/green-gloves.png', updated_at = now()
where name = 'Găng tay Hà Nội Xanh' and coalesce(image_url, '') = '';

update public.green_rewards
set image_url = '/source/rewards/green-shirt.png', updated_at = now()
where name = 'Áo Hà Nội Xanh' and coalesce(image_url, '') = '';

notify pgrst, 'reload schema';

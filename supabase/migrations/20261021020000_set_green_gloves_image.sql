-- Replace the current gloves reward artwork with the generated illustration.
update public.green_rewards
set image_url = '/source/rewards/green-gloves.png',
    updated_at = now()
where name in ('Găng tay', 'Găng tay Hà Nội Xanh');

notify pgrst, 'reload schema';

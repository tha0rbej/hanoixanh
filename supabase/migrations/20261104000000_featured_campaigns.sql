-- Editable featured campaign cards shown on the homepage.
insert into public.homepage_metrics (metric_key, metric_value) values
  ('featured_campaigns', '{
    "description": "Những hoạt động đã hoàn thành — mỗi chiến dịch là một điểm rác được dọn sạch.",
    "items": [
      {"image_url":"/source/home/figma-impact-1.png","location":"Sông Lừ","completed_at":"2026-09-27","title":"Trả lại khoảng xanh bên sông Lừ","description":"Thu gom rác ven bờ, phân loại và tập kết để chuyển đi xử lý.","trash_kg":"600","volunteers":"45"},
      {"image_url":"/source/home/figma-impact-2.png","location":"Sông Nhuệ","completed_at":"2026-09-20","title":"Chung tay làm sạch sông Nhuệ","description":"Làm sạch điểm tồn đọng rác và kết nối người dân cùng giữ gìn.","trash_kg":"800","volunteers":"52"},
      {"image_url":"/source/home/figma-impact-3.png","location":"Sông Sét","completed_at":"2026-09-13","title":"Làm sạch rác ven sông Sét","description":"Thu gom rác nhựa, phân loại và làm sạch khu vực ven bờ.","trash_kg":"500","volunteers":"28"}
    ]
  }'::jsonb)
on conflict (metric_key) do nothing;

notify pgrst, 'reload schema';

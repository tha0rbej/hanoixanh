import type { BeforeAfterItem, CampaignEvent, CleanupLocation } from "./types";

export const CLEANUP_LOCATIONS: CleanupLocation[] = [
  { id: 1, title: "Sông Tô Lịch - Đoạn Hoàng Quốc Việt", status: "Đang dọn dẹp", district: "Cầu Giấy", volunteers: 45, trashCollected: "1,2 tấn", updatedAt: "2026-08-28", coordinator: "Nguyễn Văn Hùng", coords: { top: "35%", left: "42%" }, image: "https://images.unsplash.com/photo-1618477461853-cf6ed80faba5?w=500&auto=format&fit=crop", eventId: "to-lich-2026-09-05" },
  { id: 2, title: "Sông Lừ - Khương Trung", status: "Cần viện trợ", district: "Thanh Xuân", volunteers: 60, trashCollected: "2,5 tấn", updatedAt: "2026-08-30", coordinator: "Trần Thị Mai", coords: { top: "58%", left: "55%" }, image: "https://images.unsplash.com/photo-1530587191325-3db32d826c18?w=500&auto=format&fit=crop", eventId: "song-lu-2026-08-30" },
  { id: 3, title: "Kênh Nhuệ - Từ Liêm", status: "Hoàn thành", district: "Nam Từ Liêm", volunteers: 85, trashCollected: "4,1 tấn", updatedAt: "2026-08-20", coordinator: "Lê Hoàng Long", coords: { top: "45%", left: "28%" }, image: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=500&auto=format&fit=crop" },
  { id: 4, title: "Sông Sét - Định Công", status: "Đang dọn dẹp", district: "Hoàng Mai", volunteers: 50, trashCollected: "1,8 tấn", updatedAt: "2026-08-29", coordinator: "Đoàn Minh Anh", coords: { top: "70%", left: "62%" }, image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&auto=format&fit=crop" },
  { id: 5, title: "Sông Kim Ngưu - Thanh Nhàn", status: "Sắp ra quân", district: "Hai Bà Trưng", volunteers: 40, trashCollected: "Dự kiến 2 tấn", updatedAt: "2026-09-02", coordinator: "Phạm Hải Đăng", coords: { top: "50%", left: "68%" }, image: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=500&auto=format&fit=crop", eventId: "kim-nguu-2026-09-12" },
];

export const CAMPAIGN_EVENTS: CampaignEvent[] = [
  { id: "song-lu-2026-08-30", locationId: 2, title: "Dọn dẹp Sông Lừ - Khương Trung", date: "2026-08-30", startTime: "07:30", endTime: "11:30", location: "Cầu Khương Đình, Thanh Xuân", capacity: 50, status: "Đang mở đăng ký" },
  { id: "to-lich-2026-09-05", locationId: 1, title: "Chiến dịch Sông Tô Lịch xanh", date: "2026-09-05", startTime: "08:00", endTime: "12:00", location: "Đoạn Hoàng Quốc Việt, Cầu Giấy", capacity: 80, status: "Sắp diễn ra" },
  { id: "kim-nguu-2026-09-12", locationId: 5, title: "Trồng cây ven Sông Kim Ngưu", date: "2026-09-12", startTime: "08:00", endTime: "11:00", location: "Cầu Mai Động, Hai Bà Trưng", capacity: 30, status: "Chuẩn bị" },
];

export const BEFORE_AFTER_ITEMS: BeforeAfterItem[] = [
  { id: 1, locationId: 1, location: "Sông Tô Lịch - Cầu Giấy", date: "Đợt 12 - Tháng 08/2026", trash: "3,5 tấn rác thải", beforeImg: "https://images.unsplash.com/photo-1618477461853-cf6ed80faba5?w=800&auto=format&fit=crop", afterImg: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop" },
  { id: 2, locationId: 2, location: "Sông Lừ - Khương Trung", date: "Đợt 08 - Tháng 07/2026", trash: "4,2 tấn rác thải", beforeImg: "https://images.unsplash.com/photo-1530587191325-3db32d826c18?w=800&auto=format&fit=crop", afterImg: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&auto=format&fit=crop" },
  { id: 3, locationId: 4, location: "Sông Sét - Định Công", date: "Đợt 15 - Tháng 08/2026", trash: "2,8 tấn rác thải", beforeImg: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=800&auto=format&fit=crop", afterImg: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800&auto=format&fit=crop" },
];

export const DISTRICTS = ["Tất cả", ...new Set(CLEANUP_LOCATIONS.map((item) => item.district))];

export const STORAGE_KEYS = {
  registrations: "hnx:v1:registrations",
  reports: "hnx:v1:pollution-reports",
  messages: "hnx:v1:contact-messages",
} as const;

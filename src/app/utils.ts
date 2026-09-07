import type { CampaignEvent, CleanupLocation, VolunteerRegistration } from "./types";

export function normalizeVietnamese(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase("vi").trim();
}

export function filterLocations(locations: CleanupLocation[], query: string, district: string) {
  const normalizedQuery = normalizeVietnamese(query);
  return locations.filter((item) => {
    const haystack = normalizeVietnamese(`${item.title} ${item.district}`);
    return (!normalizedQuery || haystack.includes(normalizedQuery)) && (district === "Tất cả" || item.district === district);
  });
}

export function formatVietnameseDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export function eventHasEnded(event: CampaignEvent, now = new Date()) {
  return new Date(`${event.date}T${event.endTime}:00`).getTime() < now.getTime();
}

export function isDuplicateRegistration(registrations: VolunteerRegistration[], eventId: string, email: string, phone: string) {
  const cleanEmail = email.trim().toLocaleLowerCase();
  const cleanPhone = phone.replace(/[^\d+]/g, "");
  return registrations.some((item) => item.eventId === eventId && (item.email.toLocaleLowerCase() === cleanEmail || item.phone.replace(/[^\d+]/g, "") === cleanPhone));
}

export function isValidVietnamesePhone(value: string) {
  const normalized = value.replace(/[\s.-]/g, "");
  return /^(?:\+84|0)\d{9}$/.test(normalized);
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

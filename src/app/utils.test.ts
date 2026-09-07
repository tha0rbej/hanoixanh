import { describe, expect, it } from "vitest";
import { CLEANUP_LOCATIONS } from "./data";
import { eventHasEnded, filterLocations, isDuplicateRegistration, isValidVietnamesePhone, normalizeVietnamese } from "./utils";
import type { CampaignEvent, VolunteerRegistration } from "./types";

describe("frontend domain helpers", () => {
  it("normalizes Vietnamese text and searches without accents", () => {
    expect(normalizeVietnamese("Sông Tô Lịch")).toBe("song to lich");
    expect(filterLocations(CLEANUP_LOCATIONS, "to lich", "Tất cả").map((x) => x.id)).toEqual([1]);
  });

  it("combines query and district filters", () => {
    expect(filterLocations(CLEANUP_LOCATIONS, "song", "Thanh Xuân").map((x) => x.id)).toEqual([2]);
    expect(filterLocations(CLEANUP_LOCATIONS, "không tồn tại", "Tất cả")).toEqual([]);
  });

  it("determines event availability from ISO date and end time", () => {
    const event = { date: "2026-09-12", endTime: "11:00" } as CampaignEvent;
    expect(eventHasEnded(event, new Date("2026-09-12T10:59:00"))).toBe(false);
    expect(eventHasEnded(event, new Date("2026-09-12T11:01:00"))).toBe(true);
  });

  it("validates Vietnamese phone formats", () => {
    expect(isValidVietnamesePhone("0912 345 678")).toBe(true);
    expect(isValidVietnamesePhone("+84 912 345 678")).toBe(true);
    expect(isValidVietnamesePhone("12345")).toBe(false);
  });

  it("detects duplicate email or phone within the same event", () => {
    const saved = [{ eventId: "a", email: "User@example.com", phone: "0912 345 678" }] as VolunteerRegistration[];
    expect(isDuplicateRegistration(saved, "a", "user@example.com", "0999999999")).toBe(true);
    expect(isDuplicateRegistration(saved, "a", "other@example.com", "0912345678")).toBe(true);
    expect(isDuplicateRegistration(saved, "b", "user@example.com", "0912345678")).toBe(false);
  });
});

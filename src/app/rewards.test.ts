import { describe, expect, it } from "vitest"
import { DEFAULT_REWARD_PROGRAM, clampCampaignPoints, earnedBadges, monthsSince, updateCumulativePoints } from "./rewards"

describe("volunteer rewards", () => {
  it("keeps campaign rewards inside the 10,000–15,000 point scale", () => {
    expect(clampCampaignPoints(8_000)).toBe(10_000)
    expect(clampCampaignPoints(12_500)).toBe(12_500)
    expect(clampCampaignPoints(18_000)).toBe(15_000)
  })

  it("accumulates points from every confirmed campaign without double counting edits", () => {
    const afterFirstCampaign = updateCumulativePoints(0, 0, 10_000)
    const afterSecondCampaign = updateCumulativePoints(afterFirstCampaign, 0, 15_000)
    const afterEditingSecondCampaign = updateCumulativePoints(afterSecondCampaign, 15_000, 12_000)

    expect(afterFirstCampaign).toBe(10_000)
    expect(afterSecondCampaign).toBe(25_000)
    expect(afterEditingSecondCampaign).toBe(22_000)
  })

  it("awards badges only when every configured milestone is met", () => {
    const badges = earnedBadges(DEFAULT_REWARD_PROGRAM, { campaigns: 10, hours: 40, activeMonths: 4, tenureMonths: 6 })
    expect(badges.filter(badge => badge.earned).map(badge => badge.id)).toEqual(["mam-xanh", "nhip-xanh", "ben-bi", "dong-hanh"])
  })

  it("calculates completed months of membership", () => {
    expect(monthsSince("2026-01-18", new Date("2026-10-17T12:00:00+07:00"))).toBe(8)
    expect(monthsSince("2026-01-17", new Date("2026-10-17T12:00:00+07:00"))).toBe(9)
  })
})

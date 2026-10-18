export type BadgeRule = {
  id: string
  name: string
  description: string
  icon: string
  minCampaigns: number
  minHours: number
  minActiveMonths: number
  minTenureMonths: number
}

export type RewardProgram = {
  campaignMinPoints: number
  campaignMaxPoints: number
  badges: BadgeRule[]
}

export type VolunteerProgress = {
  campaigns: number
  hours: number
  activeMonths: number
  tenureMonths: number
}

export const DEFAULT_REWARD_PROGRAM: RewardProgram = {
  campaignMinPoints: 10_000,
  campaignMaxPoints: 15_000,
  badges: [
    { id: "mam-xanh", name: "Mầm xanh", description: "Hoàn thành chiến dịch đầu tiên", icon: "fa-seedling", minCampaigns: 1, minHours: 0, minActiveMonths: 0, minTenureMonths: 0 },
    { id: "nhip-xanh", name: "Nhịp xanh đều đặn", description: "Tham gia ít nhất 3 chiến dịch trong 2 tháng hoạt động", icon: "fa-calendar-check", minCampaigns: 3, minHours: 0, minActiveMonths: 2, minTenureMonths: 0 },
    { id: "ben-bi", name: "Bền bỉ theo mùa", description: "Hoàn thành 6 chiến dịch, 24 giờ trong 3 tháng hoạt động", icon: "fa-person-hiking", minCampaigns: 6, minHours: 24, minActiveMonths: 3, minTenureMonths: 0 },
    { id: "dong-hanh", name: "Đồng hành dài lâu", description: "Gắn bó 6 tháng, hoàn thành 10 chiến dịch và 40 giờ", icon: "fa-tree", minCampaigns: 10, minHours: 40, minActiveMonths: 0, minTenureMonths: 6 },
    { id: "dai-su", name: "Đại sứ xanh", description: "Gắn bó 1 năm, hoạt động trong 8 tháng, hoàn thành 20 chiến dịch và 100 giờ", icon: "fa-medal", minCampaigns: 20, minHours: 100, minActiveMonths: 8, minTenureMonths: 12 },
  ],
}

const numberOr = (value: unknown, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

export function normalizeRewardProgram(value: unknown): RewardProgram {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const rawBadges = Array.isArray(source.badges) ? source.badges : DEFAULT_REWARD_PROGRAM.badges
  return {
    campaignMinPoints: 10_000,
    campaignMaxPoints: 15_000,
    badges: rawBadges.map((item, index) => {
      const badge = item && typeof item === "object" ? item as Record<string, unknown> : {}
      const fallback = DEFAULT_REWARD_PROGRAM.badges[index] || DEFAULT_REWARD_PROGRAM.badges[0]
      return {
        id: String(badge.id || fallback.id || `huy-hieu-${index + 1}`),
        name: String(badge.name || fallback.name || `Huy hiệu ${index + 1}`),
        description: String(badge.description || fallback.description || "Mốc ghi nhận hoạt động tình nguyện"),
        icon: String(badge.icon || fallback.icon || "fa-award"),
        minCampaigns: numberOr(badge.minCampaigns, fallback.minCampaigns),
        minHours: numberOr(badge.minHours, fallback.minHours),
        minActiveMonths: numberOr(badge.minActiveMonths, fallback.minActiveMonths),
        minTenureMonths: numberOr(badge.minTenureMonths, fallback.minTenureMonths),
      }
    }),
  }
}

export function earnedBadges(program: RewardProgram, progress: VolunteerProgress) {
  return program.badges.map(badge => ({
    ...badge,
    earned:
      progress.campaigns >= badge.minCampaigns &&
      progress.hours >= badge.minHours &&
      progress.activeMonths >= badge.minActiveMonths &&
      progress.tenureMonths >= badge.minTenureMonths,
  }))
}

export function clampCampaignPoints(points: number) {
  return Math.min(15_000, Math.max(10_000, Math.round(points || 10_000)))
}

export function updateCumulativePoints(currentTotal: number, previousCampaignPoints: number, nextCampaignPoints: number) {
  return Math.max(0, Math.round(currentTotal || 0) - Math.round(previousCampaignPoints || 0) + Math.round(nextCampaignPoints || 0))
}

export function monthsSince(dateValue?: string | null, now = new Date()) {
  if (!dateValue) return 0
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return 0
  const months = (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth()
  return Math.max(0, months - (now.getDate() < date.getDate() ? 1 : 0))
}

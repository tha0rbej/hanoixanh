import { useEffect, useRef, useState } from "react"
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom"
import { AdminDashboard } from "./app/AdminDashboard"
import { ConnectedAdminDashboard } from "./app/ConnectedAdminDashboard"
import { AuthModal } from "./app/AuthModal"
import { AuthProvider, useAuth } from "./app/AuthContext"
import { ResetPasswordPage } from "./app/ResetPasswordPage"
import { DEFAULT_REWARD_PROGRAM, earnedBadges, monthsSince, normalizeRewardProgram } from "./app/rewards"
import { consumeOAuthSession, formatOAuthError, isOAuthCallback, rpc, tableInsert, tableInsertMinimal, tableSelect, takeOAuthReturnTo, updateProfile, uploadPublicFile } from "./lib/supabase"
import { trackEvent, trackPageView } from "./lib/analytics"

type SourcePage = "home" | "about" | "remaining" | "profile"

const allowedPaths = new Set([
  "/",
  "/ve-ha-noi-xanh",
  "/ve-ha-noi-xanh/cau-chuyen",
  "/ve-ha-noi-xanh/doanh-nghiep-xa-hoi",
  "/ve-ha-noi-xanh/doi-ngu",
  "/chien-dich",
  "/tac-dong",
  "/tin-tuc",
  "/tham-gia",
  "/ho-so",
  "/admin",
])

type ParticipationSummaryRow = {
  status?: string
  attended_hours?: number | string
  trash_kg?: number | string
  awarded_points?: number | string
  attended_at?: string | null
  campaign_id?: string | null
  campaign_key?: string | null
  created_at?: string
}
type CampaignSummaryRow = { id: string; title?: string; location?: string; start_at?: string; reward_points?: number }
type RewardMetricRow = { metric_key: string; metric_value: unknown }

function volunteerLevel(campaigns: number, hours: number) {
  if (campaigns >= 15 && hours >= 100) return "Đại sứ Xanh"
  if (campaigns >= 8 && hours >= 40) return "Thành viên nòng cốt"
  if (campaigns >= 3 && hours >= 12) return "Tình nguyện viên tích cực"
  if (campaigns >= 1) return "Tình nguyện viên"
  return "Thành viên mới"
}

function SourceFrame({
  page,
  view,
  title,
  onAuth,
}: {
  page: SourcePage
  view?: string
  title: string
  onAuth: (tab: "login" | "register" | "reset") => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { session, profile, refreshProfile, signOut, changePassword } = useAuth()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pendingReportRef = useRef<{ location?: string; description?: string; latitude?: number; longitude?: number; image?: File | null; images?: File[] } | null>(null)
  const baseUrl = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  const source = `${baseUrl}source/${page}/index.html${view ? `#${view}` : ""}`

  const sendAuthState = async () => {
    if (!profile || !session) {
      frameRef.current?.contentWindow?.postMessage({ type: "hnx:auth-state", user: null }, window.location.origin)
      return
    }
    let campaigns = 0
    let hours = 0
    let badgeDetails = earnedBadges(DEFAULT_REWARD_PROGRAM, { campaigns: 0, hours: 0, activeMonths: 0, tenureMonths: monthsSince(profile.created_at) })
    let history: Array<{ title: string; location: string; date: string; status: string; hours: number }> = []
    try {
      const registrations = await tableSelect<ParticipationSummaryRow>("campaign_registrations", "*", session.access_token, `&user_id=eq.${encodeURIComponent(session.user.id)}`)
      const [campaignRows, rewardRows] = await Promise.all([
        tableSelect<CampaignSummaryRow>("campaigns", "*", session.access_token),
        tableSelect<RewardMetricRow>("homepage_metrics", "metric_key,metric_value", session.access_token, "&metric_key=eq.reward_program&limit=1"),
      ])
      const campaignMap = new Map(campaignRows.map(item => [item.id, item]))
      const activeRegistrations = Array.from(new Map(
        registrations
          .filter(item => item.status !== "cancelled")
          .filter(item => campaignMap.has(item.campaign_id || item.campaign_key || ""))
          .map(item => [item.campaign_id || item.campaign_key || item.created_at || "", item]),
      ).values())
      const attended = activeRegistrations.filter(item => item.status === "attended")
      campaigns = activeRegistrations.length
      hours = attended.reduce((sum, item) => sum + Number(item.attended_hours || 0), 0)
      const activeMonths = new Set(attended.map(item => {
        const campaign = campaignMap.get(item.campaign_id || item.campaign_key || "")
        const date = item.attended_at || campaign?.start_at || item.created_at || ""
        return date.slice(0, 7)
      }).filter(Boolean)).size
      badgeDetails = earnedBadges(normalizeRewardProgram(rewardRows[0]?.metric_value), {
        campaigns: attended.length,
        hours,
        activeMonths,
        tenureMonths: monthsSince(profile.created_at),
      })
      history = activeRegistrations.map(item => {
        const campaign = campaignMap.get(item.campaign_id || item.campaign_key || "")
        return {
          title: campaign?.title || "Chiến dịch Hà Nội Xanh",
          location: campaign?.location || "Chưa cập nhật địa điểm",
          date: campaign?.start_at || item.created_at || "",
          status: item.status || "registered",
          hours: Number(item.attended_hours || 0),
        }
      })
    } catch {
      // Keep the profile available even before the participation migration is applied.
    }
    frameRef.current?.contentWindow?.postMessage({
      type: "hnx:auth-state",
      user: {
        id: profile.id,
        name: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        avatarUrl: profile.avatar_url,
        volunteerCode: profile.volunteer_code,
        birthDate: profile.birth_date,
        gender: profile.gender,
        address: profile.address,
        occupation: profile.occupation,
        interests: profile.interests,
        bio: profile.bio,
        joinedAt: profile.created_at,
        role: profile.role,
        camps: campaigns,
        hours,
        points: Number(profile.points_balance || 0),
        badges: badgeDetails.filter(item => item.earned).length,
        badgeDetails,
        history,
        level: volunteerLevel(campaigns, hours),
      },
    }, window.location.origin)
  }

  useEffect(() => {
    const receiveNavigation = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const message = event.data as { type?: string; path?: string; section?: string; tab?: "login" | "register" | "reset"; campaignKey?: string; location?: string; description?: string; email?: string; latitude?: number; longitude?: number; fullName?: string; phone?: string; organization?: string; organizationType?: string; birthDate?: string; gender?: string; address?: string; occupation?: string; interests?: string; bio?: string; currentPassword?: string; newPassword?: string; image?: File; images?: File[]; rewardId?: string; points?: number; deliveryAddress?: string }
      if (message?.type === "hnx:navigate" && message.path && allowedPaths.has(message.path)) {
        const section = message.section?.replace(/[^a-z0-9-]/gi, "")
        const destination = section ? `${message.path}#${section}` : message.path
        if (destination !== `${location.pathname}${location.hash}`) navigate(destination)
        return
      }
      if (message?.type === "hnx:auth-open") { onAuth(message.tab || "login"); return }
      if (message?.type === "hnx:donation-info") {
        trackEvent("click_donation_info", { click_location: page })
        return
      }
      if (message?.type === "hnx:volunteer-register" || message?.type === "hnx:partner-register") {
        if (!session) { onAuth("login"); return }
        void (async () => {
          try {
            if (message.type === "hnx:volunteer-register") {
              const existing = await tableSelect<{ id: string }>("volunteer_registrations", "id", session.access_token, `&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`)
              if (existing.length) throw new Error("Bạn đã đăng ký rồi.")
              await tableInsert("volunteer_registrations", { user_id: session.user.id, name: message.fullName || profile?.full_name || "", email: message.email || profile?.email || "", phone: message.phone || profile?.phone || null, address: message.address || profile?.address || null }, session.access_token)
            } else {
              const existing = await tableSelect<{ id: string }>("partners", "id", session.access_token, `&email=ilike.${encodeURIComponent(message.email || "")}&limit=1`)
              if (existing.length) throw new Error("Email này đã đăng ký đối tác rồi.")
              await tableInsert("partners", { user_id: session.user.id, name: message.fullName || "", email: message.email || "", phone: message.phone || "", organization: message.organization || "", organization_type: message.organizationType || "" }, session.access_token)
            }
            frameRef.current?.contentWindow?.postMessage({ type: "hnx:participation-result", kind: message.type === "hnx:partner-register" ? "partner" : "volunteer", ok: true }, window.location.origin)
          } catch (error) { frameRef.current?.contentWindow?.postMessage({ type: "hnx:participation-result", kind: message.type === "hnx:partner-register" ? "partner" : "volunteer", ok: false, message: error instanceof Error ? error.message : "Không thể đăng ký." }, window.location.origin) }
        })()
        return
      }
      if (message?.type === "hnx:contact-message") {
        void tableInsertMinimal("contact_messages", { name: message.fullName || profile?.full_name || "Khách chưa đăng nhập", email: message.email || profile?.email || "", message: message.description || "", user_id: session?.user.id || null }, session?.access_token || "")
          .then(() => { trackEvent("send_message_success"); frameRef.current?.contentWindow?.postMessage({ type: "hnx:contact-message-result", ok: true }, window.location.origin) })
          .catch((error: Error) => frameRef.current?.contentWindow?.postMessage({ type: "hnx:contact-message-result", ok: false, message: error.message || "Không thể gửi lời nhắn." }, window.location.origin))
        return
      }
      if (message?.type === "hnx:campaign-register") {
        trackEvent("click_register", { campaign_id: message.campaignKey || "unknown", click_location: page === "home" ? "homepage_campaign_modal" : "campaign_detail_modal" })
        if (!session) { onAuth("login"); return }
        void tableSelect<{ id: string }>("campaign_registrations", "id", session.access_token, `&user_id=eq.${encodeURIComponent(session.user.id)}&campaign_key=eq.${encodeURIComponent(message.campaignKey || "")}&limit=1`)
          .then((existing) => { if (existing.length) throw new Error("Bạn đã đăng ký tham gia chiến dịch này rồi."); return tableInsert("campaign_registrations", { user_id: session.user.id, campaign_key: message.campaignKey, status: "registered" }, session.access_token) })
          .then(async () => {
            frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaign-register-result", ok: true }, window.location.origin)
            trackEvent("volunteer_registration_success", { campaign_id: message.campaignKey || "unknown" })
            await sendCampaignsState()
            void sendAuthState()
          })
          .catch((error: Error) => frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaign-register-result", ok: false, message: error.message.includes("duplicate") ? "Bạn đã đăng ký tham gia chiến dịch này rồi." : error.message }, window.location.origin))
        return
      }
      if (message?.type === "hnx:green-redeem") {
        if (!session) { onAuth("login"); return }
        void (async () => {
          try {
            const result = await rpc<{ id: string; reward_name: string; points_spent: number; remaining_points: number }>("redeem_green_reward", {
              requested_reward_id: message.rewardId,
              requested_points: Math.floor(Number(message.points || 0)),
              recipient_name: message.fullName || "",
              recipient_phone: message.phone || "",
              recipient_address: message.deliveryAddress || "",
            }, session.access_token)
            await refreshProfile()
            frameRef.current?.contentWindow?.postMessage({ type: "hnx:green-redeem-result", ok: true, redemption: result }, window.location.origin)
            window.setTimeout(() => void sendAuthState(), 0)
            const token = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
            if (token) void (async () => {
              const periods = ["month", "year", "all"] as const
              const entries = await Promise.all(periods.map(async period => {
                const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_points_leaderboard`, { method: "POST", headers: { apikey: token, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ period_key: period, row_limit: 10 }) })
                const rows = response.ok ? await response.json() : []
                return [period, Array.isArray(rows) ? rows : []] as const
              }))
              frameRef.current?.contentWindow?.postMessage({ type: "hnx:leaderboard-data", leaderboards: Object.fromEntries(entries) }, window.location.origin)
            })()
          } catch (error) { frameRef.current?.contentWindow?.postMessage({ type: "hnx:green-redeem-result", ok: false, message: error instanceof Error ? error.message : "Không thể đổi quà lúc này." }, window.location.origin) }
        })()
        return
      }
      if (message?.type === "hnx:pollution-report") {
        if (!session) { pendingReportRef.current = message; onAuth("login"); return }
        void (async () => {
          try {
            const images = Array.isArray(message.images) ? message.images : (message.image ? [message.image] : [])
            const photoUrls = await Promise.all(images.filter((image): image is File => image instanceof File).map(image => uploadPublicFile(image, session.access_token)))
            try {
              await tableInsertMinimal("pollution_reports", { user_id: session.user.id, location_name: message.location, address: message.location, latitude: message.latitude || null, longitude: message.longitude || null, description: message.description, photo_url: photoUrls[0] || null, photo_urls: photoUrls, status: "new", severity: "medium" }, session.access_token)
            } catch (cause) {
              if (!String(cause).includes("photo_urls")) throw cause
              await tableInsertMinimal("pollution_reports", { user_id: session.user.id, location_name: message.location, address: message.location, latitude: message.latitude || null, longitude: message.longitude || null, description: message.description, photo_url: photoUrls[0] || null, status: "new", severity: "medium" }, session.access_token)
            }
            trackEvent("pollution_report_success", { report_type: "pollution" })
            frameRef.current?.contentWindow?.postMessage({ type: "hnx:pollution-report-result", ok: true }, window.location.origin)
          } catch (error) { frameRef.current?.contentWindow?.postMessage({ type: "hnx:pollution-report-result", ok: false, message: error instanceof Error ? error.message : "Không gửi được báo cáo." }, window.location.origin) }
        })()
      }
      if (message?.type === "hnx:profile-update" && session) {
        void (async () => {
          try {
            const avatarUrl = message.image instanceof File ? await uploadPublicFile(message.image, session.access_token) : undefined
            await updateProfile(session.user.id, {
              full_name: message.fullName,
              phone: message.phone,
              birth_date: message.birthDate || null,
              gender: message.gender || null,
              address: message.address || null,
              occupation: message.occupation || null,
              interests: message.interests || null,
              bio: message.bio || null,
              ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
            }, session.access_token)
            await refreshProfile()
            frameRef.current?.contentWindow?.postMessage({ type: "hnx:profile-update-result", ok: true }, window.location.origin)
          } catch (error) { frameRef.current?.contentWindow?.postMessage({ type: "hnx:profile-update-result", ok: false, message: error instanceof Error ? error.message : "Không cập nhật được hồ sơ." }, window.location.origin) }
        })()
      }
      if (message?.type === "hnx:password-update") {
        void changePassword(message.currentPassword || "", message.newPassword || "")
          .then(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:password-update-result", ok: true }, window.location.origin))
          .catch((error: Error) => frameRef.current?.contentWindow?.postMessage({ type: "hnx:password-update-result", ok: false, message: error.message || "Mật khẩu hiện tại không đúng." }, window.location.origin))
        return
      }
      if (message?.type === "hnx:signout") {
        void signOut().finally(() => navigate("/"))
        return
      }
    }
    window.addEventListener("message", receiveNavigation)
    return () => window.removeEventListener("message", receiveNavigation)
  }, [changePassword, location.pathname, navigate, onAuth, page, profile, refreshProfile, session, signOut])

  useEffect(() => {
    const report = pendingReportRef.current
    if (!session || !report) return
    pendingReportRef.current = null
    void (async () => {
      try {
        const images = Array.isArray(report.images) ? report.images : (report.image ? [report.image] : [])
        const photoUrls = await Promise.all(images.filter((image): image is File => image instanceof File).map(image => uploadPublicFile(image, session.access_token)))
        try {
          await tableInsertMinimal("pollution_reports", { user_id: session.user.id, location_name: report.location, address: report.location, latitude: report.latitude || null, longitude: report.longitude || null, description: report.description, photo_url: photoUrls[0] || null, photo_urls: photoUrls, status: "new", severity: "medium" }, session.access_token)
        } catch (cause) {
          if (!String(cause).includes("photo_urls")) throw cause
          await tableInsertMinimal("pollution_reports", { user_id: session.user.id, location_name: report.location, address: report.location, latitude: report.latitude || null, longitude: report.longitude || null, description: report.description, photo_url: photoUrls[0] || null, status: "new", severity: "medium" }, session.access_token)
        }
        trackEvent("pollution_report_success", { report_type: "pollution" })
        frameRef.current?.contentWindow?.postMessage({ type: "hnx:pollution-report-result", ok: true }, window.location.origin)
      } catch (error) { frameRef.current?.contentWindow?.postMessage({ type: "hnx:pollution-report-result", ok: false, message: error instanceof Error ? error.message : "Không gửi được báo cáo." }, window.location.origin) }
    })()
  }, [session])

  useEffect(() => {
    void sendAuthState()
    const sharedCampaign = new URLSearchParams(location.search).get("campaign")
    if (sharedCampaign && page === "remaining") {
      window.setTimeout(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:shared-campaign", campaignKey: sharedCampaign }, window.location.origin), 120)
    }
  }, [location.search, page, profile, session])

  const sendCampaignsState = async () => {
    const token = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
    if (!token || !supabaseUrl) return
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/campaigns?select=*&order=start_at.desc`, {
        cache: "no-store",
        headers: { apikey: token, Authorization: `Bearer ${token}` },
      })
      if (!response.ok) return
      const campaigns = await response.json()
      if (!Array.isArray(campaigns)) return
      let countsByCampaign = new Map<string, number>()
      try {
        const countResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_campaign_registration_counts`, {
          cache: "no-store",
          headers: { apikey: token, Authorization: `Bearer ${token}` },
        })
        if (countResponse.ok) {
          const countRows = await countResponse.json()
          if (Array.isArray(countRows)) countsByCampaign = new Map(countRows.map(row => [String(row.campaign_id), Number(row.registered_count || 0)]))
        }
      } catch {
        // Keep the denormalized campaign value when the count RPC is not deployed yet.
      }
      const synchronizedCampaigns = campaigns.map(campaign => ({
        ...campaign,
        registered_count: countsByCampaign.has(String(campaign.id))
          ? countsByCampaign.get(String(campaign.id))
          : Number(campaign.registered_count || 0),
      }))
      frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaigns-data", campaigns: synchronizedCampaigns }, window.location.origin)
    } catch {
      // The page keeps its current campaign list when a background refresh fails.
    }
  }

  const handleFrameLoad = () => {
    if (page === "home") frameRef.current?.contentWindow?.postMessage({ type: "hnx:scroll-top" }, window.location.origin)
    void sendAuthState()
    const sharedCampaign = new URLSearchParams(location.search).get("campaign")
    if (sharedCampaign && page === "remaining") {
      frameRef.current?.contentWindow?.postMessage({ type: "hnx:shared-campaign", campaignKey: sharedCampaign }, window.location.origin)
    }
    const token = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    void sendCampaignsState()
    if (token) void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/homepage_metrics?select=metric_key,metric_value`, { headers: { apikey: token, Authorization: `Bearer ${token}` } }).then(r => r.json()).then(metrics => frameRef.current?.contentWindow?.postMessage({ type: "hnx:homepage-metrics", metrics }, window.location.origin))
    if (token && page === "remaining") void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/green_rewards?select=*&active=eq.true&order=sort_order.asc`, { cache: "no-store", headers: { apikey: token, Authorization: `Bearer ${session?.access_token || token}` } }).then(response => response.ok ? response.json() : Promise.reject(new Error(`Không tải được danh mục quà (${response.status}).`))).then(rewards => frameRef.current?.contentWindow?.postMessage({ type: "hnx:green-rewards-data", rewards: Array.isArray(rewards) ? rewards : [] }, window.location.origin)).catch(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:green-rewards-data", rewards: [] }, window.location.origin))
    if (token) void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/posts?select=*&status=eq.published&order=published_at.desc.nullslast,created_at.desc`, { headers: { apikey: token, Authorization: `Bearer ${token}` } }).then(r => r.json()).then(posts => frameRef.current?.contentWindow?.postMessage({ type: "hnx:posts-data", posts: Array.isArray(posts) ? posts : [] }, window.location.origin))
    if (token && page === "remaining") void (async () => {
      const periods = ["month", "year", "all"] as const
      const entries = await Promise.all(periods.map(async period => {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_points_leaderboard`, {
          method: "POST",
          headers: { apikey: token, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ period_key: period, row_limit: 10 }),
        })
        if (!response.ok) return [period, []] as const
        const rows = await response.json()
        return [period, Array.isArray(rows) ? rows : []] as const
      }))
      frameRef.current?.contentWindow?.postMessage({ type: "hnx:leaderboard-data", leaderboards: Object.fromEntries(entries) }, window.location.origin)
    })().catch(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:leaderboard-data", leaderboards: { month: [], year: [], all: [] } }, window.location.origin))
    if (session) void tableSelect<{ campaign_key: string | null }>("campaign_registrations", "campaign_key", session.access_token, `&user_id=eq.${encodeURIComponent(session.user.id)}`).then(items => frameRef.current?.contentWindow?.postMessage({ type: "hnx:registered-campaigns", keys: items.map(x => x.campaign_key).filter(Boolean) }, window.location.origin))
    const section = location.hash.replace(/^#/, "")
    if (section) window.setTimeout(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:scroll-section", section }, window.location.origin), 50)
  }

  useEffect(() => {
    if (page !== "home") return
    frameRef.current?.contentWindow?.postMessage({ type: "hnx:scroll-top" }, window.location.origin)
    const timer = window.setTimeout(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:scroll-top" }, window.location.origin), 100)
    return () => window.clearTimeout(timer)
  }, [page, source])

  useEffect(() => {
    if (!['home', 'about', 'remaining'].includes(page)) return
    const refresh = () => { void sendCampaignsState() }
    const timer = window.setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [page, source])

  return (
    <iframe
      ref={frameRef}
      onLoad={handleFrameLoad}
      key={source}
      src={source}
      title={title}
      style={{ visibility: "visible" }}
      className="site-frame"
    />
  )
}

function AppRoutes() {
  const [authTab, setAuthTab] = useState<("login" | "register" | "reset") | null>(null)
  const [authError, setAuthError] = useState("")
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()
  useEffect(() => {
    trackPageView(location.pathname)
  }, [location.pathname])
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    const isRecovery = hash.get("type") === "recovery"
    if (isOAuthCallback()) {
      const returnTo = takeOAuthReturnTo()
      void consumeOAuthSession()
        .then(session => {
          if (!session) throw new Error("OAuth callback did not contain a session.")
          window.location.replace(returnTo)
        })
        .catch(error => {
          console.error("Không thể hoàn tất đăng nhập Google", error)
          const destination = new URL(returnTo, window.location.origin)
          destination.searchParams.set("auth", "login")
          destination.searchParams.set("auth_error", formatOAuthError(error))
          window.location.replace(`${destination.pathname}${destination.search}${destination.hash}`)
        })
      return
    }
    if (params.get("auth") === "login") {
      setAuthError(params.get("auth_error") || "")
      setAuthTab("login")
      params.delete("auth")
      params.delete("auth_error")
      const cleanSearch = params.toString()
      window.history.replaceState({}, "", `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${window.location.hash}`)
    }
    if (isRecovery && window.location.pathname !== "/dat-lai-mat-khau") {
      navigate(`/dat-lai-mat-khau${window.location.hash}`, { replace: true })
    }
  }, [navigate])
  useEffect(() => {
    const sharedCampaign = new URLSearchParams(location.search).get("campaign")
    if (sharedCampaign && location.pathname === "/chien-dich" && !session) setAuthTab("login")
  }, [location.pathname, location.search, session])
  const openAuth = (tab: "login" | "register" | "reset") => { setAuthError(""); setAuthTab(tab) }
  const closeAuth = () => { setAuthError(""); setAuthTab(null) }
  return (
    <>
    <Routes>
      <Route
        index
        element={<SourceFrame page="home" title="Trang chủ Hà Nội Xanh" onAuth={openAuth} />}
      />
      <Route
        path="ve-ha-noi-xanh"
        element={
          <SourceFrame
            page="about"
            view="ve-chung-toi"
            title="Về Hà Nội Xanh" onAuth={openAuth}
          />
        }
      />
      <Route
        path="ve-ha-noi-xanh/cau-chuyen"
        element={<SourceFrame page="about" view="ve-chung-toi" title="Câu chuyện & CLB - Hà Nội Xanh" onAuth={openAuth} />}
      />
      <Route
        path="ve-ha-noi-xanh/doanh-nghiep-xa-hoi"
        element={<SourceFrame page="about" view="doanh-nghiep" title="Doanh nghiệp xã hội - Hà Nội Xanh" onAuth={openAuth} />}
      />
      <Route
        path="ve-ha-noi-xanh/doi-ngu"
        element={<SourceFrame page="about" view="doi-ngu" title="Đội ngũ - Hà Nội Xanh" onAuth={openAuth} />}
      />
      <Route
        path="tham-gia"
        element={
          <SourceFrame
            page="about"
            view="tham-gia"
            title="Tham gia Hà Nội Xanh" onAuth={openAuth}
          />
        }
      />
      <Route
        path="chien-dich"
        element={
          <SourceFrame
            page="remaining"
            view="chien-dich"
            title="Chiến dịch Hà Nội Xanh" onAuth={openAuth}
          />
        }
      />
      <Route
        path="tac-dong"
        element={
          <SourceFrame
            page="remaining"
            view="tac-dong"
            title="Tác động cộng đồng" onAuth={openAuth}
          />
        }
      />
      <Route
        path="tin-tuc"
        element={
          <SourceFrame
            page="remaining"
            view="tin-tuc"
            title="Tin tức và câu chuyện" onAuth={openAuth}
          />
        }
      />
      <Route
        path="ho-so"
        element={
          <SourceFrame
            page="profile"
            title="Hồ sơ cá nhân - Hà Nội Xanh"
            onAuth={openAuth}
          />
        }
      />
      <Route path="admin" element={<ConnectedAdminDashboard onLogin={() => setAuthTab("login")} />} />
      <Route path="dat-lai-mat-khau" element={<ResetPasswordPage />} />
      <Route
        path="gioi-thieu"
        element={<Navigate to="/ve-ha-noi-xanh" replace />}
      />
      <Route path="ban-do" element={<Navigate to="/chien-dich" replace />} />
      <Route
        path="bao-o-nhiem"
        element={<Navigate to="/chien-dich" replace />}
      />
      <Route path="dang-ky/*" element={<Navigate to="/tham-gia" replace />} />
      <Route path="ung-ho" element={<Navigate to="/tac-dong" replace />} />
      <Route path="lien-he" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    {authTab && <AuthModal initialTab={authTab} initialError={authError} onClose={closeAuth} onAdmin={() => navigate("/admin")} />}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>
  )
}

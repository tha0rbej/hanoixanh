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
import { tableInsert, tableInsertMinimal, tableSelect, updateProfile, uploadPublicFile } from "./lib/supabase"

type SourcePage = "home" | "about" | "remaining" | "profile"

const allowedPaths = new Set([
  "/",
  "/ve-ha-noi-xanh",
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
  campaign_id?: string | null
  campaign_key?: string | null
  created_at?: string
}
type CampaignSummaryRow = { id: string; title?: string; location?: string; start_at?: string }

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
  const { session, profile, loading: authLoading, refreshProfile, signOut, changePassword } = useAuth()
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
    let trashKg = 0
    let history: Array<{ title: string; location: string; date: string; status: string; hours: number }> = []
    try {
      const registrations = await tableSelect<ParticipationSummaryRow>("campaign_registrations", "*", session.access_token, `&user_id=eq.${encodeURIComponent(session.user.id)}`)
      const campaignRows = await tableSelect<CampaignSummaryRow>("campaigns", "id,title,location,start_at", session.access_token)
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
      trashKg = attended.reduce((sum, item) => sum + Number(item.trash_kg || 0), 0)
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
        badges: campaigns === 0 && hours === 0 ? 0 : Math.floor(campaigns / 3),
        history,
        trash: `${trashKg.toLocaleString("vi-VN")} kg`,
        level: volunteerLevel(campaigns, hours),
      },
    }, window.location.origin)
  }

  useEffect(() => {
    const receiveNavigation = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const message = event.data as { type?: string; path?: string; tab?: "login" | "register" | "reset"; campaignKey?: string; location?: string; description?: string; email?: string; latitude?: number; longitude?: number; fullName?: string; phone?: string; organization?: string; organizationType?: string; birthDate?: string; gender?: string; address?: string; occupation?: string; interests?: string; bio?: string; currentPassword?: string; newPassword?: string; image?: File; images?: File[] }
      if (message?.type === "hnx:navigate" && message.path && allowedPaths.has(message.path)) {
        if (message.path !== location.pathname) navigate(message.path)
        return
      }
      if (message?.type === "hnx:auth-open") { onAuth(message.tab || "login"); return }
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
          .then(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:contact-message-result", ok: true }, window.location.origin))
          .catch((error: Error) => frameRef.current?.contentWindow?.postMessage({ type: "hnx:contact-message-result", ok: false, message: error.message || "Không thể gửi lời nhắn." }, window.location.origin))
        return
      }
      if (message?.type === "hnx:campaign-register") {
        if (!session) { onAuth("login"); return }
        void tableSelect<{ id: string }>("campaign_registrations", "id", session.access_token, `&user_id=eq.${encodeURIComponent(session.user.id)}&campaign_key=eq.${encodeURIComponent(message.campaignKey || "")}&limit=1`)
          .then((existing) => { if (existing.length) throw new Error("Bạn đã đăng ký tham gia chiến dịch này rồi."); return tableInsert("campaign_registrations", { user_id: session.user.id, campaign_key: message.campaignKey, status: "registered" }, session.access_token) })
          .then(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaign-register-result", ok: true }, window.location.origin))
          .catch((error: Error) => frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaign-register-result", ok: false, message: error.message.includes("duplicate") ? "Bạn đã đăng ký tham gia chiến dịch này rồi." : error.message }, window.location.origin))
        return
      }
      if (message?.type === "hnx:pollution-report") {
        if (!session) { pendingReportRef.current = message; onAuth("login"); return }
        void (async () => {
          try {
            const images = Array.isArray(message.images) ? message.images : (message.image ? [message.image] : [])
            const firstImage = images.find((image): image is File => image instanceof File)
            const photoUrl = firstImage ? await uploadPublicFile(firstImage, session.access_token) : null
            await tableInsertMinimal("pollution_reports", { user_id: session.user.id, location_name: message.location, address: message.location, latitude: message.latitude || null, longitude: message.longitude || null, description: message.description, photo_url: photoUrl, status: "new", severity: "medium" }, session.access_token)
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
      if (message?.type === "hnx:signout") { void signOut(); return }
    }
    window.addEventListener("message", receiveNavigation)
    return () => window.removeEventListener("message", receiveNavigation)
  }, [changePassword, location.pathname, navigate, onAuth, profile, refreshProfile, session, signOut])

  useEffect(() => {
    const report = pendingReportRef.current
    if (!session || !report) return
    pendingReportRef.current = null
    void (async () => {
      try {
        const images = Array.isArray(report.images) ? report.images : (report.image ? [report.image] : [])
        const firstImage = images.find((image): image is File => image instanceof File)
        const photoUrl = firstImage ? await uploadPublicFile(firstImage, session.access_token) : null
        await tableInsertMinimal("pollution_reports", { user_id: session.user.id, location_name: report.location, address: report.location, latitude: report.latitude || null, longitude: report.longitude || null, description: report.description, photo_url: photoUrl, status: "new", severity: "medium" }, session.access_token)
        frameRef.current?.contentWindow?.postMessage({ type: "hnx:pollution-report-result", ok: true }, window.location.origin)
      } catch (error) { frameRef.current?.contentWindow?.postMessage({ type: "hnx:pollution-report-result", ok: false, message: error instanceof Error ? error.message : "Không gửi được báo cáo." }, window.location.origin) }
    })()
  }, [session])

  useEffect(() => {
    void sendAuthState()
  }, [profile, session])

  const handleFrameLoad = () => {
    if (page === "home") frameRef.current?.contentWindow?.postMessage({ type: "hnx:scroll-top" }, window.location.origin)
    void sendAuthState()
    const token = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (token) void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/campaigns?select=*&order=start_at.desc`, { headers: { apikey: token, Authorization: `Bearer ${token}` } }).then(r => r.json()).then(campaigns => frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaigns-data", campaigns }, window.location.origin))
    if (token) void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/homepage_metrics?select=metric_key,metric_value`, { headers: { apikey: token, Authorization: `Bearer ${token}` } }).then(r => r.json()).then(metrics => frameRef.current?.contentWindow?.postMessage({ type: "hnx:homepage-metrics", metrics }, window.location.origin))
    if (token) void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/posts?select=*&status=eq.published&order=published_at.desc.nullslast,created_at.desc`, { headers: { apikey: token, Authorization: `Bearer ${token}` } }).then(r => r.json()).then(posts => frameRef.current?.contentWindow?.postMessage({ type: "hnx:posts-data", posts: Array.isArray(posts) ? posts : [] }, window.location.origin))
    if (session) void tableSelect<{ campaign_key: string | null }>("campaign_registrations", "campaign_key", session.access_token, `&user_id=eq.${encodeURIComponent(session.user.id)}`).then(items => frameRef.current?.contentWindow?.postMessage({ type: "hnx:registered-campaigns", keys: items.map(x => x.campaign_key).filter(Boolean) }, window.location.origin))
  }

  useEffect(() => {
    if (page !== "home") return
    frameRef.current?.contentWindow?.postMessage({ type: "hnx:scroll-top" }, window.location.origin)
    const timer = window.setTimeout(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:scroll-top" }, window.location.origin), 100)
    return () => window.clearTimeout(timer)
  }, [page, source])

  useEffect(() => {
    if (!frameRef.current?.contentWindow || page === "home") return
    const token = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (!token) return
    void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/campaigns?select=*&order=start_at.desc`, { headers: { apikey: token, Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then((campaigns) => frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaigns-data", campaigns }, window.location.origin))
      .catch(() => undefined)
  }, [page, source])

  return (
    <iframe
      ref={frameRef}
      onLoad={handleFrameLoad}
      key={source}
      src={source}
      title={title}
      style={{ visibility: authLoading ? "hidden" : "visible" }}
      className="fixed inset-0 h-dvh w-full border-0 bg-white"
    />
  )
}

function AppRoutes() {
  const [authTab, setAuthTab] = useState<("login" | "register" | "reset") | null>(null)
  const navigate = useNavigate()
  const openAuth = (tab: "login" | "register" | "reset") => setAuthTab(tab)
  const closeAuth = () => setAuthTab(null)
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
    {authTab && <AuthModal initialTab={authTab} onClose={closeAuth} onAdmin={() => navigate("/admin")} />}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>
  )
}

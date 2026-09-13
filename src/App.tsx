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
import { AuthModal } from "./app/AuthModal"
import { AuthProvider, useAuth } from "./app/AuthContext"
import { tableInsert, updateProfile, uploadPublicFile } from "./lib/supabase"

type SourcePage = "home" | "about" | "remaining"

const allowedPaths = new Set([
  "/",
  "/ve-ha-noi-xanh",
  "/chien-dich",
  "/tac-dong",
  "/tin-tuc",
  "/tham-gia",
  "/admin",
])

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
  const { session, profile, loading: authLoading, refreshProfile, signOut } = useAuth()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const baseUrl = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  const source = `${baseUrl}source/${page}/index.html${view ? `#${view}` : ""}`

  useEffect(() => {
    const receiveNavigation = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const message = event.data as { type?: string; path?: string; tab?: "login" | "register" | "reset"; campaignKey?: string; location?: string; description?: string; latitude?: number; longitude?: number; fullName?: string; phone?: string; image?: File }
      if (message?.type === "hnx:navigate" && message.path && allowedPaths.has(message.path)) {
        if (message.path !== location.pathname) navigate(message.path)
        return
      }
      if (message?.type === "hnx:auth-open") { onAuth(message.tab || "login"); return }
      if (message?.type === "hnx:campaign-register") {
        if (!session) { onAuth("login"); return }
        void tableInsert("campaign_registrations", { user_id: session.user.id, campaign_key: message.campaignKey, status: "registered" }, session.access_token)
          .then(() => frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaign-register-result", ok: true }, window.location.origin))
          .catch((error: Error) => frameRef.current?.contentWindow?.postMessage({ type: "hnx:campaign-register-result", ok: false, message: error.message }, window.location.origin))
        return
      }
      if (message?.type === "hnx:pollution-report") {
        if (!session) { onAuth("login"); return }
        void (async () => {
          try {
            const imageUrl = message.image instanceof File ? await uploadPublicFile(message.image, session.access_token) : null
            await tableInsert("pollution_reports", { user_id: session.user.id, location_name: message.location, address: message.location, latitude: message.latitude || null, longitude: message.longitude || null, description: message.description, photo_url: imageUrl, status: "new", severity: "medium" }, session.access_token)
            frameRef.current?.contentWindow?.postMessage({ type: "hnx:pollution-report-result", ok: true }, window.location.origin)
          } catch (error) { frameRef.current?.contentWindow?.postMessage({ type: "hnx:pollution-report-result", ok: false, message: error instanceof Error ? error.message : "Không gửi được báo cáo." }, window.location.origin) }
        })()
      }
      if (message?.type === "hnx:profile-update" && session) {
        void (async () => {
          try {
            const avatarUrl = message.image instanceof File ? await uploadPublicFile(message.image, session.access_token) : undefined
            await updateProfile(session.user.id, { full_name: message.fullName, phone: message.phone, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) }, session.access_token)
            await refreshProfile()
            frameRef.current?.contentWindow?.postMessage({ type: "hnx:profile-update-result", ok: true }, window.location.origin)
          } catch (error) { frameRef.current?.contentWindow?.postMessage({ type: "hnx:profile-update-result", ok: false, message: error instanceof Error ? error.message : "Không cập nhật được hồ sơ." }, window.location.origin) }
        })()
      }
      if (message?.type === "hnx:signout") { void signOut(); return }
    }
    window.addEventListener("message", receiveNavigation)
    return () => window.removeEventListener("message", receiveNavigation)
  }, [location.pathname, navigate, onAuth, refreshProfile, session, signOut])

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "hnx:auth-state", user: profile ? { id: profile.id, name: profile.full_name, email: profile.email, phone: profile.phone, role: profile.role, camps: 0, hours: 0, trash: 0 } : null }, window.location.origin)
  }, [profile])

  const handleFrameLoad = () => frameRef.current?.contentWindow?.postMessage({ type: "hnx:auth-state", user: profile ? { id: profile.id, name: profile.full_name, email: profile.email, phone: profile.phone, role: profile.role, camps: 0, hours: 0, trash: 0 } : null }, window.location.origin)

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
      <Route path="admin" element={<AdminDashboard onLogin={() => setAuthTab("login")} />} />
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

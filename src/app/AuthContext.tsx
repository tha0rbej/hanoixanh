import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  getProfile,
  getStoredSession,
  requestPasswordReset,
  updatePassword as apiUpdatePassword,
  refreshSession,
  recordProfileLogin,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  supabaseConfigured,
  type HnxProfile,
  type HnxSession,
  type SignUpInput,
} from "../lib/supabase"

type AuthContextValue = {
  session: HnxSession | null
  profile: HnxProfile | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: SignUpInput) => Promise<boolean>
  resetPassword: (email: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<HnxSession | null>(getStoredSession())
  const [profile, setProfile] = useState<HnxProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = useCallback(async () => {
    if (!session) {
      setProfile(null)
      return
    }
    try {
      setProfile(await getProfile(session.user.id, session.access_token))
    } catch {
      setProfile(null)
    }
  }, [session])

  useEffect(() => {
    let active = true
    if (!session || !supabaseConfigured) {
      setLoading(false)
      return () => { active = false }
    }
    const ensureSession = session.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 60 ? refreshSession(session) : Promise.resolve(session)
    ensureSession
      .then((nextSession) => { if (active && nextSession.access_token !== session.access_token) setSession(nextSession); return getProfile(nextSession.user.id, nextSession.access_token) })
      .then(async (next) => { if (active) { setProfile(next); try { const lastLoginAt = await recordProfileLogin(next.id, (await getStoredSession())?.access_token || session.access_token); setProfile(current => current ? { ...current, last_login_at: lastLoginAt } : current) } catch { /* Older databases may not have the new tracking column yet. */ } } })
      .catch(() => { if (active) { setProfile(null); setSession(null) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session])

  useEffect(() => {
    if (!session || !supabaseConfigured) return
    let active = true
    const refreshIfNeeded = async () => {
      const expiresSoon = !session.expires_at || session.expires_at < Math.floor(Date.now() / 1000) + 5 * 60
      if (!expiresSoon) return
      try {
        const nextSession = await refreshSession(session)
        if (active && nextSession.access_token !== session.access_token) setSession(nextSession)
      } catch {
        if (active) { setSession(null); setProfile(null) }
      }
    }
    void refreshIfNeeded()
    const timer = window.setInterval(() => void refreshIfNeeded(), 60_000)
    window.addEventListener("focus", refreshIfNeeded)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refreshIfNeeded) }
  }, [session])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    loading,
    configured: supabaseConfigured,
    async signIn(email, password) {
      const result = await apiSignIn(email, password)
      setSession(result.session)
      setProfile(result.profile)
    },
    async signUp(input) {
      const result = await apiSignUp(input)
      if (result.session) {
        setSession(result.session)
        setProfile(result.profile || null)
        return true
      }
      return false
    },
    resetPassword: requestPasswordReset,
    async changePassword(currentPassword, newPassword) {
      if (!session) throw new Error("Bạn cần đăng nhập để đổi mật khẩu.")
      await apiUpdatePassword(currentPassword, newPassword, session.access_token)
    },
    async signOut() {
      try { if (session) await apiSignOut(session.access_token) } finally { setSession(null); setProfile(null) }
    },
    refreshProfile,
  }), [loading, profile, refreshProfile, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth phải được dùng bên trong AuthProvider")
  return value
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  getProfile,
  getStoredSession,
  requestPasswordReset,
  refreshSession,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  supabaseConfigured,
  type HnxProfile,
  type HnxSession,
} from "../lib/supabase"

type AuthContextValue = {
  session: HnxSession | null
  profile: HnxProfile | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: { email: string; password: string; fullName: string; phone?: string }) => Promise<boolean>
  resetPassword: (email: string) => Promise<void>
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
      .then((next) => { if (active) setProfile(next) })
      .catch(() => { if (active) { setProfile(null); setSession(null) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
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
    async signOut() {
      if (session) await apiSignOut(session.access_token)
      setSession(null)
      setProfile(null)
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

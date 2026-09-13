/**
 * Small Supabase REST client. Keeping this dependency-free makes the app work
 * in the existing HTML/iframe shell while still using Supabase Auth, RLS and
 * PostgREST in production.
 */
export type UserRole = "user" | "admin"

export type HnxProfile = {
  id: string
  email: string
  full_name: string
  phone?: string | null
  avatar_url?: string | null
  role: UserRole
  created_at?: string
}

export type HnxSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  user: { id: string; email?: string }
}

type SupabaseError = { message?: string; error_description?: string }

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "")
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const sessionKey = "hnx:supabase-session"

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

function requireConfig() {
  if (!supabaseConfigured) {
    throw new Error("Chưa cấu hình VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY.")
  }
}

function authHeaders(token?: string): HeadersInit {
  requireConfig()
  return {
    apikey: supabaseAnonKey!,
    Authorization: `Bearer ${token || supabaseAnonKey!}`,
    "Content-Type": "application/json",
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & SupabaseError
  if (!response.ok) {
    throw new Error(body.error_description || body.message || `Supabase request failed (${response.status}).`)
  }
  return body as T
}

export function getStoredSession(): HnxSession | null {
  try {
    const raw = window.localStorage.getItem(sessionKey)
    return raw ? (JSON.parse(raw) as HnxSession) : null
  } catch {
    return null
  }
}

function storeSession(session: HnxSession | null) {
  if (session) window.localStorage.setItem(sessionKey, JSON.stringify(session))
  else window.localStorage.removeItem(sessionKey)
}

function normalizeSession(session: HnxSession): HnxSession {
  return session.expires_at ? session : { ...session, expires_at: Math.floor(Date.now() / 1000) + (session.expires_in || 3600) }
}

export async function signIn(email: string, password: string): Promise<{ session: HnxSession; profile: HnxProfile }> {
  requireConfig()
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  })
  const session = normalizeSession(await parseResponse<HnxSession>(response))
  storeSession(session)
  const profile = await getProfile(session.user.id, session.access_token)
  return { session, profile }
}

export async function signUp(input: { email: string; password: string; fullName: string; phone?: string }): Promise<{ session: HnxSession | null; profile?: HnxProfile }> {
  requireConfig()
  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email: input.email, password: input.password, data: { full_name: input.fullName, phone: input.phone || null } }),
  })
  const result = normalizeSession(await parseResponse<HnxSession>(response))
  if (!result.access_token) return { session: null }
  storeSession(result)
  return { session: result, profile: await getProfile(result.user.id, result.access_token) }
}

export async function refreshSession(session: HnxSession): Promise<HnxSession> {
  requireConfig()
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ refresh_token: session.refresh_token }),
  })
  const next = normalizeSession(await parseResponse<HnxSession>(response))
  storeSession(next)
  return next
}

export async function signOut(token: string) {
  if (supabaseConfigured) {
    await fetch(`${supabaseUrl}/auth/v1/logout`, { method: "POST", headers: authHeaders(token) })
  }
  storeSession(null)
}

export async function requestPasswordReset(email: string) {
  requireConfig()
  const response = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email }),
  })
  await parseResponse<unknown>(response)
}

export async function getProfile(id: string, token?: string): Promise<HnxProfile> {
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=*`, { headers: authHeaders(token) })
  const rows = await parseResponse<HnxProfile[]>(response)
  if (!rows[0]) throw new Error("Tài khoản chưa có hồ sơ profiles.")
  return rows[0]
}

export async function updateProfile(id: string, values: Partial<Pick<HnxProfile, "full_name" | "phone" | "avatar_url">>, token: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), Prefer: "return=representation" },
    body: JSON.stringify(values),
  })
  const rows = await parseResponse<HnxProfile[]>(response)
  return rows[0]
}

export async function tableSelect<T>(table: string, select = "*", token: string, query = "") {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}${query}`, { headers: authHeaders(token) })
  return parseResponse<T[]>(response)
}

export async function tableInsert<T>(table: string, values: unknown, token: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...authHeaders(token), Prefer: "return=representation" },
    body: JSON.stringify(values),
  })
  return parseResponse<T[]>(response)
}

export async function tableUpdate<T>(table: string, query: string, values: unknown, token: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), Prefer: "return=representation" },
    body: JSON.stringify(values),
  })
  return parseResponse<T[]>(response)
}

export async function tableDelete(table: string, query: string, token: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, { method: "DELETE", headers: authHeaders(token) })
  await parseResponse<unknown>(response)
}

export async function uploadPublicFile(file: File, token: string) {
  requireConfig()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-")
  const path = `${crypto.randomUUID()}-${safeName}`
  const response = await fetch(`${supabaseUrl}/storage/v1/object/hnx-media/${path}`, {
    method: "POST",
    headers: { apikey: supabaseAnonKey!, Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream" },
    body: file,
  })
  await parseResponse<unknown>(response)
  return `${supabaseUrl}/storage/v1/object/public/hnx-media/${path}`
}

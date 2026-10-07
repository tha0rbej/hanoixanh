import { createClient, type Session as SupabaseSession } from "@supabase/supabase-js"

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
  volunteer_code?: string | null
  birth_date?: string | null
  gender?: string | null
  address?: string | null
  occupation?: string | null
  interests?: string | null
  bio?: string | null
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
const oauthClient = supabaseConfigured ? createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    flowType: "pkce",
    detectSessionInUrl: false,
    persistSession: true,
    storageKey: "hnx:supabase-oauth",
  },
}) : null

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

export async function signInWithGoogle() {
  requireConfig()
  const { error } = await oauthClient!.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/` },
  })
  if (error) throw error
}

function fromSupabaseSession(source: SupabaseSession): HnxSession {
  return normalizeSession({
    access_token: source.access_token,
    refresh_token: source.refresh_token,
    expires_at: source.expires_at,
    expires_in: source.expires_in,
    user: { id: source.user.id, email: source.user.email },
  })
}

export async function consumeOAuthSession(): Promise<HnxSession | null> {
  requireConfig()
  const query = new URLSearchParams(window.location.search)
  const code = query.get("code")
  if (code) {
    const { data, error } = await oauthClient!.auth.exchangeCodeForSession(code)
    if (error) throw error
    if (!data.session) return null
    const session = fromSupabaseSession(data.session)
    storeSession(session)
    return session
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  const accessToken = hash.get("access_token")
  const refreshToken = hash.get("refresh_token")
  if (!accessToken || !refreshToken) {
    const { data } = await oauthClient!.auth.getSession()
    if (!data.session) return null
    const session = fromSupabaseSession(data.session)
    storeSession(session)
    return session
  }
  let user = { id: "", email: undefined as string | undefined }
  try {
    const encoded = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const payload = JSON.parse(window.atob(encoded.padEnd(encoded.length + (4 - encoded.length % 4) % 4, "="))) as { sub?: string; email?: string }
    user = { id: payload.sub || "", email: payload.email }
  } catch { /* the Auth API will still validate the token on the next request */ }
  if (!user.id) return null
  const session = normalizeSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: Number(hash.get("expires_in") || 3600), user })
  storeSession(session)
  return session
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
    body: JSON.stringify({ email, redirect_to: `${window.location.origin}/dat-lai-mat-khau` }),
  })
  await parseResponse<unknown>(response)
}

export async function updateRecoveredPassword(password: string, token: string) {
  requireConfig()
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ password }),
  })
  await parseResponse<unknown>(response)
}

export async function updatePassword(currentPassword: string, newPassword: string, token: string) {
  requireConfig()
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ password: newPassword, current_password: currentPassword }),
  })
  await parseResponse<unknown>(response)
}

export async function getProfile(id: string, token?: string): Promise<HnxProfile> {
  if (!token) {
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=*`, { headers: authHeaders() })
    const rows = await parseResponse<HnxProfile[]>(response)
    if (!rows[0]) throw new Error("Tài khoản chưa có hồ sơ profiles.")
    return rows[0]
  }

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: authHeaders(token) })
  const authUser = await parseResponse<{
    id?: string
    email?: string
    created_at?: string
    user_metadata?: Record<string, unknown>
  }>(authResponse)
  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id || id)}&select=*`, { headers: authHeaders(token) })
  const rows = profileResponse.ok ? await parseResponse<HnxProfile[]>(profileResponse) : []
  const metadata = authUser.user_metadata || {}
  const metadataText = (key: string) => typeof metadata[key] === "string" ? metadata[key] as string : undefined
  const stored = rows[0]

  if (!stored) {
    return {
      id: authUser.id || id,
      email: authUser.email || "",
      full_name: metadataText("full_name") || metadataText("name") || authUser.email?.split("@")[0] || "Thành viên Hà Nội Xanh",
      phone: metadataText("phone") || null,
      avatar_url: metadataText("avatar_url") || metadataText("picture") || null,
      volunteer_code: null,
      birth_date: metadataText("birth_date") || null,
      gender: metadataText("gender") || null,
      address: metadataText("address") || null,
      occupation: metadataText("occupation") || null,
      interests: metadataText("interests") || null,
      bio: metadataText("bio") || null,
      role: "user",
      created_at: authUser.created_at,
    }
  }

  return {
    ...stored,
    email: stored.email || authUser.email || "",
    full_name: stored.full_name || metadataText("full_name") || metadataText("name") || authUser.email?.split("@")[0] || "Thành viên Hà Nội Xanh",
    avatar_url: stored.avatar_url ?? metadataText("avatar_url") ?? metadataText("picture") ?? null,
    birth_date: stored.birth_date ?? metadataText("birth_date") ?? null,
    gender: stored.gender ?? metadataText("gender") ?? null,
    address: stored.address ?? metadataText("address") ?? null,
    occupation: stored.occupation ?? metadataText("occupation") ?? null,
    interests: stored.interests ?? metadataText("interests") ?? null,
    bio: stored.bio ?? metadataText("bio") ?? null,
  }
}

export async function updateProfile(id: string, values: Partial<Pick<HnxProfile, "full_name" | "phone" | "avatar_url" | "birth_date" | "gender" | "address" | "occupation" | "interests" | "bio">>, token: string) {
  const patchProfiles = async (payload: Partial<HnxProfile>) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...authHeaders(token), Prefer: "return=representation" },
      body: JSON.stringify(payload),
    })
    const rows = await parseResponse<HnxProfile[]>(response)
    return rows[0]
  }
  try {
    return await patchProfiles(values)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (!/schema cache|column/i.test(message)) throw error
    const { birth_date, gender, address, occupation, interests, bio, ...coreValues } = values
    const profile = await patchProfiles(coreValues)
    const metadataResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ data: { birth_date, gender, address, occupation, interests, bio } }),
    })
    await parseResponse<unknown>(metadataResponse)
    return { ...profile, birth_date, gender, address, occupation, interests, bio }
  }
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

/**
 * Insert without asking PostgREST to return the inserted row. This is needed
 * for public write-only tables: RLS may allow INSERT while correctly denying
 * SELECT to the visitor.
 */
export async function tableInsertMinimal(table: string, values: unknown, token = "") {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...authHeaders(token), Prefer: "return=minimal" },
    body: JSON.stringify(values),
  })
  await parseResponse<unknown>(response)
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

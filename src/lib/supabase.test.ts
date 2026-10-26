import { beforeEach, describe, expect, it, vi } from "vitest"

const authMocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getSession: vi.fn(),
  signInWithOAuth: vi.fn(),
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: authMocks }),
}))

import {
  consumeOAuthSession,
  formatOAuthError,
  isOAuthCallback,
  signInWithGoogle,
  takeOAuthReturnTo,
} from "./supabase"

describe("Google OAuth flow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, "", "/")
    window.localStorage.clear()
    window.sessionStorage.clear()
    authMocks.signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.google.com" }, error: null })
  })

  it("exchanges a StrictMode callback code only once", async () => {
    window.history.replaceState({}, "", "/?code=one-time-code")
    authMocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        session: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: 2_000_000_000,
          expires_in: 3600,
          user: { id: "user-id", email: "member@example.com" },
        },
      },
      error: null,
    })

    const [first, second] = await Promise.all([consumeOAuthSession(), consumeOAuthSession()])

    expect(authMocks.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(first?.access_token).toBe("access-token")
    expect(second).toEqual(first)
  })

  it("remembers and restores the page that started Google sign-in", async () => {
    window.history.replaceState({}, "", "/chien-dich?campaign=42#details")

    await signInWithGoogle()

    expect(takeOAuthReturnTo()).toBe("/chien-dich?campaign=42#details")
    expect(takeOAuthReturnTo()).toBe("/chien-dich?campaign=42#details")
    expect(authMocks.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      provider: "google",
      options: expect.objectContaining({ queryParams: { prompt: "select_account" } }),
    }))
  })

  it("recognizes provider errors and translates common OAuth failures", () => {
    window.history.replaceState({}, "", "/?error=access_denied&error_description=The+user+cancelled")

    expect(isOAuthCallback()).toBe(true)
    expect(formatOAuthError(new Error("access_denied"))).toBe("Bạn đã hủy đăng nhập bằng Google.")
  })
})

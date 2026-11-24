import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  uploadPublicFile,
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

describe("uploadPublicFile", () => {
  const userId = "11111111-2222-3333-4444-555555555555"
  const tokenFor = (payload: Record<string, unknown>) => {
    const encoded = window.btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    return `header.${encoded}.signature`
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uploads into a folder named after the user id in the token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }))

    const url = await uploadPublicFile(new File(["pixels"], "anh dep.png", { type: "image/png" }), tokenFor({ sub: userId }))

    const requested = String(fetchMock.mock.calls[0][0])
    expect(requested).toMatch(new RegExp(`/storage/v1/object/hnx-media/${userId}/[0-9a-f-]{36}-anh-dep\\.png$`))
    expect(url).toBe(requested.replace("/object/", "/object/public/"))
  })

  it("accepts phone photos up to 10 MB", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }))

    await uploadPublicFile(new File([new Uint8Array(10 * 1024 * 1024)], "photo.jpg", { type: "image/jpeg" }), tokenFor({ sub: userId }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects unsupported files and unusable tokens before sending anything", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const token = tokenFor({ sub: userId })

    await expect(uploadPublicFile(new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" }), token))
      .rejects.toThrow("Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc GIF.")
    await expect(uploadPublicFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }), token))
      .rejects.toThrow("Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 10 MB.")
    await expect(uploadPublicFile(new File(["pixels"], "a.png", { type: "image/png" }), "not-a-jwt"))
      .rejects.toThrow("Phiên đăng nhập không hợp lệ.")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

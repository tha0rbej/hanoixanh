import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import App from "./App"

describe("source HTML routes", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"))

  it("uses the supplied home HTML as the homepage", () => {
    render(<App />)
    expect(screen.getByTitle("Trang chủ Hà Nội Xanh")).toHaveAttribute(
      "src",
      "/source/home/index.html",
    )
  })

  it.each([
    [
      "/ve-ha-noi-xanh",
      "/source/about/index.html#ve-chung-toi",
      "Về Hà Nội Xanh",
    ],
    ["/tham-gia", "/source/about/index.html#tham-gia", "Tham gia Hà Nội Xanh"],
    [
      "/chien-dich",
      "/source/remaining/index.html#chien-dich",
      "Chiến dịch Hà Nội Xanh",
    ],
    [
      "/tac-dong",
      "/source/remaining/index.html#tac-dong",
      "Tác động cộng đồng",
    ],
    [
      "/tin-tuc",
      "/source/remaining/index.html#tin-tuc",
      "Tin tức và câu chuyện",
    ],
  ])("maps %s to the correct supplied HTML view", (path, source, title) => {
    window.history.replaceState({}, "", path)
    render(<App />)
    expect(screen.getByTitle(title)).toHaveAttribute("src", source)
  })

  it("accepts navigation messages from the supplied HTML", async () => {
    window.history.replaceState({}, "", "/chien-dich")
    render(<App />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "hnx:navigate", path: "/ve-ha-noi-xanh" },
        }),
      )
    })
    await waitFor(() =>
      expect(window.location.pathname).toBe("/ve-ha-noi-xanh"),
    )
    expect(screen.getByTitle("Về Hà Nội Xanh")).toBeInTheDocument()
  })

  it("keeps the old introduction URL working", async () => {
    window.history.replaceState({}, "", "/gioi-thieu")
    render(<App />)
    await waitFor(() =>
      expect(window.location.pathname).toBe("/ve-ha-noi-xanh"),
    )
  })
})

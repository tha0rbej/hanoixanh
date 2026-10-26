import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ResetPasswordPage } from "./ResetPasswordPage"

vi.mock("../lib/supabase", () => ({
  updateRecoveredPassword: vi.fn(),
}))

describe("ResetPasswordPage password visibility", () => {
  it("shows the new password, hides its confirmation, and toggles both fields", async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    const password = screen.getByLabelText("Mật khẩu mới")
    const confirm = screen.getByLabelText("Nhập lại mật khẩu")

    expect(password).toHaveAttribute("type", "text")
    expect(confirm).toHaveAttribute("type", "password")

    await user.click(screen.getByRole("button", { name: "Ẩn mật khẩu mới" }))
    expect(password).toHaveAttribute("type", "password")

    await user.click(screen.getByRole("button", { name: "Hiện mật khẩu nhập lại" }))
    expect(confirm).toHaveAttribute("type", "text")
  })
})

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthModal } from "./AuthModal"

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  resetPassword: vi.fn(),
  tableInsertMinimal: vi.fn(),
}))

vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    configured: true,
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    resetPassword: mocks.resetPassword,
  }),
}))

vi.mock("../lib/supabase", () => ({
  signInWithGoogle: vi.fn(),
  tableInsertMinimal: mocks.tableInsertMinimal,
}))

describe("AuthModal registration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.signUp.mockResolvedValue(false)
    mocks.tableInsertMinimal.mockResolvedValue(undefined)
  })

  it("shows email confirmation only after an individual account is created", async () => {
    const user = userEvent.setup()
    render(<AuthModal initialTab="register" onClose={() => {}} onAdmin={() => {}} />)

    await user.type(screen.getByLabelText(/Họ và tên/), "Nguyễn Minh An")
    await user.type(screen.getByLabelText("Số điện thoại"), "0912345678")
    await user.type(screen.getByLabelText(/Email/), "an@example.com")
    await user.type(screen.getByLabelText(/Địa chỉ/), "Cầu Giấy, Hà Nội")
    await user.type(screen.getByLabelText(/^Mật khẩu/), "matkhau123")
    await user.type(screen.getByLabelText(/^Nhập lại mật khẩu/), "matkhau123")
    await user.click(screen.getByRole("button", { name: "Tạo tài khoản cá nhân" }))

    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "an@example.com",
      fullName: "Nguyễn Minh An",
      address: "Cầu Giấy, Hà Nội",
      preferredRole: "cleanup",
      accountType: "individual",
    }))
    expect(await screen.findByRole("heading", { name: "Kiểm tra email của bạn" })).toBeInTheDocument()
    expect(mocks.tableInsertMinimal).not.toHaveBeenCalled()
  })

  it("shows the organization success popup without creating an account", async () => {
    const user = userEvent.setup()
    render(<AuthModal initialTab="register" onClose={() => {}} onAdmin={() => {}} />)

    await user.click(screen.getByLabelText(/Tổ chức/))
    await user.type(screen.getByLabelText(/Tên tổ chức/), "Nhóm Xanh Hà Nội")
    await user.type(screen.getByLabelText("Số điện thoại"), "0987231832")
    await user.type(screen.getByLabelText(/Email/), "tochuc@example.com")
    await user.type(screen.getByLabelText(/Địa chỉ/), "Tây Hồ, Hà Nội")
    await user.type(screen.getByLabelText("Số lượng người tham gia"), "20")
    await user.click(screen.getByRole("button", { name: "Xác nhận đăng ký tổ chức" }))

    expect(mocks.tableInsertMinimal).toHaveBeenCalledWith("contact_messages", expect.objectContaining({
      name: "Nhóm Xanh Hà Nội",
      email: "tochuc@example.com",
      message: expect.stringContaining("Số người tham gia: 20"),
    }))
    expect(await screen.findByRole("heading", { name: "Đăng ký thành công!" })).toBeInTheDocument()
    expect(screen.queryByText("Kiểm tra email của bạn")).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Mật khẩu/)).not.toBeInTheDocument()
    expect(mocks.signUp).not.toHaveBeenCalled()
  })
})

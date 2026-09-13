import * as React from "react"
import { useState, type FormEvent } from "react"
import { useAuth } from "./AuthContext"

type AuthTab = "login" | "register" | "reset"

export function AuthModal({ initialTab, onClose, onAdmin }: { initialTab: AuthTab; onClose: () => void; onAdmin: () => void }) {
  const { configured, signIn, signUp, resetPassword } = useAuth()
  const [tab, setTab] = useState<AuthTab>(initialTab)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [values, setValues] = useState({ fullName: "", phone: "", email: "", password: "", confirm: "" })
  const update = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }))

  if (!configured) {
    return <div className="auth-backdrop"><div className="auth-card"><button className="auth-close" onClick={onClose}>×</button><h2>Đăng nhập Hà Nội Xanh</h2><p className="auth-muted">Supabase chưa được cấu hình. Hãy tạo file <code>.env.local</code> từ <code>env.example</code> rồi điền URL và anon key của project.</p><button className="auth-primary" onClick={onClose}>Đóng</button></div></div>
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true)
    try {
      if (tab === "login") {
        await signIn(values.email, values.password)
        onClose()
        if (window.location.pathname === "/admin") onAdmin()
      } else if (tab === "register") {
        if (values.password !== values.confirm) throw new Error("Mật khẩu nhập lại không khớp.")
        const hasSession = await signUp({ email: values.email, password: values.password, fullName: values.fullName, phone: values.phone })
        setNotice(hasSession ? "Tạo tài khoản thành công." : "Kiểm tra email để xác nhận tài khoản trước khi đăng nhập.")
        if (hasSession) onClose()
      } else {
        await resetPassword(values.email)
        setNotice("Đã gửi email đặt lại mật khẩu. Hãy kiểm tra hộp thư của bạn.")
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể thực hiện thao tác.") }
    finally { setBusy(false) }
  }

  return <div className="auth-backdrop" role="presentation"><div className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="auth-close" onClick={onClose} aria-label="Đóng">×</button><p className="auth-kicker">HÀ NỘI XANH</p><h2 id="auth-title">{tab === "login" ? "Chào mừng trở lại" : tab === "register" ? "Tạo tài khoản" : "Đặt lại mật khẩu"}</h2><p className="auth-muted">{tab === "login" ? "Đăng nhập để tham gia chiến dịch và theo dõi đóng góp." : tab === "register" ? "Tham gia cộng đồng tình nguyện vì Thủ đô xanh." : "Nhập email để nhận liên kết đặt lại mật khẩu."}</p>{error && <div className="auth-error">{error}</div>}{notice && <div className="auth-success">{notice}</div>}<form onSubmit={submit}>{tab === "register" && <><label>Họ và tên<input value={values.fullName} onChange={update("fullName")} required /></label><label>Số điện thoại<input value={values.phone} onChange={update("phone")} /></label></>}<label>Email<input type="email" value={values.email} onChange={update("email")} required /></label>{tab !== "reset" && <label>Mật khẩu<input type="password" value={values.password} onChange={update("password")} minLength={8} required /></label>}{tab === "register" && <label>Nhập lại mật khẩu<input type="password" value={values.confirm} onChange={update("confirm")} minLength={8} required /></label>}<button className="auth-primary" disabled={busy}>{busy ? "Đang xử lý…" : tab === "login" ? "ĐĂNG NHẬP" : tab === "register" ? "TẠO TÀI KHOẢN" : "GỬI LINK ĐẶT LẠI"}</button></form><div className="auth-switch">{tab === "login" ? <><button onClick={() => setTab("register")}>Tạo tài khoản</button><button onClick={() => setTab("reset")}>Quên mật khẩu?</button></> : <button onClick={() => setTab("login")}>← Quay lại đăng nhập</button>}</div></div></div>
}

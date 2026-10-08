import * as React from "react"
import { useState, type FormEvent } from "react"
import { useAuth } from "./AuthContext"
import { signInWithGoogle, tableInsertMinimal } from "../lib/supabase"

type AuthTab = "login" | "register" | "reset"
type RegistrationType = "individual" | "organization"
type PreferredRole = "cleanup" | "media" | "leader" | "logistics"
type CompletionType = RegistrationType | null

const roleOptions: Array<{ value: PreferredRole; label: string; icon: string }> = [
  { value: "cleanup", label: "Clean-up", icon: "fa-solid fa-broom" },
  { value: "media", label: "Media", icon: "fa-solid fa-camera" },
  { value: "leader", label: "Leader", icon: "fa-solid fa-user-tie" },
  { value: "logistics", label: "Logistics", icon: "fa-solid fa-box-open" },
]

const roleNames: Record<PreferredRole, string> = {
  cleanup: "Clean-up",
  media: "Media",
  leader: "Leader",
  logistics: "Logistics",
}

const emptyValues = {
  fullName: "",
  phone: "",
  email: "",
  address: "",
  participants: "",
  password: "",
  confirm: "",
}

export function AuthModal({ initialTab, onClose, onAdmin }: { initialTab: AuthTab; onClose: () => void; onAdmin: () => void }) {
  const { configured, signIn, signUp, resetPassword } = useAuth()
  const [tab, setTab] = useState<AuthTab>(initialTab)
  const [registrationType, setRegistrationType] = useState<RegistrationType>("individual")
  const [preferredRole, setPreferredRole] = useState<PreferredRole>("cleanup")
  const [completion, setCompletion] = useState<CompletionType>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [values, setValues] = useState(emptyValues)

  const update = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues(current => ({ ...current, [key]: event.target.value }))
  }

  const changeTab = (nextTab: AuthTab) => {
    setTab(nextTab)
    setError("")
    setNotice("")
    setCompletion(null)
  }

  if (!configured) {
    return <div className="auth-backdrop"><div className="auth-card"><button className="auth-close" onClick={onClose}>×</button><h2>Đăng nhập Hà Nội Xanh</h2><p className="auth-muted">Supabase chưa được cấu hình.</p><button className="auth-primary" onClick={onClose}>Đóng</button></div></div>
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setNotice("")
    setBusy(true)

    try {
      if (tab === "login") {
        await signIn(values.email, values.password)
        onClose()
        if (window.location.pathname === "/admin") onAdmin()
        return
      }

      if (tab === "reset") {
        await resetPassword(values.email)
        setNotice("Đã gửi email đặt lại mật khẩu. Hãy kiểm tra hộp thư.")
        return
      }

      if (registrationType === "organization") {
        await tableInsertMinimal("contact_messages", {
          name: values.fullName.trim(),
          email: values.email.trim(),
          message: [
            "ĐĂNG KÝ TỔ CHỨC",
            `Tên tổ chức: ${values.fullName.trim()}`,
            `Số điện thoại: ${values.phone.trim() || "Chưa cung cấp"}`,
            `Địa chỉ: ${values.address.trim()}`,
            `Số người tham gia: ${values.participants}`,
            `Vai trò mong muốn: ${roleNames[preferredRole]}`,
          ].join("\n"),
        })
        setCompletion("organization")
        return
      }

      if (values.password !== values.confirm) throw new Error("Mật khẩu nhập lại không khớp.")
      await signUp({
        email: values.email.trim(),
        password: values.password,
        fullName: values.fullName.trim(),
        phone: values.phone.trim(),
        address: values.address.trim(),
        preferredRole,
        accountType: "individual",
      })
      setCompletion("individual")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể thực hiện thao tác.")
    } finally {
      setBusy(false)
    }
  }

  if (completion) {
    const isOrganization = completion === "organization"
    return (
      <div className="auth-backdrop" role="presentation">
        <div className={`auth-card auth-complete-card ${isOrganization ? "auth-org-complete" : "auth-email-complete"}`} role="dialog" aria-modal="true" aria-labelledby="auth-complete-title">
          <button className="auth-close" onClick={onClose} aria-label="Đóng">×</button>
          {isOrganization && <><span className="auth-firework auth-firework-one" /><span className="auth-firework auth-firework-two" /><span className="auth-firework auth-firework-three" /></>}
          <div className="auth-complete-content">
            <div className="auth-complete-icon" aria-hidden="true">{isOrganization ? "✓" : "@"}</div>
            <p className="auth-kicker">HÀ NỘI XANH</p>
            <h2 id="auth-complete-title">{isOrganization ? "Đăng ký thành công!" : "Kiểm tra email của bạn"}</h2>
            <p className="auth-muted">
              {isOrganization
                ? "Chúng tôi đã nhận được thông tin đăng ký. Đội ngũ Hà Nội Xanh sẽ sớm liên hệ để trao đổi chi tiết."
                : <>Một email xác nhận tài khoản đã được gửi tới <strong>{values.email}</strong>. Vui lòng mở email và nhấn liên kết xác nhận trước khi đăng nhập.</>}
            </p>
            {isOrganization && (
              <div className="auth-contact-box">
                <strong>Nếu muốn liên hệ sớm:</strong>
                <span>Email: hanoixanhh@gmail.com</span>
                <span>Hotline: +84 98 723 18 32</span>
              </div>
            )}
            <button className="auth-primary auth-complete-button" type="button" onClick={onClose}>{isOrganization ? "Đóng" : "Đã hiểu"}</button>
          </div>
        </div>
      </div>
    )
  }

  const title = tab === "login" ? "Chào mừng trở lại" : tab === "register" ? "Tạo tài khoản" : "Đặt lại mật khẩu"
  const description = tab === "login"
    ? "Đăng nhập để tham gia chiến dịch và theo dõi đóng góp."
    : tab === "register"
      ? "Đăng ký với tư cách cá nhân hoặc gửi thông tin tham gia dành cho tổ chức."
      : "Nhập email để nhận liên kết đặt lại mật khẩu."

  return (
    <div className="auth-backdrop" role="presentation">
      <div className={`auth-card ${tab === "register" ? "auth-card-register" : ""}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="auth-close" onClick={onClose} aria-label="Đóng">×</button>
        <p className="auth-kicker">HÀ NỘI XANH</p>
        <h2 id="auth-title">{title}</h2>
        <p className="auth-muted">{description}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {notice && <div className="auth-success">{notice}</div>}

        {tab === "login" && <button type="button" className="auth-google" onClick={signInWithGoogle}>Tiếp tục với Google</button>}
        {tab === "login" && <div className="auth-divider"><span>hoặc</span></div>}

        <form className={tab === "register" ? "auth-register-form" : ""} onSubmit={submit}>
          {tab === "register" ? (
            <>
              <div className="auth-register-grid">
                <section className="auth-form-section" aria-labelledby="register-type-heading">
                  <h3 id="register-type-heading"><i className="fa-solid fa-users-viewfinder" aria-hidden="true" />Tham gia với tư cách</h3>
                  <div className="auth-choice-grid">
                    <label className={`auth-choice ${registrationType === "individual" ? "active" : ""}`}>
                      <input type="radio" name="registrationType" value="individual" checked={registrationType === "individual"} onChange={() => setRegistrationType("individual")} />
                      <span className="auth-choice-title"><i className="fa-solid fa-user" aria-hidden="true" />Cá nhân</span><span className="auth-radio-indicator" aria-hidden="true" />
                    </label>
                    <label className={`auth-choice ${registrationType === "organization" ? "active" : ""}`}>
                      <input type="radio" name="registrationType" value="organization" checked={registrationType === "organization"} onChange={() => setRegistrationType("organization")} />
                      <span className="auth-choice-title"><i className="fa-solid fa-building" aria-hidden="true" />Tổ chức</span><span className="auth-radio-indicator" aria-hidden="true" />
                    </label>
                  </div>

                  <h3><i className="fa-solid fa-briefcase" aria-hidden="true" />Vai trò mong muốn</h3>
                  <div className="auth-choice-grid auth-role-grid">
                    {roleOptions.map(option => (
                      <label key={option.value} className={`auth-choice auth-role-choice ${preferredRole === option.value ? "active" : ""}`}>
                        <input type="radio" name="preferredRole" value={option.value} checked={preferredRole === option.value} onChange={() => setPreferredRole(option.value)} />
                        <span className="auth-choice-title"><i className={option.icon} aria-hidden="true" />{option.label}</span><span className="auth-radio-indicator" aria-hidden="true" />
                      </label>
                    ))}
                  </div>
                </section>

                <section className="auth-form-section" aria-labelledby="register-information-heading">
                  <h3 id="register-information-heading"><i className="fa-solid fa-address-card" aria-hidden="true" />Thông tin đăng ký</h3>
                  <div className="auth-field-grid">
                    <label><span className="auth-field-label">{registrationType === "organization" ? "Tên tổ chức" : "Họ và tên"} <span className="auth-required">*</span></span><div className="auth-input-wrap"><i className={`fa-solid ${registrationType === "organization" ? "fa-building" : "fa-user"}`} aria-hidden="true" /><input value={values.fullName} onChange={update("fullName")} placeholder={registrationType === "organization" ? "Nhập tên tổ chức" : "Nhập họ và tên"} required /></div></label>
                    <label><span className="auth-field-label">Số điện thoại</span><div className="auth-input-wrap"><i className="fa-solid fa-phone" aria-hidden="true" /><input type="tel" value={values.phone} onChange={update("phone")} placeholder="Nhập số ĐT" /></div></label>
                    <label className="auth-wide-field"><span className="auth-field-label">Email <span className="auth-required">*</span></span><div className="auth-input-wrap"><i className="fa-solid fa-envelope" aria-hidden="true" /><input type="email" value={values.email} onChange={update("email")} placeholder="Nhập địa chỉ email" required /></div></label>
                    <label className="auth-wide-field"><span className="auth-field-label">Địa chỉ <span className="auth-required">*</span></span><div className="auth-input-wrap"><i className="fa-solid fa-location-dot" aria-hidden="true" /><input value={values.address} onChange={update("address")} placeholder="Nhập địa chỉ" required /></div></label>
                    {registrationType === "organization" && (
                      <label className="auth-wide-field auth-participants-field"><span className="auth-subsection-title"><i className="fa-solid fa-users" aria-hidden="true" />Số lượng người tham gia</span><div className="auth-input-wrap"><i className="fa-solid fa-user-plus" aria-hidden="true" /><input type="number" min="1" value={values.participants} onChange={update("participants")} placeholder="Nhập số lượng" required /></div></label>
                    )}
                    {registrationType === "individual" && (
                      <>
                        <label><span className="auth-field-label">Mật khẩu <span className="auth-required">*</span></span><div className="auth-input-wrap"><i className="fa-solid fa-lock" aria-hidden="true" /><input type="password" value={values.password} onChange={update("password")} minLength={8} placeholder="Tối thiểu 8 ký tự" required /></div></label>
                        <label><span className="auth-field-label">Nhập lại mật khẩu <span className="auth-required">*</span></span><div className="auth-input-wrap"><i className="fa-solid fa-lock" aria-hidden="true" /><input type="password" value={values.confirm} onChange={update("confirm")} minLength={8} placeholder="Nhập lại mật khẩu" required /></div></label>
                      </>
                    )}
                  </div>
                </section>
              </div>
              <button className="auth-primary auth-register-submit" disabled={busy}>
                {busy ? "Đang xử lý…" : registrationType === "organization" ? "Xác nhận đăng ký tổ chức" : "Tạo tài khoản cá nhân"}
              </button>
            </>
          ) : (
            <>
              <label>Email<input type="email" value={values.email} onChange={update("email")} required /></label>
              {tab !== "reset" && <label>Mật khẩu<input type="password" value={values.password} onChange={update("password")} minLength={8} required /></label>}
              <button className="auth-primary" disabled={busy}>{busy ? "Đang xử lý…" : tab === "login" ? "ĐĂNG NHẬP" : "GỬI LINK ĐẶT LẠI"}</button>
            </>
          )}
        </form>

        <div className="auth-switch">
          {tab === "login"
            ? <><button onClick={() => changeTab("register")}>Tạo tài khoản</button><button onClick={() => changeTab("reset")}>Quên mật khẩu?</button></>
            : <button onClick={() => changeTab("login")}>← Quay lại đăng nhập</button>}
        </div>
      </div>
    </div>
  )
}

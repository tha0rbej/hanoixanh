import { FormEvent, useMemo, useState } from "react"
import { updateRecoveredPassword } from "../lib/supabase"

function getRecoveryToken() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  return hash.get("access_token") || ""
}

export function ResetPasswordPage() {
  const token = useMemo(getRecoveryToken, [])
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(""); setMessage("")
    if (!token) { setError("Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn."); return }
    if (password.length < 8) { setError("Mật khẩu mới phải có ít nhất 8 ký tự."); return }
    if (password !== confirm) { setError("Mật khẩu xác nhận không khớp."); return }
    setBusy(true)
    try {
      await updateRecoveredPassword(password, token)
      setMessage("Đổi mật khẩu thành công. Bạn có thể quay lại đăng nhập.")
      setPassword(""); setConfirm("")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đổi mật khẩu.") }
    finally { setBusy(false) }
  }

  return <main className="auth-backdrop"><section className="auth-card" aria-labelledby="reset-title">
    <p className="auth-kicker">HÀ NỘI XANH</p>
    <h2 id="reset-title">Đặt lại mật khẩu</h2>
    <p className="auth-muted">Nhập mật khẩu mới cho tài khoản của bạn.</p>
    {error && <div className="auth-error">{error}</div>}
    {message && <>
      <div className="auth-success">{message}</div>
      <button className="auth-primary" type="button" onClick={() => { window.location.href = "/?auth=login" }}>QUAY LẠI ĐĂNG NHẬP</button>
    </>}
    {!message && <form onSubmit={submit}>
      <label>Mật khẩu mới<input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <label>Nhập lại mật khẩu<input type="password" minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} required /></label>
      <button className="auth-primary" disabled={busy}>{busy ? "Đang cập nhật…" : "ĐỔI MẬT KHẨU"}</button>
    </form>}
  </section></main>
}

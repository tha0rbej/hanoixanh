import { useCallback, useEffect, useState, type FormEvent, type ReactNode, type ChangeEvent } from "react"
import { useAuth } from "./AuthContext"
import { tableDelete, tableInsert, tableSelect, tableUpdate, uploadPublicFile } from "../lib/supabase"
import { ImpactContentEditor } from "./ImpactContentEditor"

type Row = Record<string, unknown> & { id: string }
type Form = { title: string; location: string; start_at: string; end_at: string; capacity: string; status: string; description: string; pollution_status: string; action_plan: string; support_equipment: string; image_url: string }
const empty: Form = { title: "", location: "", start_at: "", end_at: "", capacity: "", status: "upcoming", description: "", pollution_status: "", action_plan: "", support_equipment: "", image_url: "" }
const initialNewsPosts = [
  { title: "Nhà sáng lập Hà Nội Xanh: Người dân ném rác khi chúng tôi dọn sông Tô Lịch", slug: "nha-sang-lap-ha-noi-xanh-don-song-to-lich", content: "Câu chuyện thật về hành trình làm sạch các dòng sông Hà Nội, những rủi ro của tình nguyện viên và kế hoạch mở rộng điểm xanh trên toàn thành phố.", excerpt: "Câu chuyện thật về hành trình làm sạch các dòng sông Hà Nội.", image_url: "news-hanoi-xanh.png", source_name: "VnExpress", source_url: "https://vnexpress.net/nha-sang-lap-ha-noi-xanh-nguoi-dan-nem-rac-khi-chung-toi-don-song-to-lich-5118572.html", category: "Báo tin tức", status: "published", published_at: "2026-09-10T00:00:00+07:00" },
  { title: "Hà Nội khuyến cáo hạn chế ra ngoài khi không khí ô nhiễm", slug: "ha-noi-khuyen-cao-han-che-ra-ngoai", content: "Thành phố khuyến cáo người dân giảm hoạt động ngoài trời trong những ngày chất lượng không khí xuống thấp.", excerpt: "Khuyến cáo bảo vệ sức khỏe trong những ngày chất lượng không khí xuống thấp.", image_url: "news-air-pollution.jpg", source_name: "VnExpress", source_url: "https://vnexpress.net/ha-noi-khuyen-cao-nguoi-dan-han-che-ra-ngoai-khi-khong-khi-o-nhiem-4989005.html", category: "Góc xanh", status: "published", published_at: "2025-12-02T00:00:00+07:00" },
  { title: "Vì sao không khí ở Hà Nội ô nhiễm hơn TP.HCM?", slug: "vi-sao-khong-khi-ha-noi-o-nhiem", content: "Bụi đường, PM10, PM2.5 và điều kiện thời tiết là những nguyên nhân chính.", excerpt: "Bụi đường và điều kiện thời tiết là những nguyên nhân chính.", image_url: "news-pm25.webp", source_name: "VietnamPlus", source_url: "https://www.vietnamplus.vn/vi-sao-khong-khi-o-ha-noi-o-nhiem-hon-thanh-pho-ho-chi-minh-post1023001.amp", category: "Ấn phẩm", status: "published", published_at: "2025-03-27T00:00:00+07:00" },
  { title: "Bịt mũi đi học, né rác đi làm giữa Hà Nội", slug: "bit-mui-di-hoc-ne-rac-di-lam", content: "Ghi nhận các điểm đổ trộm rác, phế thải xây dựng trên đường phố.", excerpt: "Ghi nhận các điểm đổ trộm rác và phế thải xây dựng trên đường phố.", image_url: "news-waste-hanoi.jpg", source_name: "VOV", source_url: "https://vov.vn/xa-hoi/bit-mui-di-hoc-ne-rac-di-lam-ha-noi-co-bat-luc-truoc-rac-thai-va-phe-thai-post1215281.vov", category: "Podcast", status: "published", published_at: "2025-07-17T00:00:00+07:00" },
  { title: "Sông Tô Lịch sau gần một năm triển khai dự án hồi sinh", slug: "song-to-lich-sau-gan-mot-nam-hoi-sinh", content: "Cập nhật tiến độ dự án hồi sinh sông Tô Lịch sau gần một năm triển khai.", excerpt: "Cập nhật tiến độ dự án hồi sinh sông Tô Lịch.", image_url: "news-to-lich.jpg", source_name: "VnExpress", source_url: "https://vnexpress.net/song-to-lich-sau-gan-mot-nam-trien-khai-du-an-hoi-sinh-4935239.html", category: "Xu hướng nổi bật", status: "published", published_at: "2025-09-06T00:00:00+07:00" },
  { title: "Hà Nội sẽ xây dựng công viên dọc sông Tô Lịch", slug: "ha-noi-xay-cong-vien-doc-song-to-lich", content: "Thông tin quy hoạch công viên dọc sông Tô Lịch nhằm cải thiện cảnh quan và môi trường.", excerpt: "Hà Nội dự kiến xây dựng công viên dọc sông Tô Lịch.", image_url: "news-to-lich-park.jpg", source_name: "VnExpress", source_url: "https://vnexpress.net/ha-noi-se-xay-dung-cong-vien-doc-song-to-lich-4942042.html", category: "Xu hướng nổi bật", status: "published", published_at: "2025-09-23T00:00:00+07:00" },
  { title: "Hà Nội có hàng chục ngày không khí rất xấu trong năm 2025", slug: "ha-noi-hang-chuc-ngay-khong-khi-rat-xau-2025", content: "Chất lượng không khí tại Hà Nội có nhiều ngày ở mức rất xấu trong năm 2025.", excerpt: "Hà Nội ghi nhận hàng chục ngày chất lượng không khí ở mức rất xấu.", image_url: "news-bad-air-2025.jpg", source_name: "Dân trí", source_url: "https://dantri.com.vn/suc-khoe/tphcm-ha-noi-co-hang-chuc-ngay-khong-khi-rat-xau-trong-nam-2025-20250815111954796.htm", category: "Xu hướng nổi bật", status: "published", published_at: "2025-08-15T00:00:00+07:00" },
]
const val = (r: Row, k: string) => String(r[k] ?? "")
const localDate = (v: string) => v ? new Date(v).toISOString().slice(0, 16) : ""

export function ConnectedAdminDashboard({ onLogin }: { onLogin?: () => void }) {
  const [profiles, setProfiles] = useState<Row[]>([])
  const [newsCatalogChecked, setNewsCatalogChecked] = useState(false)
  const { session, profile, signOut } = useAuth(); const [tab, setTab] = useState("campaigns"); const [campaigns, setCampaigns] = useState<Row[]>([]); const [homepageMetrics, setHomepageMetrics] = useState<Row[]>([]); const [posts, setPosts] = useState<Row[]>([]); const [reports, setReports] = useState<Row[]>([]); const [messages, setMessages] = useState<Row[]>([]); const [registrations, setRegistrations] = useState<Row[]>([]); const [volunteers, setVolunteers] = useState<Row[]>([]); const [partners, setPartners] = useState<Row[]>([]); const [form, setForm] = useState<Form>(empty); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState(""); const [uploading, setUploading] = useState(false)
  const load = useCallback(async () => { if (!session) return; const results = await Promise.allSettled([tableSelect<Row>("campaigns", "*", session.access_token, "&order=start_at.desc"), tableSelect<Row>("pollution_reports", "*", session.access_token, "&order=created_at.desc"), tableSelect<Row>("contact_messages", "*", session.access_token, "&order=created_at.desc"), tableSelect<Row>("campaign_registrations", "*,campaigns(title)", session.access_token, "&order=created_at.desc"), tableSelect<Row>("partners", "*", session.access_token, "&order=created_at.desc")]); const [c, r, m, v, p] = results.map(x => x.status === "fulfilled" ? x.value : []) as Row[][]; setCampaigns(c); setReports(r); setMessages(m); setRegistrations(v); setPartners(p); const failed = results.find(x => x.status === "rejected"); if (failed) setError("Một số dữ liệu dashboard chưa tải được.") }, [session])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!session) return; void tableSelect<Row>("homepage_metrics", "*", session.access_token, "&order=metric_key.asc").then(setHomepageMetrics).catch(() => undefined) }, [session])
  useEffect(() => { if (!session) return; void tableSelect<Row>("campaign_registrations", "*,profiles(full_name,email,phone),campaigns(title)", session.access_token, "&order=created_at.desc").then(items => setRegistrations(items.map(r => { const p = (r.profiles || {}) as Record<string, unknown>; return { ...r, name: p.full_name || r.name || '', email: p.email || r.email || '', phone: p.phone || r.phone || '' } }))).catch(() => undefined) }, [session])
  useEffect(() => { if (!session) return; void tableSelect<Row>("profiles", "*", session.access_token, "&order=created_at.desc").then(setProfiles).catch(() => tableSelect<Row>("profiles", "id,full_name,email,phone,created_at", session.access_token, "&order=created_at.desc").then(setProfiles).catch(() => undefined)) }, [session])
  useEffect(() => {
    if (!session) return
    void tableSelect<Row>("volunteer_registrations", "*", session.access_token, "&order=created_at.desc")
      .then(setVolunteers)
      .catch(cause => setError(cause instanceof Error ? cause.message : "Không tải được danh sách đăng ký tình nguyện viên"))
  }, [session])
  useEffect(() => { if (!session) return; void tableSelect<Row>("posts", "*", session.access_token, "&order=created_at.desc").then(setPosts).catch(() => undefined) }, [session])
  useEffect(() => {
    if (!session || newsCatalogChecked) return
    setNewsCatalogChecked(true)
    void (async () => {
      try {
        const current = await tableSelect<Row>("posts", "*", session.access_token, "&order=created_at.desc")
        const marker = await tableSelect<Row>("homepage_metrics", "id", session.access_token, "&metric_key=eq.news_catalog_initialized&limit=1")
        if (marker.length) { setPosts(current); return }
        const existingSlugs = new Set(current.map(row => String(row.slug || "")))
        const missing = initialNewsPosts.filter(post => !existingSlugs.has(post.slug))
        if (missing.length) await Promise.all(missing.map(post => tableInsert("posts", { ...post, author_id: profile?.id || null }, session.access_token)))
        await tableInsert("homepage_metrics", { metric_key: "news_catalog_initialized", metric_value: { version: 1, initialized_at: new Date().toISOString() } }, session.access_token)
        setPosts(await tableSelect<Row>("posts", "*", session.access_token, "&order=published_at.desc.nullslast,created_at.desc"))
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Không đồng bộ được các bài tin tức hiện có") }
    })()
  }, [session, profile, newsCatalogChecked])
  useEffect(() => {
    if (!session) return
    void Promise.all([
      tableSelect<Row>("campaign_registrations", "*,profiles(full_name,email,phone),campaigns(title)", session.access_token, "&order=created_at.desc"),
      tableSelect<Row>("pollution_reports", "*,profiles(full_name,email,phone)", session.access_token, "&order=created_at.desc"),
      tableSelect<Row>("contact_messages", "*,profiles(full_name,email,phone)", session.access_token, "&order=created_at.desc"),
    ]).then(([registrations, reports, messages]) => {
      const person = (row: Row) => (row.profiles || {}) as Record<string, unknown>
      setRegistrations(registrations.map(row => { const p = person(row); return { ...row, name: p.full_name || row.name || "Chưa cập nhật", email: p.email || row.email || "Chưa cập nhật", phone: p.phone || row.phone || "Chưa cập nhật" } }))
      setReports(reports.map(row => { const p = person(row); return { ...row, name: p.full_name || "Chưa cập nhật", email: p.email || "Chưa cập nhật" } }))
      setMessages(messages.map(row => { const p = person(row); return { ...row, name: p.full_name || row.name || "Khách chưa đăng nhập", email: p.email || row.email || "Chưa cung cấp" } }))
    }).catch(() => undefined)
  }, [session])
  useEffect(() => { if (!profiles.length) return; const byId = new Map(profiles.map(p => [p.id, p])); setRegistrations(items => items.map(r => { const p = byId.get(String(r.user_id)); return p ? { ...r, name: p.full_name, email: p.email, phone: p.phone } : r })); setReports(items => items.map(r => { const p = byId.get(String(r.user_id)); return p ? { ...r, name: p.full_name, email: p.email } : r })) }, [profiles, registrations.length, reports.length])
  useEffect(() => { if (tab !== 'posts') return; const root = document.querySelector('.admin-content'); if (!root) return; const box = document.createElement('section'); box.className = 'admin-panel'; box.innerHTML = `<h2>Quản lý tin tức (${posts.length})</h2><form data-post-form><div class="form-grid"><label>Tiêu đề<input name="title" required></label><label>Danh mục<input name="category" value="Báo tin tức"></label><label>Nguồn<input name="source_name"></label><label>URL nguồn<input name="source_url"></label><label>Ảnh đại diện<input name="image_url"></label><label>Trạng thái<select name="status"><option value="draft">Bản nháp</option><option value="published">Đã xuất bản</option></select></label></div><label class="wide-field">Mô tả ngắn<textarea name="excerpt"></textarea></label><label class="wide-field">Nội dung<textarea name="content" required></textarea></label><button class="admin-primary">Lưu bài viết</button></form><hr><table><thead><tr><th>Tiêu đề</th><th>Nguồn</th><th>Trạng thái</th><th></th></tr></thead><tbody>${posts.map(p => `<tr data-id="${p.id}"><td>${String(p.title || '')}</td><td>${String(p.source_name || '')}</td><td>${String(p.status || '')}</td><td><button data-edit="${p.id}">Sửa</button> <button data-delete="${p.id}">Xóa</button></td></tr>`).join('')}</tbody></table>`; root.appendChild(box); const form = box.querySelector('form') as HTMLFormElement; const fields = (f: HTMLFormElement) => Object.fromEntries(new FormData(f).entries()); form.onsubmit = async e => { e.preventDefault(); if (!session) return; const v = fields(form) as Record<string, string>; try { await tableInsert('posts', { ...v, slug: `${v.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`, author_id: profile?.id, published_at: v.status === 'published' ? new Date().toISOString() : null }, session.access_token); const next = await tableSelect<Row>('posts', '*', session.access_token, '&order=created_at.desc'); setPosts(next); form.reset(); } catch (x) { setError(x instanceof Error ? x.message : 'Không lưu được bài viết') } }; box.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => { if (!session || !confirm('Xóa bài viết này?')) return; await tableDelete('posts', `id=eq.${(b as HTMLElement).dataset.delete}`, session.access_token); setPosts(await tableSelect<Row>('posts', '*', session.access_token, '&order=created_at.desc')) })); return () => box.remove() }, [tab, posts, session, profile])
  useEffect(() => {
    if (tab !== "posts" || !session) return
    const form = document.querySelector("[data-post-form]") as HTMLFormElement | null
    if (!form) return
    let editingId: string | null = null
    const submitButton = form.querySelector("button[type='submit'], button.admin-primary") as HTMLButtonElement | null
    const imageUrlField = form.elements.namedItem("image_url") as HTMLInputElement | null
    const imageLabel = imageUrlField?.closest("label")
    const imageFileField = document.createElement("input")
    const imagePreview = document.createElement("img")
    const uploadStatus = document.createElement("small")
    imageFileField.type = "file"
    imageFileField.accept = "image/*"
    imageFileField.name = "post_image_file"
    imagePreview.alt = "Xem trước ảnh đại diện"
    imagePreview.style.cssText = "display:none;width:180px;height:110px;object-fit:cover;margin-top:8px;border-radius:9px;border:1px solid #dbe4df"
    uploadStatus.style.cssText = "display:block;margin-top:6px;color:#64748b"
    if (imageUrlField && imageLabel) {
      imageUrlField.type = "hidden"
      imageLabel.append(imageFileField, uploadStatus, imagePreview)
      imageFileField.onchange = async () => {
        const file = imageFileField.files?.[0]
        if (!file) return
        uploadStatus.textContent = "Đang tải ảnh…"
        if (submitButton) submitButton.disabled = true
        try {
          const url = await uploadPublicFile(file, session.access_token)
          imageUrlField.value = url
          imagePreview.src = url
          imagePreview.style.display = "block"
          uploadStatus.textContent = "Ảnh đã tải lên thành công."
        } catch (cause) {
          uploadStatus.textContent = cause instanceof Error ? cause.message : "Không tải được ảnh."
        } finally {
          if (submitButton) submitButton.disabled = false
        }
      }
    }
    const fieldNames = ["title", "category", "source_name", "source_url", "image_url", "status", "excerpt", "content"]
    const fillForm = (row: Row) => {
      editingId = row.id
      fieldNames.forEach(name => {
        const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
        if (field) field.value = String(row[name] ?? "")
      })
      const currentImage = String(row.image_url || "")
      if (currentImage) {
        imagePreview.src = currentImage.startsWith("http") ? currentImage : `/source/remaining/${currentImage}`
        imagePreview.style.display = "block"
      } else imagePreview.style.display = "none"
      uploadStatus.textContent = ""
      if (submitButton) submitButton.textContent = "LƯU THAY ĐỔI"
      form.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    document.querySelectorAll<HTMLElement>("[data-edit]").forEach(button => {
      button.onclick = () => { const row = posts.find(item => item.id === button.dataset.edit); if (row) fillForm(row) }
    })
    form.onsubmit = async event => {
      event.preventDefault()
      const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
      delete values.post_image_file
      try {
        const payload = { ...values, author_id: profile?.id, published_at: values.status === "published" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }
        if (editingId) await tableUpdate("posts", `id=eq.${editingId}`, payload, session.access_token)
        else await tableInsert("posts", { ...payload, slug: `${values.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now()}` }, session.access_token)
        setPosts(await tableSelect<Row>("posts", "*", session.access_token, "&order=created_at.desc"))
        form.reset(); editingId = null; imagePreview.style.display = "none"; uploadStatus.textContent = ""
        if (submitButton) submitButton.textContent = "LƯU BÀI VIẾT"
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được bài viết") }
    }
  }, [tab, posts, session, profile])
  if (!profile || profile.role !== "admin") return <main className="admin-locked"><div><h1>Đăng nhập quản trị</h1>{onLogin && <button className="auth-primary" onClick={onLogin}>ĐĂNG NHẬP</button>}</div></main>
  const set = (key: keyof Form, value: string) => setForm(x => ({ ...x, [key]: value }))
  async function image(e: ChangeEvent<HTMLInputElement>) { const file = e.target.files?.[0]; if (!file || !session) return; setUploading(true); try { set("image_url", await uploadPublicFile(file, session.access_token)) } catch (x) { setError(x instanceof Error ? x.message : "Không tải được ảnh") } finally { setUploading(false) } }
  async function save(e: FormEvent) { e.preventDefault(); if (!session) return; try { const payload = { ...form, start_at: new Date(form.start_at).toISOString(), end_at: form.end_at ? new Date(form.end_at).toISOString() : null, capacity: form.capacity ? Number(form.capacity) : null }; if (editing) await tableUpdate("campaigns", `id=eq.${editing}`, payload, session.access_token); else await tableInsert("campaigns", payload, session.access_token); setForm(empty); setEditing(null); await load() } catch (x) { setError(x instanceof Error ? x.message : "Không lưu được chiến dịch") } }
  async function remove(id: string) { if (!session || !confirm("Xóa chiến dịch này? Các lượt đăng ký thuộc chiến dịch cũng sẽ được gỡ khỏi danh sách.")) return; try { await tableDelete("campaign_registrations", `or=(campaign_id.eq.${id},campaign_key.eq.${id})`, session.access_token) } catch { /* campaign_id rows still cascade; legacy orphan rows are filtered from the UI */ } await tableDelete("campaigns", `id=eq.${id}`, session.access_token); await load() }
  async function saveParticipation(id: string, status: string, attendedHours: number, trashKg: number) { if (!session) return; setError(""); const coreValues = { status, attended_hours: status === "attended" ? attendedHours : 0, trash_kg: status === "attended" ? trashKg : 0 }; const values = { ...coreValues, attended_at: status === "attended" ? new Date().toISOString() : null }; try { try { await tableUpdate("campaign_registrations", `id=eq.${id}`, values, session.access_token) } catch (firstError) { const message = firstError instanceof Error ? firstError.message : ""; if (!message.includes("attended_at") && !message.includes("schema cache")) throw firstError; await tableUpdate("campaign_registrations", `id=eq.${id}`, coreValues, session.access_token) } setRegistrations(items => items.map(item => item.id === id ? { ...item, ...values } : item)) } catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được kết quả tham gia") } }
  function edit(r: Row) { setEditing(r.id); setForm({ title: val(r, "title"), location: val(r, "location"), start_at: localDate(val(r, "start_at")), end_at: localDate(val(r, "end_at")), capacity: val(r, "capacity"), status: val(r, "status") || "upcoming", description: val(r, "description"), pollution_status: val(r, "pollution_status"), action_plan: val(r, "action_plan"), support_equipment: val(r, "support_equipment"), image_url: val(r, "image_url") }) }
  const pageTitle = tab === "accounts" ? "Tài khoản người dùng" : tab === "volunteers" ? "Đăng ký làm tình nguyện viên" : tab === "registrations" ? "Đăng ký theo chiến dịch" : tab === "campaigns" ? "Quản lý chiến dịch" : tab === "homepage" ? "Nội dung tác động cộng đồng" : tab === "partners" ? "Đối tác" : tab === "messages" ? "Lời nhắn từ website" : tab === "reports" ? "Báo cáo ô nhiễm" : tab === "posts" ? "Tin tức" : "Quản lý chiến dịch"
  const menuGroups = [
    { label: "Cộng đồng", items: [["accounts", "Tài khoản người dùng"], ["volunteers", "Đăng ký tình nguyện viên"], ["partners", "Đối tác"]] },
    { label: "Hoạt động", items: [["campaigns", "Chiến dịch"], ["registrations", "Đăng ký theo chiến dịch"], ["reports", "Báo cáo ô nhiễm"]] },
    { label: "Nội dung & liên hệ", items: [["homepage", "Nội dung tác động"], ["posts", "Tin tức"], ["messages", "Lời nhắn"]] },
  ]
  return <main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><span>🌱</span><div><strong>HÀ NỘI XANH</strong><small>ADMIN CONSOLE</small></div></div><nav>{menuGroups.map(group => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>)}</nav><div className="admin-sidebar-actions"><a className="admin-home-link" href="/">← Về trang chính</a></div></aside><section className="admin-content"><header className="admin-topbar"><div><p className="admin-kicker">BẢNG ĐIỀU KHIỂN</p><h1>{pageTitle}</h1></div><div className="admin-user"><span>{profile.full_name || profile.email}</span><small>ADMIN</small></div></header>{error && <div className="admin-error">{error}</div>}{tab === "accounts" && <AccountManager profiles={profiles} registrations={registrations} campaigns={campaigns} />}{tab === "volunteers" && <Simple title={`Đăng ký làm tình nguyện viên (${volunteers.length})`} rows={volunteers} cols={[["name", "Họ tên"], ["phone", "Số điện thoại"], ["email", "Email"], ["address", "Địa chỉ"], ["created_at", "Ngày đăng ký"]]} />}{tab === "homepage" && <ImpactContentEditor rows={homepageMetrics} session={session} onSaved={setHomepageMetrics} />}{tab === "campaigns" && <CampaignForm form={form} set={set} onImage={image} uploading={uploading} editing={!!editing} onSave={save} onCancel={() => { setEditing(null); setForm(empty) }} rows={campaigns} onEdit={edit} onDelete={remove} />}{tab === "messages" && <Simple title={`Lời nhắn (${messages.length})`} rows={messages} cols={[["name", "Người gửi"], ["email", "Email"], ["message", "Nội dung"], ["created_at", "Ngày gửi"]]} />}{tab === "reports" && <Simple title={`Báo cáo (${reports.length})`} rows={reports} cols={[["user_id", "Tài khoản"], ["location_name", "Địa điểm"], ["description", "Mô tả"], ["status", "Trạng thái"]]} />}{tab === "registrations" && <RegistrationManager rows={registrations} profiles={profiles} campaigns={campaigns} onSave={saveParticipation} />}{tab === "partners" && <Simple title={`Đối tác (${partners.length})`} rows={partners} cols={[["name", "Tên"], ["organization", "Tổ chức"], ["email", "Email"]]} />}</section></main>
}
function CampaignForm({ form, set, onImage, uploading, editing, onSave, onCancel, rows, onEdit, onDelete }: { form: Form; set: (k: keyof Form, v: string) => void; onImage: (e: ChangeEvent<HTMLInputElement>) => void; uploading: boolean; editing: boolean; onSave: (e: FormEvent) => void; onCancel: () => void; rows: Row[]; onEdit: (r: Row) => void; onDelete: (id: string) => void }) { return <div className="admin-page"><section className="admin-panel"><h2>{editing ? "Chỉnh sửa chiến dịch" : "Tạo chiến dịch"}</h2><form onSubmit={onSave}><div className="form-grid"><Field label="Tên chiến dịch" value={form.title} required set={v => set("title", v)} /><Field label="Địa điểm" value={form.location} required set={v => set("location", v)} /><Field label="Bắt đầu" type="datetime-local" value={form.start_at} required set={v => set("start_at", v)} /><Field label="Kết thúc" type="datetime-local" value={form.end_at} set={v => set("end_at", v)} /><Field label="Sức chứa" type="number" value={form.capacity} set={v => set("capacity", v)} /><label>Trạng thái<select value={form.status} onChange={e => set("status", e.target.value)}><option value="upcoming">Sắp diễn ra</option><option value="completed">Đã diễn ra</option></select></label></div><Text label="Tình trạng ô nhiễm tại điểm ra quân" value={form.pollution_status} set={v => set("pollution_status", v)} /><Text label="Kế hoạch & mục tiêu hành động" value={form.action_plan} set={v => set("action_plan", v)} /><Text label="Trang bị hỗ trợ từ Hà Nội Xanh" value={form.support_equipment} set={v => set("support_equipment", v)} /><Text label="Mô tả ngắn" value={form.description} set={v => set("description", v)} required /><label className="wide-field">Ảnh chiến dịch<input type="file" accept="image/*" onChange={onImage} />{uploading && <small>Đang tải ảnh…</small>}{form.image_url && <img src={form.image_url} alt="Xem trước" style={{ maxWidth: 180, marginTop: 8, borderRadius: 8 }} />}</label><button className="admin-primary">{editing ? "LƯU THAY ĐỔI" : "TẠO CHIẾN DỊCH"}</button>{editing && <button type="button" onClick={onCancel}>Hủy</button>}</form></section><List title="Tất cả chiến dịch"><table><thead><tr><th>Tên</th><th>Thời gian</th><th>Trạng thái</th><th /></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{String(r.title)}</td><td>{new Date(String(r.start_at)).toLocaleString("vi-VN")}</td><td>{String(r.status)}</td><td><button onClick={() => onEdit(r)}>Sửa</button> <button className="link-danger" onClick={() => onDelete(r.id)}>Xóa</button></td></tr>)}</tbody></table></List></div> }
function Field({ label, value, set, type = "text", required = false }: { label: string; value: string; set: (v: string) => void; type?: string; required?: boolean }) { return <label>{label}<input type={type} value={value} required={required} onChange={e => set(e.target.value)} /></label> }
function Text({ label, value, set, required = false }: { label: string; value: string; set: (v: string) => void; required?: boolean }) { return <label className="wide-field">{label}<textarea value={value} required={required} onChange={e => set(e.target.value)} /></label> }
function List({ title, children }: { title: string; children: ReactNode }) { return <section className="admin-panel"><h2>{title}</h2><div className="admin-table-wrap">{children}</div></section> }
function Simple({ title, rows, cols }: { title: string; rows: Row[]; cols: string[][] }) {
  const volunteer = title.startsWith("Tình nguyện viên")
  const report = title.startsWith("Báo cáo")
  const partner = title.startsWith("Đối tác")
  const actual = volunteer
    ? [["name", "Họ tên"], ["email", "Email"], ["phone", "Số điện thoại"], ["created_at", "Ngày đăng ký"]]
    : report
      ? [["name", "Họ tên"], ["email", "Email"], ["location_name", "Địa điểm"], ["description", "Mô tả"], ["photo_urls", "Ảnh"], ["created_at", "Ngày gửi"]]
      : partner
        ? [["organization", "Tổ chức"], ["organization_type", "Loại hình"], ["name", "Người đại diện"], ["phone", "Số điện thoại"], ["email", "Email"], ["created_at", "Ngày đăng ký"]]
        : cols
  const cell = (r: Row, key: string) => key === "photo_urls"
    ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{(Array.isArray(r.photo_urls) ? r.photo_urls : r.photo_url ? [r.photo_url] : []).map((url, i) => <img key={i} src={String(url)} alt="Ảnh báo cáo" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6 }} />)}</div>
    : key === "created_at" ? new Date(String(r[key])).toLocaleString("vi-VN") : String(r[key] ?? "")
  return <List title={title}><table><thead><tr>{actual.map(c => <th key={c[0]}>{c[1]}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id}>{actual.map(c => <td key={c[0]}>{cell(r, c[0])}</td>)}</tr>)}</tbody></table></List>
}

function AccountManager({ profiles, registrations, campaigns }: { profiles: Row[]; registrations: Row[]; campaigns: Row[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const uniqueProfiles = Array.from(new Map(profiles.map(row => [String(row.id || row.email).toLowerCase(), row])).values())
  const selected = uniqueProfiles.find(row => row.id === selectedId)
  const validRegistration = (row: Row) => Boolean((row.campaigns as Record<string, unknown> | undefined)?.title || campaigns.some(item => item.id === String(row.campaign_id || row.campaign_key || "")))
  const activeRegistrations = registrations.filter(validRegistration)
  const history = selected ? Array.from(new Map(activeRegistrations.filter(row => String(row.user_id) === selected.id).map(row => [String(row.campaign_id || row.campaign_key || row.id), row])).values()) : []
  const campaignName = (row: Row) => {
    const joined = (row.campaigns || {}) as Record<string, unknown>
    const key = String(row.campaign_id || row.campaign_key || "")
    return String(joined.title || campaigns.find(item => item.id === key)?.title || row.campaign_key || "Chưa xác định chiến dịch")
  }
  return <div className="admin-page"><List title={`Toàn bộ tài khoản đã đăng ký (${uniqueProfiles.length})`}><table><thead><tr><th>STT</th><th>Họ tên</th><th>Email</th><th>Số điện thoại</th><th>Ngày tạo</th><th>Số chiến dịch</th><th /></tr></thead><tbody>{uniqueProfiles.map((row, index) => { const count = new Set(activeRegistrations.filter(item => String(item.user_id) === row.id && item.status !== "cancelled").map(item => String(item.campaign_id || item.campaign_key || item.id))).size; return <tr key={row.id}><td>{index + 1}</td><td>{String(row.full_name || "Chưa cập nhật")}</td><td>{String(row.email || "")}</td><td>{String(row.phone || "Chưa cập nhật")}</td><td>{row.created_at ? new Date(String(row.created_at)).toLocaleString("vi-VN") : "—"}</td><td>{count}</td><td><button type="button" onClick={() => setSelectedId(row.id)}>Xem chi tiết</button></td></tr> })}</tbody></table>{!uniqueProfiles.length && <p className="admin-empty">Chưa có tài khoản nào.</p>}</List>{selected && <section className="admin-panel"><div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><h2>Chi tiết tài khoản</h2><button type="button" onClick={() => setSelectedId(null)}>Đóng</button></div><div className="form-grid"><p><strong>Họ tên</strong><br />{String(selected.full_name || "Chưa cập nhật")}</p><p><strong>Email</strong><br />{String(selected.email || "")}</p><p><strong>Số điện thoại</strong><br />{String(selected.phone || "Chưa cập nhật")}</p><p><strong>Ngày tạo tài khoản</strong><br />{selected.created_at ? new Date(String(selected.created_at)).toLocaleString("vi-VN") : "—"}</p><p><strong>Ngày sinh</strong><br />{String(selected.birth_date || "Chưa cập nhật")}</p><p><strong>Giới tính</strong><br />{String(selected.gender || "Chưa cập nhật")}</p><p><strong>Địa chỉ</strong><br />{String(selected.address || "Chưa cập nhật")}</p><p><strong>Trường học/Nghề nghiệp</strong><br />{String(selected.occupation || "Chưa cập nhật")}</p></div><h3>Lịch sử đăng ký chiến dịch ({history.length})</h3>{history.length ? <div className="admin-table-wrap"><table><thead><tr><th>Chiến dịch</th><th>Ngày đăng ký</th><th>Trạng thái</th><th>Giờ xác nhận</th><th>Rác (kg)</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{campaignName(row)}</td><td>{row.created_at ? new Date(String(row.created_at)).toLocaleString("vi-VN") : "—"}</td><td>{String(row.status || "registered")}</td><td>{String(row.attended_hours || 0)}</td><td>{String(row.trash_kg || 0)}</td></tr>)}</tbody></table></div> : <p className="admin-empty">Tài khoản này chưa đăng ký chiến dịch.</p>}</section>}</div>
}

function RegistrationManager({ rows, profiles, campaigns, onSave }: { rows: Row[]; profiles: Row[]; campaigns: Row[]; onSave: (id: string, status: string, hours: number, trashKg: number) => Promise<void> }) {
  const campaignName = (row: Row) => { const joined = (row.campaigns || {}) as Record<string, unknown>; const key = String(row.campaign_id || row.campaign_key || ""); return String(joined.title || campaigns.find(item => item.id === key)?.title || row.campaign_key || "Chưa xác định chiến dịch") }
  const groups = new Map<string, Row[]>()
  const profileById = new Map(profiles.map(item => [String(item.id), item]))
  const activeRows = rows.filter(row => Boolean((row.campaigns as Record<string, unknown> | undefined)?.title || campaigns.some(item => item.id === String(row.campaign_id || row.campaign_key || ""))))
  activeRows.forEach(row => { const person = profileById.get(String(row.user_id)); const merged = person ? { ...row, name: person.full_name, email: person.email, phone: person.phone } : row; const name = campaignName(row); const current = groups.get(name) || []; if (!current.some(item => String(item.user_id) === String(row.user_id))) current.push(merged); groups.set(name, current) })
  return <div className="admin-page">{Array.from(groups.entries()).map(([name, items]) => <List key={name} title={`${name} (${items.length} người đăng ký)`}><table><thead><tr><th>STT</th><th>Tình nguyện viên</th><th>Liên hệ</th><th>Trạng thái</th><th>Giờ xác nhận</th><th>Rác (kg)</th><th /></tr></thead><tbody>{items.map((row, index) => <RegistrationEditor key={row.id} index={index + 1} row={row} onSave={onSave} />)}</tbody></table></List>)}{!activeRows.length && <List title="Đăng ký chiến dịch"><p className="admin-empty">Chưa có đăng ký chiến dịch.</p></List>}</div>
}

function RegistrationEditor({ row, index, onSave }: { row: Row; index: number; onSave: (id: string, status: string, hours: number, trashKg: number) => Promise<void> }) {
  const [status, setStatus] = useState(String(row.status || "registered"))
  const [hours, setHours] = useState(Number(row.attended_hours || 0))
  const [trashKg, setTrashKg] = useState(Number(row.trash_kg || 0))
  const [saving, setSaving] = useState(false)
  const attended = status === "attended"
  const save = async () => { setSaving(true); try { await onSave(row.id, status, hours, trashKg) } finally { setSaving(false) } }
  return <tr><td>{index}</td><td><strong>{String(row.name || "Chưa cập nhật")}</strong><small>{String(row.phone || "")}</small></td><td>{String(row.email || "")}</td><td><select value={status} onChange={event => setStatus(event.target.value)}><option value="registered">Đã đăng ký</option><option value="attended">Đã tham gia</option><option value="cancelled">Đã hủy/vắng</option></select></td><td><input type="number" min="0" step="0.5" value={hours} disabled={!attended} onChange={event => setHours(Number(event.target.value))} style={{ width: 90 }} /></td><td><input type="number" min="0" step="0.1" value={trashKg} disabled={!attended} onChange={event => setTrashKg(Number(event.target.value))} style={{ width: 90 }} /></td><td><button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Đang lưu…" : "Lưu"}</button></td></tr>
}

function HomepageMetrics({ rows, session, onSaved }: { rows: Row[]; session: { access_token: string } | null; onSaved: (rows: Row[]) => void }) {
  const get = (key: string) => rows.find(row => row.metric_key === key)?.metric_value;
  const [overview, setOverview] = useState(() => (get('overview') as Record<string, number>) || { campaigns: 250, volunteers: 1200, trash_tons: 350, cleaned_km: 50 });
  const [monthly, setMonthly] = useState(() => (get('monthly_waste') as Record<string, number>) || { '2026-05': 62, '2026-06': 78, '2026-07': 84, '2026-08': 71, '2026-09': 55 });
  const [tiers, setTiers] = useState(() => (get('impact_tiers') as { amount: number; text: string }[]) || []);
  useEffect(() => { const nextOverview = get('overview'); const nextMonthly = get('monthly_waste'); const nextTiers = get('impact_tiers'); if (nextOverview) setOverview(nextOverview as Record<string, number>); if (nextMonthly) setMonthly(nextMonthly as Record<string, number>); if (nextTiers) setTiers(nextTiers as { amount: number; text: string }[]); }, [rows]);
  const save = async (key: string, value: unknown) => { if (!session) return; await tableUpdate('homepage_metrics', `metric_key=eq.${key}`, { metric_value: value, updated_at: new Date().toISOString() }, session.access_token); onSaved(rows.map(row => row.metric_key === key ? { ...row, metric_value: value } : row)); };
  return <div className="admin-page"><section className="admin-panel"><h2>Tổng quan dữ liệu toàn hệ thống</h2><div className="form-grid">{[['campaigns','Số chiến dịch'],['volunteers','Tình nguyện viên'],['trash_tons','Tấn rác đã xử lý'],['cleaned_km','Km sông đã làm sạch']].map(([key,label]) => <Field key={key} label={label} type="number" value={String(overview[key] ?? '')} set={v => setOverview({ ...overview, [key]: Number(v) })} />)}</div><button className="admin-primary" onClick={() => void save('overview', overview)}>Lưu tổng quan</button></section><section className="admin-panel"><h2>Khối lượng rác theo tháng (Tấn)</h2>{Object.entries(monthly).map(([month, value]) => <div key={month} className="form-grid"><Field label={month} type="number" value={String(value)} set={v => setMonthly({ ...monthly, [month]: Number(v) })} /></div>)}<button className="admin-primary" onClick={() => void save('monthly_waste', monthly)}>Lưu biểu đồ</button></section><section className="admin-panel"><h2>Tác động cộng đồng</h2>{tiers.map((tier, index) => <div className="form-grid" key={index}><Field label="Mức đóng góp (VNĐ)" type="number" value={String(tier.amount)} set={v => setTiers(tiers.map((x, i) => i === index ? { ...x, amount: Number(v) } : x))} /><Field label="Nội dung" value={tier.text} set={v => setTiers(tiers.map((x, i) => i === index ? { ...x, text: v } : x))} /></div>)}<button className="admin-primary" onClick={() => void save('impact_tiers', tiers)}>Lưu tác động cộng đồng</button></section></div>;
}

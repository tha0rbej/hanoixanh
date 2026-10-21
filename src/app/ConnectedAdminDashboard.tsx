import { useCallback, useEffect, useState, type FormEvent, type ReactNode, type ChangeEvent } from "react"
import { useAuth } from "./AuthContext"
import { tableDelete, tableInsert, tableSelect, tableUpdate, uploadPublicFile } from "../lib/supabase"
import { ImpactContentEditor } from "./ImpactContentEditor"
import { DEFAULT_REWARD_PROGRAM, clampCampaignPoints, normalizeRewardProgram, updateCumulativePoints, type BadgeRule } from "./rewards"

type Row = Record<string, unknown> & { id: string }
type Form = { title: string; location: string; start_at: string; end_at: string; capacity: string; registered_count: string; reward_points: string; status: string; description: string; pollution_status: string; action_plan: string; support_equipment: string; image_url: string; image_urls: string[] }
const empty: Form = { title: "", location: "", start_at: "", end_at: "", capacity: "", registered_count: "0", reward_points: "10000", status: "upcoming", description: "", pollution_status: "", action_plan: "", support_equipment: "", image_url: "", image_urls: [] }
const ADMIN_MENU_GROUPS = [
  { label: "Nội dung CLB", items: [["admin-account", "Tài khoản admin"], ["founders", "Cổ đông sáng lập"], ["team", "Đội ngũ"], ["green-rewards", "Quà xanh"], ["homepage", "Tác động"], ["campaigns", "Chiến dịch"], ["posts", "Tin tức"]] },
  { label: "Nội dung người dùng", items: [["accounts", "Tài khoản người dùng"], ["rewards", "Điểm & huy hiệu"], ["registrations", "Đăng ký theo chiến dịch"], ["redemptions", "Đổi quà"], ["messages", "Lời nhắn"], ["reports", "Báo cáo ô nhiễm"]] },
]
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
const isAdminProfile = (row: Row) => String(row.role || "user").trim().toLowerCase() === "admin"
const campaignRegistrationCount = (campaign: Row, registrations: Row[]) => {
  const campaignId = String(campaign.id || "")
  const campaignTitle = String(campaign.title || "")
  const users = registrations
    .filter(row => String(row.status || "registered") !== "cancelled")
    .filter(row => {
      const rowCampaign = (row.campaigns || {}) as Record<string, unknown>
      return String(row.campaign_id || "") === campaignId
        || String(row.campaign_key || "") === campaignId
        || String(rowCampaign.title || "") === campaignTitle
    })
    .map(row => String(row.user_id || row.id || ""))
    .filter(Boolean)
  return new Set(users).size
}
const localDate = (v: string) => v ? new Date(v).toISOString().slice(0, 16) : ""
const isRewardSchemaMissingError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message.toLowerCase() : ""
  return message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find")
}
const isRewardImageColumnMissingError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message.toLowerCase() : ""
  return message.includes("image_url") && (message.includes("schema cache") || message.includes("could not find") || message.includes("does not exist"))
}
const campaignImageUrls = (row: Row) => {
  const raw = row.image_urls
  let urls: string[] = []
  if (Array.isArray(raw)) urls = raw.map(String).filter(Boolean)
  else if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { urls = (JSON.parse(raw) as unknown[]).map(String).filter(Boolean) } catch { urls = [] }
  }
  const legacy = String(row.image_url || "")
  return [...urls, ...(legacy && !urls.includes(legacy) ? [legacy] : [])].filter(Boolean).slice(0, 4)
}
const isCampaignImageGalleryMissingError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message.toLowerCase() : ""
  return message.includes("image_urls") && (message.includes("schema cache") || message.includes("could not find") || message.includes("does not exist"))
}

export function ConnectedAdminDashboard({ onLogin }: { onLogin?: () => void }) {
  const [profiles, setProfiles] = useState<Row[]>([])
  const [newsCatalogChecked, setNewsCatalogChecked] = useState(false)
  const { session, profile, signOut } = useAuth(); const [tab, setTab] = useState("campaigns"); const [campaigns, setCampaigns] = useState<Row[]>([]); const [homepageMetrics, setHomepageMetrics] = useState<Row[]>([]); const [posts, setPosts] = useState<Row[]>([]); const [reports, setReports] = useState<Row[]>([]); const [messages, setMessages] = useState<Row[]>([]); const [registrations, setRegistrations] = useState<Row[]>([]); const [volunteers, setVolunteers] = useState<Row[]>([]); const [greenRewards, setGreenRewards] = useState<Row[]>([]); const [redemptions, setRedemptions] = useState<Row[]>([]); const [form, setForm] = useState<Form>(empty); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [rewardSchemaReady, setRewardSchemaReady] = useState<boolean | null>(null); const [uploading, setUploading] = useState(false)
  const load = useCallback(async () => { if (!session) return; const results = await Promise.allSettled([tableSelect<Row>("campaigns", "*", session.access_token, "&order=start_at.desc"), tableSelect<Row>("pollution_reports", "*", session.access_token, "&order=created_at.desc"), tableSelect<Row>("contact_messages", "*", session.access_token, "&order=created_at.desc"), tableSelect<Row>("campaign_registrations", "*,campaigns(title)", session.access_token, "&order=created_at.desc")]); const [c, r, m, v] = results.map(x => x.status === "fulfilled" ? x.value : []) as Row[][]; setCampaigns(c); setReports(r); setMessages(m); setRegistrations(v); const failed = results.find(x => x.status === "rejected"); if (failed) setError("Một số dữ liệu dashboard chưa tải được.") }, [session])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!session) return
    const refresh = () => { void load() }
    const timer = window.setInterval(refresh, 10000)
    window.addEventListener("focus", refresh)
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh) }
  }, [session, load])
  useEffect(() => { if (!session) return; void tableSelect<Row>("homepage_metrics", "*", session.access_token, "&order=metric_key.asc").then(setHomepageMetrics).catch(() => undefined) }, [session])
  useEffect(() => {
    if (!session) return
    void Promise.allSettled([
      tableSelect<Row>("green_rewards", "*", session.access_token, "&order=sort_order.asc"),
      tableSelect<Row>("green_redemptions", "*", session.access_token, "&order=created_at.desc"),
    ]).then(([rewardsResult, redemptionsResult]) => {
      if (rewardsResult.status === "fulfilled") setGreenRewards(rewardsResult.value)
      else setError(rewardsResult.reason instanceof Error ? rewardsResult.reason.message : "Không tải được danh mục quà xanh.")
      if (redemptionsResult.status === "fulfilled") setRedemptions(redemptionsResult.value)
    })
  }, [session])
  useEffect(() => { if (!session) return; void tableSelect<Row>("campaign_registrations", "*,profiles(full_name,email,phone),campaigns(title)", session.access_token, "&order=created_at.desc").then(items => setRegistrations(items.map(r => { const p = (r.profiles || {}) as Record<string, unknown>; return { ...r, name: p.full_name || r.name || '', email: p.email || r.email || '', phone: p.phone || r.phone || '' } }))).catch(() => undefined) }, [session])
  useEffect(() => { if (!session) return; void tableSelect<Row>("profiles", "*", session.access_token, "&order=created_at.desc").then(setProfiles).catch(() => tableSelect<Row>("profiles", "id,full_name,email,phone,role,last_login_at,created_at", session.access_token, "&order=created_at.desc").then(setProfiles).catch(() => undefined)) }, [session])
  useEffect(() => {
    if (!session) return
    let active = true
    void Promise.all([
      tableSelect<Row>("profiles", "points_balance", session.access_token, "&limit=1"),
      tableSelect<Row>("campaigns", "reward_points", session.access_token, "&limit=1"),
      tableSelect<Row>("campaign_registrations", "awarded_points", session.access_token, "&limit=1"),
    ]).then(() => { if (active) setRewardSchemaReady(true) }).catch(cause => {
      if (active && isRewardSchemaMissingError(cause)) setRewardSchemaReady(false)
    })
    return () => { active = false }
  }, [session])
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
  const set = (key: keyof Form, value: string | string[]) => setForm(x => ({ ...x, [key]: value }))
  async function image(e: ChangeEvent<HTMLInputElement>, index: number) { const file = e.target.files?.[0]; if (!file || !session || index < 0 || index > 3) return; setUploading(true); try { const url = await uploadPublicFile(file, session.access_token); const urls = [...form.image_urls]; urls[index] = url; set("image_urls", urls.slice(0, 4)); set("image_url", urls[0] || "") } catch (x) { setError(x instanceof Error ? x.message : "Không tải được ảnh") } finally { setUploading(false); e.target.value = "" } }
  async function save(e: FormEvent) { e.preventDefault(); if (!session) return; setError(""); setNotice(""); const payload = { ...form, start_at: new Date(form.start_at).toISOString(), end_at: form.end_at ? new Date(form.end_at).toISOString() : null, capacity: form.capacity ? Number(form.capacity) : null, registered_count: Math.max(0, Math.round(Number(form.registered_count) || 0)), reward_points: clampCampaignPoints(Number(form.reward_points)) }; try { if (editing) await tableUpdate("campaigns", `id=eq.${editing}`, payload, session.access_token); else await tableInsert("campaigns", payload, session.access_token); setForm(empty); setEditing(null); await load() } catch (x) { if (isCampaignImageGalleryMissingError(x)) { const { image_urls: _imageUrls, ...legacyPayload } = payload; try { if (editing) await tableUpdate("campaigns", `id=eq.${editing}`, legacyPayload, session.access_token); else await tableInsert("campaigns", legacyPayload, session.access_token); setNotice("Đã lưu chiến dịch. Hệ thống đang dùng ảnh đại diện cũ; hãy cập nhật cột image_urls để dùng đủ 4 ảnh."); setForm(empty); setEditing(null); await load(); return } catch (fallback) { setError(fallback instanceof Error ? fallback.message : "Không lưu được chiến dịch"); return } } if (!isRewardSchemaMissingError(x)) { setError(x instanceof Error ? x.message : "Không lưu được chiến dịch"); return } const { reward_points: _rewardPoints, ...legacyPayload } = payload; if (editing) await tableUpdate("campaigns", `id=eq.${editing}`, legacyPayload, session.access_token); else await tableInsert("campaigns", legacyPayload, session.access_token); setRewardSchemaReady(false); setNotice("Đã lưu chiến dịch. Điểm thưởng sẽ hoạt động sau khi cơ sở dữ liệu được cập nhật."); setForm(empty); setEditing(null); await load() } }
  async function remove(id: string) { if (!session || !confirm("Xóa chiến dịch này? Các lượt đăng ký thuộc chiến dịch cũng sẽ được gỡ khỏi danh sách.")) return; try { await tableDelete("campaign_registrations", `or=(campaign_id.eq.${id},campaign_key.eq.${id})`, session.access_token) } catch { /* campaign_id rows still cascade; legacy orphan rows are filtered from the UI */ } await tableDelete("campaigns", `id=eq.${id}`, session.access_token); await load() }
  async function toggleCampaignStatus(row: Row) { if (!session) return; const nextStatus = String(row.status || "upcoming") === "completed" ? "upcoming" : "completed"; try { await tableUpdate("campaigns", `id=eq.${row.id}`, { status: nextStatus }, session.access_token); setCampaigns(items => items.map(item => item.id === row.id ? { ...item, status: nextStatus } : item)); setNotice(nextStatus === "completed" ? "Đã chuyển chiến dịch sang trạng thái Đã kết thúc." : "Đã mở lại trạng thái Đang nhận đăng ký.") } catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được trạng thái chiến dịch") } }
  async function saveParticipation(id: string, status: string, attendedHours: number, trashKg: number, awardedPoints: number) { if (!session) return; setError(""); setNotice(""); const registration = registrations.find(item => item.id === id); const normalizedPoints = status === "attended" ? clampCampaignPoints(awardedPoints) : 0; const previousPoints = registration?.status === "attended" ? Number(registration.awarded_points || 0) : 0; const legacyValues = { status, attended_hours: status === "attended" ? attendedHours : 0, trash_kg: status === "attended" ? trashKg : 0 }; const values = { ...legacyValues, awarded_points: normalizedPoints, attended_at: status === "attended" ? (registration?.attended_at || new Date().toISOString()) : null }; try { await tableUpdate("campaign_registrations", `id=eq.${id}`, values, session.access_token); const userId = String(registration?.user_id || ""); setProfiles(items => items.map(item => item.id === userId ? { ...item, points_balance: updateCumulativePoints(Number(item.points_balance || 0), previousPoints, normalizedPoints) } : item)); setRegistrations(items => items.map(item => item.id === id ? { ...item, ...values } : item)); setNotice(status === "attended" ? "Đã lưu. Điểm của chiến dịch này đã được cộng vào tổng điểm tích lũy của tài khoản." : "Đã lưu. Điểm của chiến dịch này đã được trừ khỏi tổng điểm tích lũy của tài khoản.") } catch (cause) { if (!isRewardSchemaMissingError(cause)) { setError(cause instanceof Error ? cause.message : "Không cập nhật được kết quả tham gia"); return } try { await tableUpdate("campaign_registrations", `id=eq.${id}`, legacyValues, session.access_token); setRegistrations(items => items.map(item => item.id === id ? { ...item, ...legacyValues } : item)); setRewardSchemaReady(false); setNotice("Đã lưu trạng thái và giờ tham gia. Điểm chưa được cộng vì cơ sở dữ liệu chưa cập nhật hệ thống điểm.") } catch (fallbackCause) { setError(fallbackCause instanceof Error ? fallbackCause.message : "Không cập nhật được kết quả tham gia") } } }
  async function saveAccountPoints(id: string, points: number) { if (!session) return; setError(""); setNotice(""); const pointsBalance = Math.max(0, Math.round(points)); try { await tableUpdate("profiles", `id=eq.${id}`, { points_balance: pointsBalance }, session.access_token); setProfiles(items => items.map(item => item.id === id ? { ...item, points_balance: pointsBalance } : item)) } catch (cause) { if (isRewardSchemaMissingError(cause)) { setRewardSchemaReady(false); setNotice("Chưa thể cập nhật điểm vì cơ sở dữ liệu chưa được nâng cấp cho hệ thống điểm."); return } setError(cause instanceof Error ? cause.message : "Không cập nhật được điểm tài khoản") } }
  function edit(r: Row) { const imageUrls = campaignImageUrls(r); setEditing(r.id); setForm({ title: val(r, "title"), location: val(r, "location"), start_at: localDate(val(r, "start_at")), end_at: localDate(val(r, "end_at")), capacity: val(r, "capacity"), registered_count: String(campaignRegistrationCount(r, registrations)), reward_points: val(r, "reward_points") || "10000", status: val(r, "status") || "upcoming", description: val(r, "description"), pollution_status: val(r, "pollution_status"), action_plan: val(r, "action_plan"), support_equipment: val(r, "support_equipment"), image_url: imageUrls[0] || "", image_urls: imageUrls }) }
  if (tab === "admin-account") return <AccountViewPage profile={profile} onTab={setTab} profiles={profiles} registrations={registrations} campaigns={campaigns} onPointsSave={saveAccountPoints} view="admins" title="Tài khoản admin" kicker="NỘI DUNG CLB" active="admin-account" />
  if (tab === "accounts") return <AccountViewPage profile={profile} onTab={setTab} profiles={profiles} registrations={registrations} campaigns={campaigns} onPointsSave={saveAccountPoints} view="guests" title="Tài khoản người dùng" kicker="NỘI DUNG NGƯỜI DÙNG" active="accounts" />
  if (tab === "team") return <TeamAdminPage profile={profile} session={session} rows={homepageMetrics} onSaved={setHomepageMetrics} onTab={setTab} />
  const pageTitle = tab === "admin-account" ? "Tài khoản admin" : tab === "accounts" ? "Tài khoản người dùng" : tab === "rewards" ? "Điểm & huy hiệu" : tab === "volunteers" ? "Đăng ký làm tình nguyện viên" : tab === "registrations" ? "Đăng ký theo chiến dịch" : tab === "campaigns" ? "Quản lý chiến dịch" : tab === "homepage" ? "Tác động" : tab === "founders" ? "Cổ đông sáng lập" : tab === "team" ? "Đội ngũ" : tab === "messages" ? "Lời nhắn" : tab === "reports" ? "Báo cáo ô nhiễm" : tab === "posts" ? "Tin tức" : "Quản lý chiến dịch"
  const menuGroups = ADMIN_MENU_GROUPS
  if (tab === "green-rewards" || tab === "redemptions") return <main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><img src="/source/home/logo.jpg" alt="Hà Nội Xanh"/><div><strong>HÀ NỘI XANH</strong><small>ADMIN CONSOLE</small></div></div><nav>{menuGroups.map(group => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>)}</nav><div className="admin-sidebar-actions"><a className="admin-home-link" href="/">← Về trang chính</a></div></aside><section className="admin-content"><header className="admin-topbar"><div><p className="admin-kicker">BẢNG ĐIỀU KHIỂN</p><h1>{tab === "green-rewards" ? "Quản lý quà xanh" : "Danh sách đổi quà"}</h1></div><div className="admin-user"><span>{profile.full_name || profile.email}</span><small>ADMIN</small></div></header>{notice && <div className="admin-notice">{notice}</div>}{error && <div className="admin-error">{error}</div>}{tab === "green-rewards" ? <GreenRewardsEditor rows={greenRewards} session={session} onSaved={setGreenRewards} onStatus={(message, failed = false) => { if (failed) { setError(message); setNotice("") } else { setNotice(message); setError("") } }} /> : <GreenRedemptionsManager rows={redemptions} session={session} onSaved={setRedemptions} />}</section></main>
  if (tab === "founders") return <main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><img src="/source/home/logo.jpg" alt="Hà Nội Xanh"/><div><strong>HÀ NỘI XANH</strong><small>ADMIN CONSOLE</small></div></div><nav>{menuGroups.map(group => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>)}</nav><div className="admin-sidebar-actions"><a className="admin-home-link" href="/">← Về trang chính</a></div></aside><section className="admin-content"><header className="admin-topbar"><div><p className="admin-kicker">BẢNG ĐIỀU KHIỂN</p><h1>Cổ đông sáng lập</h1></div><div className="admin-user"><span>{profile.full_name || profile.email}</span><small>ADMIN</small></div></header>{notice && <div className="admin-notice">{notice}</div>}{error && <div className="admin-error">{error}</div>}<FoundingShareholdersEditor rows={homepageMetrics} session={session} onSaved={setHomepageMetrics} /></section></main>
  return <main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><img src="/source/home/logo.jpg" alt="Hà Nội Xanh"/><div><strong>HÀ NỘI XANH</strong><small>ADMIN CONSOLE</small></div></div><nav>{menuGroups.map(group => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>)}</nav><div className="admin-sidebar-actions"><a className="admin-home-link" href="/">← Về trang chính</a></div></aside><section className="admin-content"><header className="admin-topbar"><div><p className="admin-kicker">BẢNG ĐIỀU KHIỂN</p><h1>{pageTitle}</h1></div><div className="admin-user"><span>{profile.full_name || profile.email}</span><small>ADMIN</small></div></header>{rewardSchemaReady === false && <div className="admin-warning"><strong>Hệ thống điểm chưa được kích hoạt trên cơ sở dữ liệu.</strong><span>Trạng thái và giờ tham gia vẫn lưu được; điểm tích lũy và bảng xếp hạng chỉ hoạt động sau khi cập nhật cơ sở dữ liệu.</span></div>}{notice && <div className="admin-notice">{notice}</div>}{error && <div className="admin-error">{error}</div>}{tab === "accounts" && <AccountManager profiles={profiles} registrations={registrations} campaigns={campaigns} onPointsSave={saveAccountPoints} />}{tab === "rewards" && <RewardsManager rows={homepageMetrics} session={session} onSaved={setHomepageMetrics} />}{tab === "volunteers" && <Simple title={`Đăng ký làm tình nguyện viên (${volunteers.length})`} rows={volunteers} cols={[["name", "Họ tên"], ["phone", "Số điện thoại"], ["email", "Email"], ["address", "Địa chỉ"], ["created_at", "Ngày đăng ký"]]} />}{tab === "homepage" && <ImpactContentEditor rows={homepageMetrics} session={session} onSaved={setHomepageMetrics} />}{tab === "campaigns" && <CampaignForm form={form} set={set} onImage={image} uploading={uploading} editing={!!editing} onSave={save} onCancel={() => { setEditing(null); setForm(empty) }} rows={campaigns} registrations={registrations} onEdit={edit} onDelete={remove} onStatus={toggleCampaignStatus} />}{tab === "messages" && <Simple title={`Lời nhắn (${messages.length})`} rows={messages} cols={[["name", "Người gửi"], ["email", "Email"], ["message", "Nội dung"], ["created_at", "Ngày gửi"]]} />}{tab === "reports" && <Simple title={`Báo cáo (${reports.length})`} rows={reports} cols={[["user_id", "Tài khoản"], ["location_name", "Địa điểm"], ["description", "Mô tả"], ["status", "Trạng thái"]]} />}{tab === "registrations" && <RegistrationManager rows={registrations} profiles={profiles} campaigns={campaigns} onSave={saveParticipation} />}</section></main>
}
type TeamMember = { group: "leadership" | "advisors" | "heads"; tag: string; name: string; role: string; description: string; image_url: string }
const defaultTeamMembers: TeamMember[] = [
  { group: "leadership", tag: "Ban chủ nhiệm", name: "Nguyễn Tiến Huy", role: "Người sáng lập · Chủ nhiệm CLB Hà Nội Xanh", description: "Nguyễn Tiến Huy là người sáng lập Hà Nội Xanh. Anh tham gia định hướng hoạt động, kết nối nguồn lực và phối hợp tổ chức các chương trình vì môi trường.", image_url: "/anh-hnx/huy.webp" },
  { group: "leadership", tag: "Ban chủ nhiệm", name: "Nguyễn Doãn Nam Linh", role: "Phó Chủ nhiệm CLB Hà Nội Xanh", description: "Đồng hành trong công tác tổ chức và điều phối hoạt động; hỗ trợ phối hợp giữa các bộ phận và tổng hợp công việc nội bộ.", image_url: "" },
  { group: "advisors", tag: "Ban cố vấn", name: "Đặng Đình Mạnh", role: "Cố vấn Hà Nội Xanh", description: "Đồng hành cùng Hà Nội Xanh trong các hoạt động vì cộng đồng, đóng góp kinh nghiệm và sự kết nối.", image_url: "" },
  { group: "advisors", tag: "Ban cố vấn", name: "Chung Đức Khanh", role: "Cố vấn Hà Nội Xanh · CEO WINDE MEDIA", description: "Đóng góp kinh nghiệm và kết nối nguồn lực cho các hoạt động vì cộng đồng.", image_url: "" },
  { group: "advisors", tag: "Ban cố vấn", name: "Nguyễn Văn Đạt", role: "Cố vấn chiến lược Hà Nội Xanh", description: "Đồng hành với vai trò Cố vấn chiến lược Hà Nội Xanh.", image_url: "" },
  { group: "heads", tag: "Trưởng ban", name: "Doanh", role: "Trưởng ban Truyền thông", description: "Phụ trách công tác truyền thông, tổ chức sản xuất nội dung và phối hợp ghi lại câu chuyện tại hiện trường.", image_url: "" },
  { group: "heads", tag: "Trưởng ban", name: "Xuyên", role: "Trưởng ban Nhân sự", description: "Chuẩn bị và phối hợp lực lượng, tiếp nhận, điều phối và ghi nhận người tham gia.", image_url: "" },
  { group: "heads", tag: "Trưởng ban", name: "Duy", role: "Trưởng ban Hậu cần", description: "Chuẩn bị, bảo quản và sắp xếp trang thiết bị, đồ dùng, dụng cụ phục vụ hoạt động.", image_url: "" },
  { group: "heads", tag: "Trưởng ban", name: "Trần Văn Tín", role: "Trưởng ban Cơ động", description: "Hỗ trợ và hướng dẫn thành viên tại hoạt động, khảo sát địa điểm và phối hợp tổ chức hiện trường.", image_url: "" },
]
function normalizeTeam(value: unknown) { return Array.isArray(value) && value.length ? value as TeamMember[] : defaultTeamMembers }
function TeamEditor({ rows, session, onSaved }: { rows: Row[]; session: { access_token: string } | null; onSaved: (rows: Row[]) => void }) {
  const existing = rows.find(row => row.metric_key === "team_members")
  const [items, setItems] = useState<TeamMember[]>(() => normalizeTeam(existing?.metric_value))
  const [saving, setSaving] = useState(false)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  useEffect(() => setItems(normalizeTeam(rows.find(row => row.metric_key === "team_members")?.metric_value)), [rows])
  const update = (index: number, key: keyof TeamMember, value: string) => setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  const upload = async (index: number, event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file || !session) return; setUploadingIndex(index); try { update(index, "image_url", await uploadPublicFile(file, session.access_token)) } finally { setUploadingIndex(null) } }
  const save = async () => { if (!session) return; setSaving(true); try { const payload = { metric_value: items, updated_at: new Date().toISOString() }; const next = existing ? (await tableUpdate<Row>("homepage_metrics", `id=eq.${existing.id}`, payload, session.access_token))[0] : (await tableInsert<Row>("homepage_metrics", { metric_key: "team_members", ...payload }, session.access_token))[0]; onSaved(existing ? rows.map(row => row.id === existing.id ? next : row) : [...rows, next]) } finally { setSaving(false) } }
  return <div className="admin-page"><section className="admin-panel"><h2>Quản lý đội ngũ</h2><p>Chỉnh sửa tên, vai trò, mô tả và ảnh của toàn bộ nhân sự hiển thị trên trang Đội ngũ. Lưu xong dữ liệu sẽ tự động cập nhật lên trang công khai.</p></section>{items.map((item, index) => <section className="admin-panel" key={`${item.group}-${index}`}><h2>{item.tag} · {index + 1}</h2><div className="form-grid"><Field label="Tên nhân sự" value={item.name} required set={value => update(index, "name", value)} /><Field label="Vai trò" value={item.role} required set={value => update(index, "role", value)} /></div><label className="wide-field">Ảnh đại diện<input type="file" accept="image/*" onChange={event => void upload(index, event)} />{uploadingIndex === index && <small>Đang tải ảnh…</small>}{item.image_url && <img src={item.image_url} alt={`Ảnh ${item.name}`} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 16, display: "block", marginTop: 10 }} />}</label><Text label="Thông tin hiển thị" value={item.description} required set={value => update(index, "description", value)} /></section>)}<button className="admin-primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "ĐANG LƯU…" : "LƯU THÔNG TIN ĐỘI NGŨ"}</button></div>
}
function AccountViewPage({ profile, onTab, profiles, registrations, campaigns, onPointsSave, view, title, kicker, active }: { profile: { full_name?: string; email?: string }; onTab: (tab: string) => void; profiles: Row[]; registrations: Row[]; campaigns: Row[]; onPointsSave: (id: string, points: number) => Promise<void>; view: "admins" | "guests"; title: string; kicker: string; active: string }) {
  return <main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><img src="/source/home/logo.jpg" alt="Hà Nội Xanh"/><div><strong>HÀ NỘI XANH</strong><small>ADMIN CONSOLE</small></div></div><nav>{ADMIN_MENU_GROUPS.map(group => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([key, label]) => <button key={key} className={key === active ? "active" : ""} onClick={() => onTab(key)}>{label}</button>)}</div>)}</nav><div className="admin-sidebar-actions"><a className="admin-home-link" href="/">← Về trang chính</a></div></aside><section className="admin-content"><header className="admin-topbar"><div><p className="admin-kicker">{kicker}</p><h1>{title}</h1></div><div className="admin-user"><span>{profile.full_name || profile.email}</span><small>ADMIN</small></div></header><AccountManager profiles={profiles} registrations={registrations} campaigns={campaigns} onPointsSave={onPointsSave} view={view} /></section></main>
}

function TeamAdminPage({ profile, session, rows, onSaved, onTab }: { profile: { full_name?: string; email?: string }; session: { access_token: string } | null; rows: Row[]; onSaved: (rows: Row[]) => void; onTab: (tab: string) => void }) {
  return <main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><img src="/source/home/logo.jpg" alt="Hà Nội Xanh"/><div><strong>HÀ NỘI XANH</strong><small>ADMIN CONSOLE</small></div></div><nav>{ADMIN_MENU_GROUPS.map(group => <div className="admin-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([key, label]) => <button key={key} className={key === "team" ? "active" : ""} onClick={() => onTab(key)}>{label}</button>)}</div>)}</nav><div className="admin-sidebar-actions"><a className="admin-home-link" href="/">← Về trang chính</a></div></aside><section className="admin-content"><header className="admin-topbar"><div><p className="admin-kicker">BẢNG ĐIỀU KHIỂN</p><h1>Đội ngũ</h1></div><div className="admin-user"><span>{profile.full_name || profile.email}</span><small>ADMIN</small></div></header><TeamEditor rows={rows} session={session} onSaved={onSaved} /></section></main>
}
type Founder = { name: string; role: string; image_url: string; expertise: string; contribution: string }
const defaultFounders: Founder[] = [
  { name: "Nguyễn Tiến Huy", role: "Người sáng lập Hà Nội Xanh · Giám đốc Doanh nghiệp xã hội", image_url: "/anh-hnx/huy.webp", expertise: "Nguyễn Tiến Huy khởi xướng Hà Nội Xanh từ tháng 12/2022, trực tiếp tổ chức các hoạt động làm sạch sông, kênh mương và kết nối lực lượng tình nguyện. Anh có kinh nghiệm điều phối hiện trường, phối hợp địa phương, kết nối nguồn lực và truyền thông từ công việc thực tế.", contribution: "Anh định hướng doanh nghiệp phát triển các dự án môi trường có mục tiêu rõ ràng, có đầu mối theo dõi và có cách ghi nhận kết quả cụ thể. Cam kết của anh là kết nối cộng đồng, đối tác và nguồn lực để duy trì những địa điểm đã được làm sạch lâu dài hơn." },
  { name: "", role: "", image_url: "", expertise: "", contribution: "" },
  { name: "", role: "", image_url: "", expertise: "", contribution: "" },
]
function normalizeFounders(value: unknown): Founder[] {
  if (!Array.isArray(value)) return defaultFounders
  return defaultFounders.map((fallback, index) => ({ ...fallback, ...((value[index] || {}) as Partial<Founder>) }))
}
function FoundingShareholdersEditor({ rows, session, onSaved }: { rows: Row[]; session: { access_token: string } | null; onSaved: (rows: Row[]) => void }) {
  const existing = rows.find(row => row.metric_key === "founding_shareholders")
  const [founders, setFounders] = useState<Founder[]>(() => normalizeFounders(existing?.metric_value))
  const [saving, setSaving] = useState(false)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  useEffect(() => setFounders(normalizeFounders(rows.find(row => row.metric_key === "founding_shareholders")?.metric_value)), [rows])
  const update = (index: number, key: keyof Founder, value: string) => setFounders(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  const upload = async (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !session) return
    setUploadingIndex(index)
    try { update(index, "image_url", await uploadPublicFile(file, session.access_token)) } catch { /* dashboard displays the existing upload error area */ } finally { setUploadingIndex(null) }
  }
  const save = async () => {
    if (!session) return
    setSaving(true)
    try {
      const payload = { metric_value: founders, updated_at: new Date().toISOString() }
      const next = existing ? (await tableUpdate<Row>("homepage_metrics", `id=eq.${existing.id}`, payload, session.access_token))[0] : (await tableInsert<Row>("homepage_metrics", { metric_key: "founding_shareholders", ...payload }, session.access_token))[0]
      onSaved(existing ? rows.map(row => row.id === existing.id ? next : row) : [...rows, next])
    } finally { setSaving(false) }
  }
  return <div className="admin-page"><section className="admin-panel"><h2>Ba hồ sơ cổ đông sáng lập</h2><p>Nhập thông tin cho Nguyễn Tiến Huy và hai cổ đông còn lại. Ảnh sẽ được tải lên kho media và hiển thị trên trang Doanh nghiệp xã hội sau khi lưu.</p></section><div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>{founders.map((founder, index) => <section className="admin-panel" key={index}><h2>Cổ đông {String(index + 1).padStart(2, "0")}</h2><label>Ảnh đại diện<input type="file" accept="image/*" onChange={event => void upload(index, event)} />{uploadingIndex === index && <small>Đang tải ảnh…</small>}{founder.image_url && <img src={founder.image_url} alt="Xem trước cổ đông" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 16, display: "block", marginTop: 10 }} />}</label><Field label="Họ và tên" value={founder.name} set={value => update(index, "name", value)} /><Text label="Vai trò tại Hà Nội Xanh" value={founder.role} set={value => update(index, "role", value)} /><Text label="Chuyên môn, kinh nghiệm nổi bật" value={founder.expertise} set={value => update(index, "expertise", value)} /><Text label="Đóng góp và định hướng đồng hành" value={founder.contribution} set={value => update(index, "contribution", value)} /></section>)}</div><button className="admin-primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "ĐANG LƯU…" : "LƯU CỔ ĐÔNG SÁNG LẬP"}</button></div>
}
type GreenReward = Row & { name: string; points_cost: number; description: string; image_url: string; active: boolean; sort_order: number }
function GreenRewardsEditor({ rows, session, onSaved, onStatus }: { rows: Row[]; session: { access_token: string } | null; onSaved: (rows: Row[]) => void; onStatus: (message: string, failed?: boolean) => void }) {
  const [items, setItems] = useState<GreenReward[]>(() => rows as GreenReward[])
  const [saving, setSaving] = useState(false)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  useEffect(() => setItems(rows as GreenReward[]), [rows])
  const update = (index: number, key: keyof GreenReward, value: string | boolean) => setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: key === "points_cost" || key === "sort_order" ? Number(value) : value } : item))
  const add = () => setItems(current => [...current, { id: `draft-${Date.now()}`, name: "", points_cost: 0, description: "", image_url: "", active: true, sort_order: current.length + 1 } as GreenReward])
  const uploadImage = async (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !session) return
    setUploadingIndex(index)
    try { update(index, "image_url", await uploadPublicFile(file, session.access_token)); onStatus("Ảnh phần quà đã tải lên. Bấm lưu danh mục quà để áp dụng.") }
    catch (cause) { onStatus(cause instanceof Error ? cause.message : "Không tải được ảnh phần quà.", true) }
    finally { setUploadingIndex(null) }
  }
  const remove = async (item: GreenReward) => {
    if (item.id.startsWith("draft-")) { setItems(current => current.filter(candidate => candidate.id !== item.id)); return }
    if (!session || !window.confirm(`Xóa phần quà “${item.name}”?`)) return
    setSaving(true)
    try {
      await tableDelete("green_rewards", `id=eq.${item.id}`, session.access_token)
      const next = await tableSelect<Row>("green_rewards", "*", session.access_token, "&order=sort_order.asc")
      onSaved(next)
      onStatus(`Đã xóa phần quà “${item.name}”.`)
    } catch (cause) {
      onStatus(cause instanceof Error ? `Không thể xóa phần quà. Nếu phần quà đã có lượt đổi, hãy tắt “Đang mở bán” để giữ lịch sử. (${cause.message})` : "Không thể xóa phần quà. Hãy tắt “Đang mở bán” nếu quà đã có lượt đổi.", true)
    } finally { setSaving(false) }
  }
  const save = async () => {
    if (!session) return
    setSaving(true)
    try {
      const invalid = items.find(item => !item.name.trim() || Number(item.points_cost) <= 0)
      if (invalid) throw new Error("Vui lòng nhập tên quà và số điểm đổi lớn hơn 0 cho tất cả phần quà.")
      for (const item of items) {
        const payload = { name: item.name.trim(), points_cost: Number(item.points_cost), description: item.description || "", image_url: item.image_url || "", active: Boolean(item.active), sort_order: Number(item.sort_order || 0), updated_at: new Date().toISOString() }
        if (item.id.startsWith("draft-")) await tableInsert<Row>("green_rewards", payload, session.access_token)
        else await tableUpdate<Row>("green_rewards", `id=eq.${item.id}`, payload, session.access_token)
      }
      const next = await tableSelect<Row>("green_rewards", "*", session.access_token, "&order=sort_order.asc")
      onSaved(next)
      onStatus(`Đã lưu danh mục quà (${next.length} phần quà).`)
    } catch (cause) {
      onStatus(isRewardImageColumnMissingError(cause)
        ? "Ảnh đã tải lên nhưng Supabase chưa có cột image_url. Hãy chạy migration 20261021010000_green_reward_images.sql một lần, rồi bấm LƯU DANH MỤC QUÀ lại."
        : cause instanceof Error ? cause.message : "Không lưu được danh mục quà.", true)
    } finally { setSaving(false) }
  }
  return <div className="admin-page"><section className="admin-panel"><h2>Danh mục quà xanh</h2><p>Mỗi phần quà có một mức điểm đổi cố định. Bạn có thể cập nhật tên quà, số điểm đổi, ảnh và mô tả tại đây. Quà đã phát sinh lượt đổi nên được tắt mở bán thay vì xóa để giữ lịch sử.</p></section>{items.map((item, index) => <section className="admin-panel" key={item.id}><div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}><h2>Phần quà {index + 1}</h2><div style={{ display: "flex", alignItems: "center", gap: 16 }}><label style={{ display: "flex", alignItems: "center", gap: 8 }}>Đang mở bán<input type="checkbox" checked={Boolean(item.active)} onChange={event => update(index, "active", event.target.checked)} /></label><button type="button" className="link-danger" onClick={() => void remove(item)} disabled={saving}>Xóa</button></div></div><div className="form-grid"><Field label="Tên quà" value={String(item.name || "")} required set={value => update(index, "name", value)} /><Field label="Số điểm đổi" type="number" min={1} value={String(item.points_cost || "")} required set={value => update(index, "points_cost", value)} /><Field label="Thứ tự" type="number" min={0} value={String(item.sort_order || index + 1)} set={value => update(index, "sort_order", value)} /></div><label className="wide-field">Ảnh minh họa<input type="file" accept="image/*" onChange={event => void uploadImage(index, event)} />{uploadingIndex === index && <small>Đang tải ảnh…</small>}{item.image_url && <img src={item.image_url} alt={`Ảnh ${item.name || "phần quà"}`} style={{ width: 140, height: 110, objectFit: "contain", display: "block", marginTop: 10, padding: 8, border: "1px solid #dbe8df", borderRadius: 12, background: "#f5fbf6" }} />}</label><Text label="Mô tả phần quà" value={String(item.description || "")} set={value => update(index, "description", value)} /></section>)}<div style={{ display: "flex", gap: 12 }}><button type="button" onClick={add}>+ Thêm phần quà</button><button className="admin-primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "ĐANG LƯU…" : "LƯU DANH MỤC QUÀ"}</button></div></div>
}
function GreenRedemptionsManager({ rows, session, onSaved }: { rows: Row[]; session: { access_token: string } | null; onSaved: (rows: Row[]) => void }) {
  const [month, setMonth] = useState("")
  const [year, setYear] = useState("")
  const years = Array.from(new Set(rows.map(row => String(row.created_at || "").slice(0, 4)).filter(Boolean))).sort().reverse()
  const filteredRows = rows.filter(row => {
    const createdAt = String(row.created_at || "")
    return (!month || createdAt.startsWith(month)) && (!year || createdAt.startsWith(year))
  })
  const exportCsv = () => {
    const columns: Array<[string, string]> = [["created_at", "Thời gian"], ["full_name", "Người nhận"], ["reward_name", "Phần quà"], ["points_spent", "Điểm"], ["phone", "Số điện thoại"], ["delivery_address", "Địa chỉ"], ["status", "Trạng thái"]]
    const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`
    const csv = [columns.map(([, label]) => csvCell(label)).join(","), ...filteredRows.map(row => columns.map(([key]) => csvCell(key === "created_at" && row[key] ? new Date(String(row[key])).toLocaleString("vi-VN") : row[key] === "delivered" ? "Đã giao" : row[key] === "pending" ? "Chưa giao" : row[key])).join(","))].join("\r\n")
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `danh-sach-doi-qua-${month || year || "tat-ca"}.csv`; link.click(); URL.revokeObjectURL(url)
  }
  const markDelivered = async (row: Row) => {
    if (!session) return
    const [updated] = await tableUpdate<Row>("green_redemptions", `id=eq.${row.id}`, { status: row.status === "delivered" ? "pending" : "delivered", delivered_at: row.status === "delivered" ? null : new Date().toISOString() }, session.access_token)
    if (updated) onSaved(rows.map(item => item.id === row.id ? updated : item))
  }
  return <div className="admin-page"><section className="admin-panel"><h2>Xuất danh sách đổi quà</h2><p>Lọc theo tháng hoặc năm rồi xuất file CSV để lưu trữ, gửi kế toán hoặc tổng hợp theo từng giai đoạn.</p><div className="form-grid"><label>Tháng<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label><label>Năm<select value={year} onChange={event => setYear(event.target.value)}><option value="">Tất cả các năm</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><button type="button" onClick={() => { setMonth(""); setYear("") }}>Xem tất cả</button><button className="admin-primary" type="button" onClick={exportCsv}>TẢI FILE CSV</button></div></section><List title={`Danh sách đổi quà (${filteredRows.length}/${rows.length})`}><table><thead><tr><th>Thời gian</th><th>Người nhận</th><th>Phần quà</th><th>Điểm</th><th>Liên hệ nhận quà</th><th>Trạng thái</th><th /></tr></thead><tbody>{filteredRows.map(row => <tr key={row.id}><td>{row.created_at ? new Date(String(row.created_at)).toLocaleString("vi-VN") : ""}</td><td>{String(row.full_name || "")}</td><td>{String(row.reward_name || "")}</td><td>{Number(row.points_spent || 0).toLocaleString("vi-VN")}</td><td>{String(row.phone || "")}<br />{String(row.delivery_address || "")}</td><td>{row.status === "delivered" ? "Đã giao" : "Chưa giao"}</td><td><button type="button" onClick={() => void markDelivered(row)}>{row.status === "delivered" ? "Đánh dấu chưa giao" : "Đã giao"}</button></td></tr>)}</tbody></table>{!filteredRows.length && <p className="admin-empty">Chưa có lượt đổi quà trong khoảng thời gian này.</p>}</List></div>
}
function CampaignForm({ form, set, onImage, uploading, editing, onSave, onCancel, rows, registrations, onEdit, onDelete, onStatus }: { form: Form; set: (k: keyof Form, v: string | string[]) => void; onImage: (e: ChangeEvent<HTMLInputElement>, index: number) => void; uploading: boolean; editing: boolean; onSave: (e: FormEvent) => void; onCancel: () => void; rows: Row[]; registrations: Row[]; onEdit: (r: Row) => void; onDelete: (id: string) => void; onStatus: (r: Row) => void }) { return <div className="admin-page"><section className="admin-panel"><div className="admin-panel-heading"><div><h2>{editing ? "Chỉnh sửa chiến dịch" : "Tạo chiến dịch"}</h2><p>Thêm, chỉnh sửa hoặc xóa chiến dịch. Dữ liệu sẽ cập nhật ra trang chiến dịch sau khi lưu.</p></div><button type="button" onClick={onCancel}>+ THÊM CHIẾN DỊCH</button></div><form onSubmit={onSave}><div className="form-grid"><Field label="Tên chiến dịch" value={form.title} required set={v => set("title", v)} /><Field label="Địa điểm" value={form.location} required set={v => set("location", v)} /><Field label="Bắt đầu" type="datetime-local" value={form.start_at} required set={v => set("start_at", v)} /><Field label="Kết thúc" type="datetime-local" value={form.end_at} set={v => set("end_at", v)} /><Field label="Quy mô chiến dịch (số TNV tối đa)" type="number" min={1} value={form.capacity} set={v => set("capacity", v)} /><Field label="Số TNV đã đăng ký" type="number" min={0} value={form.registered_count} set={v => set("registered_count", v)} /><Field label="Điểm thưởng (10.000–15.000)" type="number" min={10000} max={15000} step={500} value={form.reward_points} required set={v => set("reward_points", v)} /><label>Trạng thái<select value={form.status} onChange={e => set("status", e.target.value)}><option value="upcoming">Đang nhận đăng ký</option><option value="completed">Đã kết thúc</option></select></label></div><Text label="Tình trạng ô nhiễm tại điểm ra quân" value={form.pollution_status} set={v => set("pollution_status", v)} /><Text label="Kế hoạch & mục tiêu hành động" value={form.action_plan} set={v => set("action_plan", v)} /><Text label="Trang bị hỗ trợ từ Hà Nội Xanh" value={form.support_equipment} set={v => set("support_equipment", v)} /><Text label="Mô tả ngắn" value={form.description} set={v => set("description", v)} required /><div className="wide-field"><strong>Ảnh chiến dịch (tối đa 4 ảnh)</strong><small>Chọn từng ảnh theo thứ tự 1 → 4. Ảnh số 1 làm ảnh đại diện; các ảnh còn lại hiển thị lần lượt trong popup.</small><div className="campaign-image-slots">{Array.from({ length: 4 }).map((_, index) => <label className="campaign-image-slot" key={index}>Ảnh {index + 1}<input type="file" accept="image/*" onChange={event => onImage(event, index)} />{form.image_urls[index] && <img src={form.image_urls[index]} alt={`Ảnh chiến dịch ${index + 1}`} />}</label>)}</div>{uploading && <small>Đang tải ảnh…</small>}</div><button className="admin-primary">{editing ? "LƯU THAY ĐỔI" : "TẠO CHIẾN DỊCH"}</button>{editing && <button type="button" onClick={onCancel}>Hủy</button>}</form></section><List title="Tất cả chiến dịch"><table><thead><tr><th>Tên</th><th>Thời gian</th><th>Điểm thưởng</th><th>Số TNV đã đăng ký</th><th>Trạng thái</th><th /></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{String(r.title)}</td><td>{new Date(String(r.start_at)).toLocaleString("vi-VN")}</td><td>{Number(r.reward_points || 10000).toLocaleString("vi-VN")}</td><td>{campaignRegistrationCount(r, registrations).toLocaleString("vi-VN")}</td><td>{r.status === "upcoming" ? "Đang nhận đăng ký" : r.status === "completed" ? "Đã kết thúc" : String(r.status)}</td><td><button type="button" onClick={() => onEdit(r)}>Sửa</button> <button type="button" onClick={() => onStatus(r)}>{r.status === "completed" ? "Mở lại nhận đăng ký" : "Đánh dấu đã kết thúc"}</button> <button type="button" className="link-danger" onClick={() => onDelete(r.id)}>Xóa</button></td></tr>)}</tbody></table></List></div> }
function Field({ label, value, set, type = "text", required = false, min, max, step }: { label: string; value: string; set: (v: string) => void; type?: string; required?: boolean; min?: number; max?: number; step?: number }) { return <label>{label}<input type={type} value={value} required={required} min={min} max={max} step={step} onChange={e => set(e.target.value)} /></label> }
function Text({ label, value, set, required = false }: { label: string; value: string; set: (v: string) => void; required?: boolean }) { return <label className="wide-field">{label}<textarea value={value} required={required} onChange={e => set(e.target.value)} /></label> }
function List({ title, children }: { title: string; children: ReactNode }) { return <section className="admin-panel"><h2>{title}</h2><div className="admin-table-wrap">{children}</div></section> }
function Simple({ title, rows, cols }: { title: string; rows: Row[]; cols: string[][] }) {
  const [gallery, setGallery] = useState<{ urls: string[]; index: number } | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const volunteer = title.startsWith("Tình nguyện viên")
  const report = title.startsWith("Báo cáo")
  const actual = volunteer
    ? [["name", "Họ tên"], ["email", "Email"], ["phone", "Số điện thoại"], ["created_at", "Ngày đăng ký"]]
    : report
      ? [["name", "Họ tên"], ["email", "Email"], ["location_name", "Địa điểm"], ["description", "Mô tả"], ["photo_urls", "Ảnh"], ["created_at", "Ngày gửi"]]
      : cols
  const reportImageUrls = (r: Row) => {
    if (Array.isArray(r.photo_urls)) {
      const urls = r.photo_urls.map(String).filter(Boolean)
      if (urls.length) return urls
    }
    if (typeof r.photo_urls === "string") {
      try {
        const parsed = JSON.parse(r.photo_urls)
        if (Array.isArray(parsed)) {
          const urls = parsed.map(String).filter(Boolean)
          if (urls.length) return urls
        }
      } catch { /* legacy value */ }
    }
    return r.photo_url ? [String(r.photo_url)] : []
  }
  const cell = (r: Row, key: string) => key === "photo_urls"
    ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{reportImageUrls(r).map((url, i, urls) => <button type="button" key={i} onClick={() => { setGallery({ urls, index: i }); setZoomed(false) }} style={{ border: 0, padding: 0, background: "transparent", cursor: "zoom-in" }} aria-label={`Xem ảnh ${i + 1}`}><img src={url} alt={`Ảnh báo cáo ${i + 1}`} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, display: "block" }} /></button>)}</div>
    : key === "created_at" ? new Date(String(r[key])).toLocaleString("vi-VN") : String(r[key] ?? "")
  const currentUrl = gallery?.urls[gallery.index]
  return <><List title={title}><table><thead><tr>{actual.map(c => <th key={c[0]}>{c[1]}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id}>{actual.map(c => <td key={c[0]}>{cell(r, c[0])}</td>)}</tr>)}</tbody></table></List>{gallery && currentUrl && <div role="dialog" aria-modal="true" aria-label="Xem ảnh báo cáo" onClick={() => setGallery(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(2, 20, 13, .82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><div onClick={event => event.stopPropagation()} style={{ position: "relative", width: "min(1100px, 96vw)", height: "min(820px, 92vh)", display: "flex", alignItems: "center", justifyContent: "center" }}><button type="button" onClick={() => setGallery(null)} aria-label="Đóng" style={{ position: "absolute", top: 0, right: 0, zIndex: 2, border: 0, borderRadius: 999, width: 42, height: 42, background: "#fff", color: "#123", fontSize: 26, cursor: "pointer" }}>×</button>{gallery.urls.length > 1 && <><button type="button" onClick={() => { setGallery({ ...gallery, index: (gallery.index - 1 + gallery.urls.length) % gallery.urls.length }); setZoomed(false) }} aria-label="Ảnh trước" style={{ position: "absolute", left: 8, zIndex: 2, border: 0, borderRadius: 999, width: 46, height: 46, background: "#fff", fontSize: 26, cursor: "pointer" }}>‹</button><button type="button" onClick={() => { setGallery({ ...gallery, index: (gallery.index + 1) % gallery.urls.length }); setZoomed(false) }} aria-label="Ảnh tiếp theo" style={{ position: "absolute", right: 8, zIndex: 2, border: 0, borderRadius: 999, width: 46, height: 46, background: "#fff", fontSize: 26, cursor: "pointer" }}>›</button></>}<img src={currentUrl} alt={`Ảnh báo cáo ${gallery.index + 1} trên ${gallery.urls.length}`} onClick={() => setZoomed(value => !value)} style={{ maxWidth: "88%", maxHeight: "88%", objectFit: "contain", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.35)", cursor: zoomed ? "zoom-out" : "zoom-in", transform: zoomed ? "scale(1.45)" : "scale(1)", transition: "transform .2s ease" }} /><span style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", color: "#fff", background: "rgba(0,0,0,.55)", borderRadius: 999, padding: "7px 14px", fontSize: 13 }}>{gallery.index + 1}/{gallery.urls.length} · Bấm vào ảnh để phóng to/thu nhỏ</span></div></div>}</>
}

function exportAccountsToCsv(rows: Row[], filename: string) {
  const escapeCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`
  const formatDate = (value: unknown) => value ? new Date(String(value)).toLocaleString("vi-VN") : "Chưa đăng nhập"
  const lines = [
    ["STT", "Họ tên", "Email", "Vai trò", "Lần đăng nhập gần nhất", "Số điện thoại", "Ngày tạo tài khoản", "Điểm"],
    ...rows.map((row, index) => [
      index + 1,
      row.full_name || "Chưa cập nhật",
      row.email || "",
      isAdminProfile(row) ? "Admin" : "Khách",
      formatDate(row.last_login_at),
      row.phone || "Chưa cập nhật",
      formatDate(row.created_at),
      Number(row.points_balance || 0).toLocaleString("vi-VN"),
    ]),
  ].map(row => row.map(escapeCell).join(","))
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename.replace(/\.xls$/i, ".csv")
  link.rel = "noopener"
  link.target = "_self"
  link.style.display = "none"
  document.body.appendChild(link)
  if ("msSaveOrOpenBlob" in navigator && typeof (navigator as Navigator & { msSaveOrOpenBlob?: (value: Blob, name?: string) => void }).msSaveOrOpenBlob === "function") {
    ;(navigator as Navigator & { msSaveOrOpenBlob: (value: Blob, name?: string) => void }).msSaveOrOpenBlob(blob, link.download)
  } else {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }))
  }
  window.setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 10000)
}

function AccountManager({ profiles, registrations, campaigns, onPointsSave, view = "all" }: { profiles: Row[]; registrations: Row[]; campaigns: Row[]; onPointsSave: (id: string, points: number) => Promise<void>; view?: "all" | "admins" | "guests" }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [accountView, setAccountView] = useState<"all" | "admins" | "guests">(view)
  const [month, setMonth] = useState("")
  const [year, setYear] = useState("")
  const uniqueProfiles = Array.from(new Map(profiles.map(row => [String(row.id || row.email).toLowerCase(), row])).values())
  const years = Array.from(new Set(uniqueProfiles.map(row => String(row.created_at || "").slice(0, 4)).filter(Boolean))).sort((a, b) => Number(b) - Number(a))
  const timeFilteredProfiles = uniqueProfiles.filter(row => {
    const createdAt = String(row.created_at || "")
    return (!month || createdAt.startsWith(month)) && (!year || createdAt.startsWith(year))
  })
  // `last_login_at` is optional tracking metadata and is not a reliable way to
  // determine whether an account exists. Keep all profiles, including older
  // accounts created before login tracking was added.
  const adminProfiles = timeFilteredProfiles.filter(isAdminProfile)
  const guestProfiles = timeFilteredProfiles.filter(row => !isAdminProfile(row))
  const displayedProfiles = accountView === "admins" ? adminProfiles : accountView === "guests" ? guestProfiles : timeFilteredProfiles
  const accountFilterPanel = <section className="admin-account-filter"><h3>Xuất danh sách tài khoản</h3><p>Lọc theo tháng hoặc năm rồi xem và xuất file CSV theo từng giai đoạn.</p><div className="form-grid"><label>Tháng<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label><label>Năm<select value={year} onChange={event => setYear(event.target.value)}><option value="">Tất cả các năm</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="admin-account-filter-actions"><button type="button" onClick={() => { setMonth(""); setYear("") }}>Xem tất cả</button><button type="button" className="admin-primary" onClick={() => exportAccountsToCsv(displayedProfiles, `${accountView}-${month || year || "tat-ca"}.csv`)}>TẢI FILE CSV</button></div></section>
  const selected = uniqueProfiles.find(row => row.id === selectedId)
  const validRegistration = (row: Row) => Boolean((row.campaigns as Record<string, unknown> | undefined)?.title || campaigns.some(item => item.id === String(row.campaign_id || row.campaign_key || "")))
  const activeRegistrations = registrations.filter(validRegistration)
  const history = selected ? Array.from(new Map(activeRegistrations.filter(row => String(row.user_id) === selected.id).map(row => [String(row.campaign_id || row.campaign_key || row.id), row])).values()) : []
  const campaignName = (row: Row) => {
    const joined = (row.campaigns || {}) as Record<string, unknown>
    const key = String(row.campaign_id || row.campaign_key || "")
    return String(joined.title || campaigns.find(item => item.id === key)?.title || row.campaign_key || "Chưa xác định chiến dịch")
  }
  return <div className="admin-page">{accountFilterPanel}<List title={`Danh sách tài khoản (${displayedProfiles.length})`}><table><thead><tr><th>STT</th><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Lần đăng nhập gần nhất</th><th>Số điện thoại</th><th>Ngày tạo</th><th>Chiến dịch</th><th>Điểm</th><th /></tr></thead><tbody>{displayedProfiles.map((row, index) => { const count = new Set(activeRegistrations.filter(item => String(item.user_id) === row.id && item.status !== "cancelled").map(item => String(item.campaign_id || item.campaign_key || item.id))).size; return <tr key={row.id}><td>{index + 1}</td><td>{String(row.full_name || "Chưa cập nhật")}</td><td>{String(row.email || "")}</td><td>{isAdminProfile(row) ? "Admin" : "Khách"}</td><td>{row.last_login_at ? new Date(String(row.last_login_at)).toLocaleString("vi-VN") : "Chưa đăng nhập"}</td><td>{String(row.phone || "Chưa cập nhật")}</td><td>{row.created_at ? new Date(String(row.created_at)).toLocaleString("vi-VN") : "—"}</td><td>{count}</td><td>{Number(row.points_balance || 0).toLocaleString("vi-VN")}</td><td><button type="button" onClick={() => setSelectedId(row.id)}>Xem chi tiết</button></td></tr> })}</tbody></table>{!displayedProfiles.length && <p className="admin-empty">Chưa có tài khoản nào.</p>}</List>{selected && <section className="admin-panel"><div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><h2>Chi tiết tài khoản</h2><button type="button" onClick={() => setSelectedId(null)}>Đóng</button></div><div className="form-grid"><p><strong>Họ tên</strong><br />{String(selected.full_name || "Chưa cập nhật")}</p><p><strong>Email</strong><br />{String(selected.email || "")}</p><p><strong>Số điện thoại</strong><br />{String(selected.phone || "Chưa cập nhật")}</p><p><strong>Ngày tạo tài khoản</strong><br />{selected.created_at ? new Date(String(selected.created_at)).toLocaleString("vi-VN") : "—"}</p><p><strong>Ngày sinh</strong><br />{String(selected.birth_date || "Chưa cập nhật")}</p><p><strong>Giới tính</strong><br />{String(selected.gender || "Chưa cập nhật")}</p><p><strong>Địa chỉ</strong><br />{String(selected.address || "Chưa cập nhật")}</p><p><strong>Trường học/Nghề nghiệp</strong><br />{String(selected.occupation || "Chưa cập nhật")}</p></div><AccountPointsEditor key={`${selected.id}-${selected.points_balance}`} row={selected} onSave={onPointsSave} /><h3>Lịch sử đăng ký chiến dịch ({history.length})</h3>{history.length ? <div className="admin-table-wrap"><table><thead><tr><th>Chiến dịch</th><th>Ngày đăng ký</th><th>Trạng thái</th><th>Giờ xác nhận</th><th>Điểm nhận</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{campaignName(row)}</td><td>{row.created_at ? new Date(String(row.created_at)).toLocaleString("vi-VN") : "—"}</td><td>{String(row.status || "registered")}</td><td>{String(row.attended_hours || 0)}</td><td>{Number(row.awarded_points || 0).toLocaleString("vi-VN")}</td></tr>)}</tbody></table></div> : <p className="admin-empty">Tài khoản này chưa đăng ký chiến dịch.</p>}</section>}</div>
}

function AccountPointsEditor({ row, onSave }: { row: Row; onSave: (id: string, points: number) => Promise<void> }) {
  const [points, setPoints] = useState(Number(row.points_balance || 0))
  const [saving, setSaving] = useState(false)
  return <div className="admin-points-editor"><div><strong>Số dư điểm</strong><small>Admin có thể cộng, trừ hoặc nhập lại tổng điểm của tài khoản.</small></div><input aria-label="Số dư điểm" type="number" min="0" step="1000" value={points} onChange={event => setPoints(Number(event.target.value))} /><button type="button" disabled={saving} onClick={() => { setSaving(true); void onSave(row.id, points).finally(() => setSaving(false)) }}>{saving ? "Đang lưu…" : "Cập nhật điểm"}</button></div>
}

function RegistrationManager({ rows, profiles, campaigns, onSave }: { rows: Row[]; profiles: Row[]; campaigns: Row[]; onSave: (id: string, status: string, hours: number, trashKg: number, awardedPoints: number) => Promise<void> }) {
  const campaignName = (row: Row) => { const joined = (row.campaigns || {}) as Record<string, unknown>; const key = String(row.campaign_id || row.campaign_key || ""); return String(joined.title || campaigns.find(item => item.id === key)?.title || row.campaign_key || "Chưa xác định chiến dịch") }
  const groups = new Map<string, Row[]>()
  const profileById = new Map(profiles.map(item => [String(item.id), item]))
  const activeRows = rows.filter(row => Boolean((row.campaigns as Record<string, unknown> | undefined)?.title || campaigns.some(item => item.id === String(row.campaign_id || row.campaign_key || ""))))
  activeRows.forEach(row => { const person = profileById.get(String(row.user_id)); const campaign = campaigns.find(item => item.id === String(row.campaign_id || row.campaign_key || "")); const joined = (row.campaigns || {}) as Record<string, unknown>; const merged = { ...row, ...(person ? { name: person.full_name, email: person.email, phone: person.phone } : {}), campaign_reward_points: joined.reward_points || campaign?.reward_points || 10000 }; const name = campaignName(row); const current = groups.get(name) || []; if (!current.some(item => String(item.user_id) === String(row.user_id))) current.push(merged); groups.set(name, current) })
  return <div className="admin-page">{Array.from(groups.entries()).map(([name, items]) => <List key={name} title={`${name} (${items.length} người đăng ký)`}><table><thead><tr><th>STT</th><th>Tình nguyện viên</th><th>Liên hệ</th><th>Trạng thái</th><th>Giờ xác nhận</th><th>Điểm thưởng</th><th /></tr></thead><tbody>{items.map((row, index) => <RegistrationEditor key={row.id} index={index + 1} row={row} onSave={onSave} />)}</tbody></table></List>)}{!activeRows.length && <List title="Đăng ký chiến dịch"><p className="admin-empty">Chưa có đăng ký chiến dịch.</p></List>}</div>
}

function RegistrationEditor({ row, index, onSave }: { row: Row; index: number; onSave: (id: string, status: string, hours: number, trashKg: number, awardedPoints: number) => Promise<void> }) {
  const [status, setStatus] = useState(String(row.status || "registered"))
  const [hours, setHours] = useState(Number(row.attended_hours || 0))
  const [awardedPoints, setAwardedPoints] = useState(Number(row.awarded_points || row.campaign_reward_points || 10000))
  const [saving, setSaving] = useState(false)
  const attended = status === "attended"
  const save = async () => { setSaving(true); try { await onSave(row.id, status, hours, 0, awardedPoints) } finally { setSaving(false) } }
  return <tr><td>{index}</td><td><strong>{String(row.name || "Chưa cập nhật")}</strong><small>{String(row.phone || "")}</small></td><td>{String(row.email || "")}</td><td><select value={status} onChange={event => setStatus(event.target.value)}><option value="registered">Đã đăng ký</option><option value="attended">Đã tham gia</option><option value="cancelled">Đã hủy/vắng</option></select></td><td><input type="number" min="0" step="0.5" value={hours} disabled={!attended} onChange={event => setHours(Number(event.target.value))} style={{ width: 90 }} /></td><td><input type="number" min="10000" max="15000" step="500" value={awardedPoints} disabled={!attended} onChange={event => setAwardedPoints(Number(event.target.value))} style={{ width: 110 }} /></td><td><button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Đang lưu…" : "Lưu"}</button></td></tr>
}

function RewardsManager({ rows, session, onSaved }: { rows: Row[]; session: { access_token: string } | null; onSaved: (rows: Row[]) => void }) {
  const existing = rows.find(row => row.metric_key === "reward_program")
  const [program, setProgram] = useState(() => normalizeRewardProgram(existing?.metric_value || DEFAULT_REWARD_PROGRAM))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  useEffect(() => { setProgram(normalizeRewardProgram(existing?.metric_value || DEFAULT_REWARD_PROGRAM)) }, [existing?.id, existing?.metric_value])
  const changeBadge = (index: number, values: Partial<BadgeRule>) => setProgram(current => ({ ...current, badges: current.badges.map((badge, badgeIndex) => badgeIndex === index ? { ...badge, ...values } : badge) }))
  const addBadge = () => setProgram(current => ({ ...current, badges: [...current.badges, { id: `huy-hieu-${Date.now()}`, name: "Huy hiệu mới", description: "Mô tả mốc tình nguyện", icon: "fa-award", minCampaigns: 1, minHours: 0, minActiveMonths: 0, minTenureMonths: 0 }] }))
  const save = async () => {
    if (!session) return
    setSaving(true); setNotice("")
    const metricValue = { ...program, campaignMinPoints: 10000, campaignMaxPoints: 15000 }
    try {
      let next: Row
      if (existing) [next] = await tableUpdate<Row>("homepage_metrics", `id=eq.${existing.id}`, { metric_value: metricValue, updated_at: new Date().toISOString() }, session.access_token)
      else [next] = await tableInsert<Row>("homepage_metrics", { metric_key: "reward_program", metric_value: metricValue }, session.access_token)
      onSaved(existing ? rows.map(row => row.id === existing.id ? next : row) : [...rows, next])
      setNotice("Đã lưu hệ thống điểm và các mốc huy hiệu.")
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Không lưu được cấu hình") }
    finally { setSaving(false) }
  }
  return <div className="admin-page"><section className="admin-panel admin-reward-summary"><h2>Thang điểm chiến dịch</h2><p>Mỗi lượt tham gia được xác nhận nhận từ <strong>10.000</strong> đến <strong>15.000 điểm</strong>. Mức cụ thể được đặt trong từng chiến dịch và có thể chỉnh khi xác nhận người tham gia.</p><div className="admin-reward-range"><span>10.000</span><div /><span>15.000 điểm</span></div></section><section className="admin-panel"><div className="admin-panel-heading"><div><h2>Đề xuất mốc huy hiệu</h2><p>Huy hiệu được xét từ hoạt động đã xác nhận. Có thể sửa mốc hoặc tạo thêm huy hiệu.</p></div><button type="button" onClick={addBadge}>+ Thêm huy hiệu</button></div><div className="admin-badge-editor-list">{program.badges.map((badge, index) => <article className="admin-badge-editor" key={badge.id}><div className="admin-badge-editor-title"><span><i className={`fa-solid ${badge.icon || "fa-award"}`} /></span><strong>{index + 1}. {badge.name}</strong><button type="button" className="link-danger" aria-label={`Xóa ${badge.name}`} onClick={() => setProgram(current => ({ ...current, badges: current.badges.filter((_, badgeIndex) => badgeIndex !== index) }))}>Xóa</button></div><div className="form-grid"><Field label="Tên huy hiệu" value={badge.name} set={value => changeBadge(index, { name: value })} /><Field label="Mã biểu tượng Font Awesome" value={badge.icon} set={value => changeBadge(index, { icon: value })} /><Field label="Số chiến dịch tối thiểu" type="number" value={String(badge.minCampaigns)} set={value => changeBadge(index, { minCampaigns: Math.max(0, Number(value)) })} /><Field label="Số giờ tối thiểu" type="number" value={String(badge.minHours)} set={value => changeBadge(index, { minHours: Math.max(0, Number(value)) })} /><Field label="Số tháng có hoạt động" type="number" value={String(badge.minActiveMonths)} set={value => changeBadge(index, { minActiveMonths: Math.max(0, Number(value)) })} /><Field label="Thời gian gắn bó (tháng)" type="number" value={String(badge.minTenureMonths)} set={value => changeBadge(index, { minTenureMonths: Math.max(0, Number(value)) })} /></div><Text label="Mô tả mốc" value={badge.description} set={value => changeBadge(index, { description: value })} /></article>)}</div><button type="button" className="admin-primary" disabled={saving} onClick={() => void save()}>{saving ? "ĐANG LƯU…" : "LƯU HỆ THỐNG HUY HIỆU"}</button>{notice && <p className="admin-reward-notice">{notice}</p>}</section></div>
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

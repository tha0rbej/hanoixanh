import * as React from "react"
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react"
import { useAuth } from "./AuthContext"
import { tableDelete, tableInsert, tableSelect, tableUpdate, uploadPublicFile } from "../lib/supabase"

type Row = Record<string, unknown> & { id: string }
type Tab = "overview" | "reports" | "campaigns" | "posts" | "points"

const emptyCampaign = { title: "", description: "", status: "upcoming", start_at: "", end_at: "", location: "", latitude: "", longitude: "", capacity: "" }
const emptyPost = { title: "", content: "", excerpt: "", image_url: "", source_name: "", source_url: "", category: "Báo tin tức", status: "draft" }
const emptyPoint = { name: "", address: "", latitude: "", longitude: "", pollution_level: "medium", description: "", status: "proposed", event_date: "" }

function value(row: Row, key: string) { return String(row[key] ?? "") }
function formatDate(input: unknown) { const date = input ? new Date(String(input)) : null; return date && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString("vi-VN") : "—" }
function slugify(input: string) { return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID() }

export function AdminDashboard({ onLogin }: { onLogin?: () => void }) {
  const { session, profile, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>("overview")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [rows, setRows] = useState<Record<string, Row[]>>({ profiles: [], registrations: [], reports: [], campaigns: [], posts: [], points: [] })
  const [campaign, setCampaign] = useState(emptyCampaign)
  const [post, setPost] = useState(emptyPost)
  const [point, setPoint] = useState(emptyPoint)
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null)
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [editingPointId, setEditingPointId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true); setError("")
    try {
      const [profiles, registrations, reports, campaigns, posts, points] = await Promise.all([
        tableSelect<Row>("profiles", "*", session.access_token),
        tableSelect<Row>("campaign_registrations", "*, campaigns(title)", session.access_token, "&order=created_at.desc&limit=50"),
        tableSelect<Row>("pollution_reports", "*", session.access_token, "&order=created_at.desc&limit=50"),
        tableSelect<Row>("campaigns", "*", session.access_token, "&order=start_at.desc"),
        tableSelect<Row>("posts", "*", session.access_token, "&order=created_at.desc"),
        tableSelect<Row>("cleanup_points", "*", session.access_token, "&order=created_at.desc"),
      ])
      setRows({ profiles, registrations, reports, campaigns, posts, points })
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu dashboard.") }
    finally { setLoading(false) }
  }, [session])

  useEffect(() => { void load() }, [load])

  async function createCampaign(event: FormEvent) {
    event.preventDefault(); if (!session) return
    try { const payload = { ...campaign, latitude: Number(campaign.latitude), longitude: Number(campaign.longitude), capacity: campaign.capacity ? Number(campaign.capacity) : null }; if (editingCampaignId) await tableUpdate("campaigns", `id=eq.${editingCampaignId}`, payload, session.access_token); else await tableInsert("campaigns", payload, session.access_token); setCampaign(emptyCampaign); setEditingCampaignId(null); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tạo được chiến dịch.") }
  }
  async function createPost(event: FormEvent) {
    event.preventDefault(); if (!session) return
    try { const payload = { ...post, author_id: profile?.id, published_at: post.status === "published" ? new Date().toISOString() : null }; if (editingPostId) await tableUpdate("posts", `id=eq.${editingPostId}`, payload, session.access_token); else await tableInsert("posts", { ...payload, slug: `${slugify(post.title)}-${Date.now()}` }, session.access_token); setPost(emptyPost); setEditingPostId(null); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tạo được bài viết.") }
  }
  async function createPoint(event: FormEvent) {
    event.preventDefault(); if (!session) return
    try { const payload = { ...point, latitude: Number(point.latitude), longitude: Number(point.longitude), created_by: profile?.id }; if (editingPointId) await tableUpdate("cleanup_points", `id=eq.${editingPointId}`, payload, session.access_token); else await tableInsert("cleanup_points", payload, session.access_token); setPoint(emptyPoint); setEditingPointId(null); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tạo được điểm dọn dẹp.") }
  }
  async function updateReport(id: string, status: string) {
    if (!session) return
    try { await tableUpdate("pollution_reports", `id=eq.${encodeURIComponent(id)}`, { status }, session.access_token); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được báo cáo.") }
  }
  async function remove(table: string, id: string) {
    if (!session || !window.confirm("Xóa bản ghi này?")) return
    try { await tableDelete(table, `id=eq.${encodeURIComponent(id)}`, session.access_token); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không xóa được bản ghi.") }
  }
  async function attachImage(event: ChangeEvent<HTMLInputElement>, setter: (url: string) => void) {
    const file = event.target.files?.[0]; if (!file || !session) return
    try { setter(await uploadPublicFile(file, session.access_token)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được ảnh.") }
  }

  const stats = useMemo(() => [
    ["Người dùng", rows.profiles.length, "👥"],
    ["Lượt đăng ký", rows.registrations.length, "📋"],
    ["Báo cáo ô nhiễm", rows.reports.length, "📍"],
    ["Điểm dọn dẹp", rows.points.length, "🌱"],
  ], [rows])

  if (!profile || profile.role !== "admin") return <main className="admin-locked"><div><h1>{profile ? "Không có quyền truy cập" : "Đăng nhập quản trị"}</h1><p>{profile ? "Tài khoản hiện tại không có vai trò admin." : "Đăng nhập bằng tài khoản admin để mở dashboard."}</p>{!profile && onLogin && <button className="auth-primary" onClick={onLogin}>ĐĂNG NHẬP</button>} <a href="/">Về trang chủ</a></div></main>

  return <main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><span>🌱</span><div><strong>HÀ NỘI XANH</strong><small>ADMIN CONSOLE</small></div></div><nav>{([["overview", "Tổng quan"], ["reports", "Báo cáo ô nhiễm"], ["campaigns", "Chiến dịch"], ["posts", "Bài viết"], ["points", "Điểm dọn dẹp"]] as [Tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav><button className="admin-signout" onClick={() => void signOut()}>Đăng xuất</button></aside><section className="admin-content"><header className="admin-topbar"><div><p className="admin-kicker">BẢNG ĐIỀU KHIỂN</p><h1>{tab === "overview" ? "Tổng quan hoạt động" : tab === "reports" ? "Báo cáo ô nhiễm" : tab === "campaigns" ? "Quản lý chiến dịch" : tab === "posts" ? "Quản lý bài viết" : "Quản lý điểm dọn dẹp"}</h1></div><div className="admin-user"><span>{profile.full_name || profile.email}</span><small>ADMIN</small></div></header>{error && <div className="admin-error">{error}</div>}{loading ? <div className="admin-loading">Đang tải dữ liệu…</div> : <>{tab === "overview" && <Overview rows={rows} stats={stats} />}{tab === "reports" && <Reports rows={rows.reports} onStatus={updateReport} />}{tab === "campaigns" && <Campaigns rows={rows.campaigns} form={campaign} setForm={setCampaign} onSubmit={createCampaign} onDelete={(id) => remove("campaigns", id)} />}{tab === "posts" && <Posts rows={rows.posts} form={post} setForm={setPost} onSubmit={createPost} onDelete={(id) => remove("posts", id)} onImage={(e, setter) => void attachImage(e, setter)} />}{tab === "points" && <Points rows={rows.points} form={point} setForm={setPoint} onSubmit={createPoint} onDelete={(id) => remove("cleanup_points", id)} />}</>}</section></main>
}

function Overview({ rows, stats }: { rows: Record<string, Row[]>; stats: (string | number)[][] }) { return <div className="admin-page"><div className="admin-stat-grid">{stats.map(([label, count, icon]) => <article className="admin-stat" key={String(label)}><span>{icon}</span><strong>{count}</strong><small>{label}</small></article>)}</div><div className="admin-grid-2"><section className="admin-panel"><h2>Đăng ký gần đây</h2>{rows.registrations.slice(0, 8).map((row) => <div className="admin-row" key={row.id}><div><strong>{value(row, "user_id").slice(0, 8)}…</strong><small>{formatDate(row.created_at)}</small></div><span className="status-pill">{value(row, "status") || "registered"}</span></div>)}{!rows.registrations.length && <p className="admin-empty">Chưa có lượt đăng ký.</p>}</section><section className="admin-panel"><h2>Báo cáo cần xử lý</h2>{rows.reports.filter((row) => !["resolved", "rejected"].includes(value(row, "status"))).slice(0, 8).map((row) => <div className="admin-row" key={row.id}><div><strong>{value(row, "location_name") || "Điểm chưa đặt tên"}</strong><small>{formatDate(row.created_at)}</small></div><span className="status-pill warning">{value(row, "status") || "new"}</span></div>)}{!rows.reports.length && <p className="admin-empty">Chưa có báo cáo.</p>}</section></div></div> }

function Reports({ rows, onStatus }: { rows: Row[]; onStatus: (id: string, status: string) => Promise<void> }) { return <div className="admin-page"><section className="admin-panel"><h2>Danh sách báo cáo</h2><div className="admin-table-wrap"><table><thead><tr><th>Địa điểm</th><th>Mức độ</th><th>Mô tả</th><th>Ngày gửi</th><th>Trạng thái</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{value(row, "location_name") || "Chưa đặt tên"}<small>{value(row, "address")}</small></td><td>{value(row, "severity") || "medium"}</td><td>{value(row, "description").slice(0, 80)}</td><td>{formatDate(row.created_at)}</td><td><select value={value(row, "status") || "new"} onChange={(event) => void onStatus(row.id, event.target.value)}><option value="new">Mới</option><option value="verifying">Đang xác minh</option><option value="resolved">Đã xử lý</option><option value="rejected">Từ chối</option></select></td></tr>)}</tbody></table>{!rows.length && <p className="admin-empty">Chưa có báo cáo.</p>}</div></section></div> }

function Campaigns({ rows, form, setForm, onSubmit, onDelete }: { rows: Row[]; form: typeof emptyCampaign; setForm: (next: typeof emptyCampaign) => void; onSubmit: (event: FormEvent) => Promise<void>; onDelete: (id: string) => Promise<void> }) { return <div className="admin-page"><FormPanel title="Thêm chiến dịch" onSubmit={onSubmit}><div className="form-grid"><Field label="Tên chiến dịch" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required /><Field label="Địa điểm" value={form.location} onChange={(v) => setForm({ ...form, location: v })} required /><Field label="Bắt đầu" type="datetime-local" value={form.start_at} onChange={(v) => setForm({ ...form, start_at: v })} required /><Field label="Kết thúc" type="datetime-local" value={form.end_at} onChange={(v) => setForm({ ...form, end_at: v })} /><Field label="Vĩ độ" value={form.latitude} onChange={(v) => setForm({ ...form, latitude: v })} required /><Field label="Kinh độ" value={form.longitude} onChange={(v) => setForm({ ...form, longitude: v })} required /><Field label="Sức chứa" value={form.capacity} onChange={(v) => setForm({ ...form, capacity: v })} /><SelectField label="Trạng thái" value={form.status} options={[["upcoming", "Sắp diễn ra"], ["completed", "Đã diễn ra"]]} onChange={(v) => setForm({ ...form, status: v })} /></div><label className="wide-field">Mô tả<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><button className="admin-primary">TẠO CHIẾN DỊCH</button></FormPanel><ListPanel title="Các chiến dịch hiện có"><table><thead><tr><th>Tên</th><th>Địa điểm</th><th>Trạng thái</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{value(row, "title")}</td><td>{value(row, "location")}</td><td>{value(row, "status")}</td><td><button className="link-danger" onClick={() => void onDelete(row.id)}>Xóa</button></td></tr>)}</tbody></table></ListPanel></div> }

function Posts({ rows, form, setForm, onSubmit, onDelete, onImage }: { rows: Row[]; form: typeof emptyPost; setForm: (next: typeof emptyPost) => void; onSubmit: (event: React.FormEvent) => Promise<void>; onDelete: (id: string) => Promise<void>; onImage: (event: React.ChangeEvent<HTMLInputElement>, setter: (url: string) => void) => void }) { return <div className="admin-page"><FormPanel title="Soạn bài viết" onSubmit={onSubmit}><div className="form-grid"><Field label="Tiêu đề" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required /><Field label="Danh mục" value={form.category} onChange={(v) => setForm({ ...form, category: v })} /><Field label="Tên nguồn" value={form.source_name} onChange={(v) => setForm({ ...form, source_name: v })} /><Field label="URL nguồn" value={form.source_url} onChange={(v) => setForm({ ...form, source_url: v })} /><label>Ảnh đại diện<input type="file" accept="image/*" onChange={(e) => onImage(e, (url) => setForm({ ...form, image_url: url }))} /></label><SelectField label="Trạng thái" value={form.status} options={[["draft", "Bản nháp"], ["published", "Đã xuất bản"]]} onChange={(v) => setForm({ ...form, status: v })} /></div><label className="wide-field">Mô tả ngắn<textarea value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} /></label><label className="wide-field">Nội dung<textarea className="large-textarea" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required /></label><button className="admin-primary">LƯU BÀI VIẾT</button></FormPanel><ListPanel title="Bài viết"><table><thead><tr><th>Tiêu đề</th><th>Nguồn</th><th>Trạng thái</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{value(row, "title")}</td><td>{value(row, "source_name")}</td><td>{value(row, "status")}</td><td><button className="link-danger" onClick={() => void onDelete(row.id)}>Xóa</button></td></tr>)}</tbody></table></ListPanel></div> }

function Points({ rows, form, setForm, onSubmit, onDelete }: { rows: Row[]; form: typeof emptyPoint; setForm: (next: typeof emptyPoint) => void; onSubmit: (event: React.FormEvent) => Promise<void>; onDelete: (id: string) => Promise<void> }) { return <div className="admin-page"><FormPanel title="Thêm điểm dọn dẹp" onSubmit={onSubmit}><div className="form-grid"><Field label="Tên điểm" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required /><Field label="Địa chỉ" value={form.address} onChange={(v) => setForm({ ...form, address: v })} required /><Field label="Vĩ độ" value={form.latitude} onChange={(v) => setForm({ ...form, latitude: v })} required /><Field label="Kinh độ" value={form.longitude} onChange={(v) => setForm({ ...form, longitude: v })} required /><SelectField label="Mức ô nhiễm" value={form.pollution_level} options={[["low", "Thấp"], ["medium", "Trung bình"], ["high", "Cao"], ["critical", "Nghiêm trọng"]]} onChange={(v) => setForm({ ...form, pollution_level: v })} /><SelectField label="Trạng thái" value={form.status} options={[["proposed", "Đề xuất"], ["verified", "Đã xác minh"], ["in_progress", "Đang xử lý"], ["completed", "Đã hoàn thành"]]} onChange={(v) => setForm({ ...form, status: v })} /><Field label="Ngày ra quân" type="date" value={form.event_date} onChange={(v) => setForm({ ...form, event_date: v })} /></div><label className="wide-field">Mô tả<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><button className="admin-primary">THÊM ĐIỂM</button></FormPanel><ListPanel title="Điểm dọn dẹp"><table><thead><tr><th>Tên</th><th>Địa chỉ</th><th>Mức độ</th><th>Trạng thái</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{value(row, "name")}</td><td>{value(row, "address")}</td><td>{value(row, "pollution_level")}</td><td>{value(row, "status")}</td><td><button className="link-danger" onClick={() => void onDelete(row.id)}>Xóa</button></td></tr>)}</tbody></table></ListPanel></div> }

function FormPanel({ title, onSubmit, children }: { title: string; onSubmit: (event: React.FormEvent) => Promise<void>; children: React.ReactNode }) { return <section className="admin-panel"><h2>{title}</h2><form onSubmit={(event) => void onSubmit(event)}>{children}</form></section> }
function ListPanel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="admin-panel"><h2>{title}</h2><div className="admin-table-wrap">{children}</div></section> }
function Field({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) { return <label>{label}<input type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} /></label> }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label> }

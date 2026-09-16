import { useEffect, useState, type ChangeEvent } from "react"
import { tableInsert, tableUpdate, uploadPublicFile } from "../lib/supabase"

type MetricRow = Record<string, unknown> & { id: string }
type BeforeAfterItem = { title: string; description: string; before_url: string; after_url: string }

const defaultOverview: Record<string, number> = {
  campaigns: 230,
  volunteers: 85000,
  trash_tons: 350,
  cleanup_points: 120,
  cleaned_km: 50,
}

const defaultMonthly: Record<string, number> = {
  "2026-05": 35,
  "2026-06": 52,
  "2026-07": 110,
  "2026-08": 40,
  "2026-09": 65,
}

const defaultBeforeAfter: BeforeAfterItem[] = [
  { title: "Dự án 1 – Chợ Tứ Liên (Tây Hồ)", description: "Mương nước ngập rác sinh hoạt dày đặc → Đã khơi thông dòng chảy hoàn toàn.", before_url: "Picture1.jpg", after_url: "Picture2.jpg" },
  { title: "Dự án 2 – Ngõ 236 Âu Cơ, Hồng Hà", description: "Nước dềnh ngập rác tràn vào ngõ → Đã thu gom và khử khuẩn lối đi an toàn.", before_url: "Picture3.jpg", after_url: "Picture4.jpg" },
  { title: "Dự án 3 – Bãi bồi Cầu Long Biên", description: "Hàng tấn phế thải trong bãi cỏ → Tình nguyện viên đã thu gom và làm sạch.", before_url: "Picture5.jpg", after_url: "Picture6.jpg" },
]

function previewUrl(url: string) {
  if (!url || /^(https?:|data:|\/)/.test(url)) return url
  return `${import.meta.env.BASE_URL}source/remaining/${url}`
}

export function ImpactContentEditor({ rows, session, onSaved }: { rows: MetricRow[]; session: { access_token: string } | null; onSaved: (rows: MetricRow[]) => void }) {
  const value = (key: string) => rows.find(row => row.metric_key === key)?.metric_value
  const [overview, setOverview] = useState<Record<string, number>>(defaultOverview)
  const [monthly, setMonthly] = useState<Record<string, number>>(defaultMonthly)
  const [beforeAfter, setBeforeAfter] = useState<BeforeAfterItem[]>(defaultBeforeAfter)
  const [uploading, setUploading] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const nextOverview = value("overview")
    const nextMonthly = value("monthly_waste")
    const nextBeforeAfter = value("before_after")
    if (nextOverview) setOverview({ ...defaultOverview, ...(nextOverview as Record<string, number>) })
    if (nextMonthly) setMonthly(nextMonthly as Record<string, number>)
    if (Array.isArray(nextBeforeAfter)) setBeforeAfter(nextBeforeAfter as BeforeAfterItem[])
  }, [rows])

  async function save(key: string, metricValue: unknown) {
    if (!session) return
    setError("")
    setNotice("")
    try {
      const existing = rows.find(row => row.metric_key === key)
      let nextRows: MetricRow[]
      if (existing) {
        await tableUpdate("homepage_metrics", `metric_key=eq.${encodeURIComponent(key)}`, { metric_value: metricValue, updated_at: new Date().toISOString() }, session.access_token)
        nextRows = rows.map(row => row.metric_key === key ? { ...row, metric_value: metricValue } : row)
      } else {
        const created = await tableInsert<MetricRow>("homepage_metrics", { metric_key: key, metric_value: metricValue }, session.access_token)
        nextRows = [...rows, created[0] || { id: key, metric_key: key, metric_value: metricValue }]
      }
      onSaved(nextRows)
      setNotice("Đã lưu. Trang Tác động cộng đồng sẽ dùng dữ liệu mới.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được dữ liệu.")
    }
  }

  async function uploadProjectImage(index: number, field: "before_url" | "after_url", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !session) return
    const uploadKey = `${index}-${field}`
    setUploading(uploadKey)
    setError("")
    try {
      const url = await uploadPublicFile(file, session.access_token)
      setBeforeAfter(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: url } : item))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được ảnh.")
    } finally {
      setUploading("")
      event.target.value = ""
    }
  }

  const setOverviewNumber = (key: string, number: string) => setOverview(current => ({ ...current, [key]: Number(number) }))

  return <div className="admin-page">
    {error && <div className="admin-error">{error}</div>}
    {notice && <div style={{ padding: 12, borderRadius: 8, background: "#ecfdf5", color: "#047857", fontWeight: 700 }}>{notice}</div>}

    <section className="admin-panel">
      <h2>Tổng quan dữ liệu toàn hệ thống</h2>
      <div className="form-grid">
        <label>Số chiến dịch<input type="number" value={overview.campaigns ?? 0} onChange={event => setOverviewNumber("campaigns", event.target.value)} /></label>
        <label>Tình nguyện viên<input type="number" value={overview.volunteers ?? 0} onChange={event => setOverviewNumber("volunteers", event.target.value)} /></label>
        <label>Tấn rác đã xử lý<input type="number" value={overview.trash_tons ?? 0} onChange={event => setOverviewNumber("trash_tons", event.target.value)} /></label>
        <label>Điểm đã làm sạch<input type="number" value={overview.cleanup_points ?? 0} onChange={event => setOverviewNumber("cleanup_points", event.target.value)} /></label>
      </div>
      <button className="admin-primary" onClick={() => void save("overview", overview)}>Lưu tổng quan</button>
    </section>

    <section className="admin-panel">
      <h2>Khối lượng rác xử lý qua các tháng (Tấn)</h2>
      {Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => <div className="form-grid" key={month}>
        <label>Tháng<input type="month" value={month} disabled /></label>
        <label>Khối lượng (tấn)<input type="number" min="0" step="0.1" value={amount} onChange={event => setMonthly(current => ({ ...current, [month]: Number(event.target.value) }))} /></label>
        <button type="button" className="link-danger" onClick={() => setMonthly(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== month)))}>Xóa tháng</button>
      </div>)}
      <button className="admin-primary" onClick={() => void save("monthly_waste", monthly)}>Lưu biểu đồ</button>
    </section>

    <section className="admin-panel">
      <h2>Dashboard trước – sau khi làm sạch</h2>
      {beforeAfter.map((item, index) => <div key={index} style={{ marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
        <div className="form-grid">
          <label>Tiêu đề<input value={item.title} onChange={event => setBeforeAfter(items => items.map((current, itemIndex) => itemIndex === index ? { ...current, title: event.target.value } : current))} /></label>
          <label className="wide-field">Mô tả<textarea value={item.description} onChange={event => setBeforeAfter(items => items.map((current, itemIndex) => itemIndex === index ? { ...current, description: event.target.value } : current))} /></label>
          <label>Ảnh trước<input type="file" accept="image/*" onChange={event => void uploadProjectImage(index, "before_url", event)} />{uploading === `${index}-before_url` && <small>Đang tải…</small>}{item.before_url && <img src={previewUrl(item.before_url)} alt="Ảnh trước" style={{ display: "block", width: 150, height: 90, objectFit: "cover", marginTop: 8, borderRadius: 8 }} />}</label>
          <label>Ảnh sau<input type="file" accept="image/*" onChange={event => void uploadProjectImage(index, "after_url", event)} />{uploading === `${index}-after_url` && <small>Đang tải…</small>}{item.after_url && <img src={previewUrl(item.after_url)} alt="Ảnh sau" style={{ display: "block", width: 150, height: 90, objectFit: "cover", marginTop: 8, borderRadius: 8 }} />}</label>
        </div>
        <button type="button" className="link-danger" onClick={() => setBeforeAfter(items => items.filter((_, itemIndex) => itemIndex !== index))}>Xóa dự án</button>
      </div>)}
      <button type="button" onClick={() => setBeforeAfter(items => [...items, { title: "", description: "", before_url: "", after_url: "" }])}>+ Thêm dự án trước – sau</button>{" "}
      <button className="admin-primary" onClick={() => void save("before_after", beforeAfter)}>Lưu dashboard trước – sau</button>
    </section>
  </div>
}

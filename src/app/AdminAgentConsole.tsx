import { useEffect, useMemo, useState, type FormEvent } from "react"
import { getStoredSession, refreshSession, tableSelect } from "../lib/supabase"

type ChatMessage = { id: string; role: "admin" | "agent"; content: string }
type AgentThread = { id: string; title?: string; status?: string; workflow_state?: string; created_at?: string; updated_at?: string }
type Finding = {
  finding_id?: string
  id?: string
  location_name?: string
  district?: string
  pollution_type?: string
  summary?: string
  confidence?: string
  images?: Array<{ url?: string; caption?: string; source_url?: string; license_status?: string }>
  sources?: Array<{ title?: string; url?: string; published_at?: string }>
}
type Draft = {
  draft_id?: string
  id?: string
  version?: number
  title?: string
  preview_url?: string
  file_url?: string
  image_url?: string
  status?: string
  cleanup_start_at?: string
  cleanup_end_at?: string
  meeting_point?: string
  website_payload?: {
    title?: string
    content?: string
    excerpt?: string
    image_url?: string
    pollution_status?: string
    objective?: string
    support_equipment?: string
    schedule?: { start_at?: string; end_at?: string; timezone?: string; location?: string }
  }
  threads_payload?: { text?: string; content?: string }
  images?: Array<{ url?: string; caption?: string; source_url?: string; license_status?: string }>
  sources?: Array<{ title?: string; url?: string; published_at?: string }>
}
type AgentResponse = {
  thread_id?: string | null
  message?: string
  reply?: string
  output?: string
  state?: string
  findings?: Finding[]
  draft?: Draft | null
  error?: string
}

type StoredAgentMessage = { id: string; role: "user" | "assistant" | "tool" | "system"; content: string; created_at?: string }
type DraftRow = { id: string; current_version?: number; status?: string; title?: string; updated_at?: string; cleanup_start_at?: string; cleanup_end_at?: string; finding_id?: string }
type DraftVersionRow = { version?: number; website_payload?: Draft["website_payload"]; threads_payload?: Draft["threads_payload"]; images?: Draft["images"]; sources?: Draft["sources"] }

const webhookUrl = String(import.meta.env.VITE_N8N_ADMIN_AGENT_WEBHOOK_URL || (window.location.hostname === "localhost" ? "http://localhost:5678/webhook/hnx-admin-agent" : "")).trim()
const fallbackCampaignImage = "https://raw.githubusercontent.com/tha0rbej/hanoixanh/main/anh-chien-dich-kenh-muong.png"
const threadStorageKey = "hnx-admin-agent-thread"
const welcomeMessage: ChatMessage = { id: "welcome", role: "agent", content: "Xin chào. Tôi có thể tìm địa điểm ô nhiễm tại Hà Nội, tạo chiến dịch có ảnh, nhận feedback và đăng nội dung lên Threads sau khi bạn duyệt." }

function messageText(response: AgentResponse) {
  return String(response.message || response.reply || response.output || "Agent đã xử lý yêu cầu nhưng chưa trả nội dung.")
}

function foldFindingText(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

function isHanoiFinding(finding: Finding) {
  const sourceText = (finding.sources || []).flatMap(source => [source.title, source.url]).join(" ")
  return /\b(?:ha noi|hanoi)\b/.test(foldFindingText([finding.location_name, finding.summary, sourceText].join(" ")))
}

function visibleFindings(rows: Finding[]) {
  return rows.filter(isHanoiFinding).slice(0, 3)
}

function shortFindingSummary(finding?: Finding) {
  if (!finding) return ""
  const summary = String(finding.summary || "").replace(/\s+/g, " ").trim()
  if (!summary) return ""
  const sentences = summary.split(/(?<=[.!?。！？])\s+/).map(item => item.trim()).filter(item => item.length >= 12)
  const focused = sentences.find(item => /ô nhiễm\s+(nặng|nghiêm trọng)|rác thải|nước thải|bèo tây|tắc dòng chảy|rác tồn đọng/i.test(item)) || sentences[0] || summary
  const cleaned = focused.replace(/^VOV\.VN\s*[-:：]?\s*/i, "").replace(/^Toàn cảnh\s+/i, "").replace(/\s+(sắp được giải cứu|đang được giải cứu|được giải cứu)\b.*$/i, "").trim()
  return cleaned.length > 180 ? `${cleaned.slice(0, 177).replace(/\s+\S*$/, "")}…` : cleaned
}

function formatDraftDateTime(value?: string) {
  if (!value) return "Chưa cập nhật"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

function draftImage(draft: Draft) {
  const candidates = [draft.image_url, draft.website_payload?.image_url, ...(draft.images || []).map(image => image.url)]
  return candidates.map(value => String(value || "").trim()).find(value => /^https:\/\/\S+$/i.test(value)) || fallbackCampaignImage
}

function draftLocation(draft: Draft) {
  return draft.website_payload?.schedule?.location || draft.meeting_point || "Chưa cập nhật"
}

function draftTimeRange(draft: Draft) {
  const start = draft.website_payload?.schedule?.start_at || draft.cleanup_start_at
  const end = draft.website_payload?.schedule?.end_at || draft.cleanup_end_at
  return `${formatDraftDateTime(start)} – ${formatDraftDateTime(end)} (giờ Hà Nội)`
}

function campaignDefaults(finding?: Finding) {
  const location = [finding?.location_name, finding?.district].filter(Boolean).join(", ") || "Hà Nội"
  const pollution = shortFindingSummary(finding)
  return {
    location,
    pollution_status: pollution || `Ghi nhận điểm ô nhiễm cần xử lý tại ${location}.`,
    objective: `Thu gom và xử lý điểm ô nhiễm tại ${location}, khơi thông khu vực và ngăn rác tái tồn đọng.`,
    support_equipment: "Bao tay, kẹp gắp rác, bao tải, dụng cụ thu gom và nước sát khuẩn do Hà Nội Xanh chuẩn bị.",
  }
}

function enrichDraft(input: Draft, finding?: Finding): Draft {
  const defaults = campaignDefaults(finding)
  const website = input.website_payload || {}
  return {
    ...input,
    meeting_point: input.meeting_point || website.schedule?.location || defaults.location,
    website_payload: {
      ...website,
      pollution_status: website.pollution_status || defaults.pollution_status,
      objective: website.objective || defaults.objective,
      support_equipment: website.support_equipment || defaults.support_equipment,
      schedule: {
        ...website.schedule,
        location: website.schedule?.location || input.meeting_point || defaults.location,
      },
    },
  }
}

export function AdminAgentConsole({ accessToken }: { accessToken: string }) {
  const [threadId, setThreadId] = useState(() => window.localStorage.getItem(threadStorageKey) || "")
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "agent", content: "Xin chào. Tôi có thể tìm địa điểm ô nhiễm tại Hà Nội, tạo chiến dịch có ảnh, nhận feedback và đăng nội dung lên Threads sau khi bạn duyệt." },
  ])
  const [findings, setFindings] = useState<Finding[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [value, setValue] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sessions, setSessions] = useState<AgentThread[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const configured = Boolean(webhookUrl)
  const latestState = useMemo(() => draft?.status || (findings.length ? "Đã có kết quả nghiên cứu" : "Sẵn sàng"), [draft, findings.length])

  async function refreshSessionList() {
    const ownerId = getStoredSession()?.user.id
    if (!ownerId) throw new Error("Không xác định được tài khoản admin hiện tại.")
    const rows = await tableSelect<AgentThread>("agent_threads", "id,title,status,workflow_state,created_at,updated_at", accessToken, `&created_by=eq.${encodeURIComponent(ownerId)}&order=updated_at.desc&limit=50`)
    setSessions(rows)
    return rows
  }

  async function loadSessionData(id: string) {
    setSessionLoading(true)
    setError("")
    try {
      const [messageRows, findingRows, draftRows] = await Promise.all([
        tableSelect<StoredAgentMessage>("agent_messages", "id,role,content,created_at", accessToken, `&thread_id=eq.${encodeURIComponent(id)}&order=created_at.asc&limit=200`),
        tableSelect<Finding & { id: string }>("pollution_findings", "id,location_name,district,pollution_type,summary,confidence,images,sources", accessToken, `&thread_id=eq.${encodeURIComponent(id)}&order=created_at.desc`),
        tableSelect<DraftRow>("content_drafts", "*", accessToken, `&thread_id=eq.${encodeURIComponent(id)}&order=updated_at.desc&limit=1`),
      ])
      const restoredMessages = messageRows.filter(row => row.role === "user" || row.role === "assistant").map(row => ({ id: row.id, role: row.role === "user" ? "admin" : "agent", content: row.content } as ChatMessage))
      setThreadId(id)
      window.localStorage.setItem(threadStorageKey, id)
      setMessages(restoredMessages.length ? restoredMessages : [welcomeMessage])
      const visible = visibleFindings(findingRows.map(row => ({ ...row, finding_id: row.id })))
      setFindings(visible)
      const row = draftRows[0]
      if (!row) {
        setDraft(null)
        return
      }
      const versions = await tableSelect<DraftVersionRow>("draft_versions", "*", accessToken, `&draft_id=eq.${encodeURIComponent(row.id)}&version=eq.${row.current_version || 1}&limit=1`)
      const version = versions[0]
      const images = version?.images || []
      setDraft(enrichDraft({
        ...row,
        draft_id: row.id,
        version: version?.version || row.current_version || 1,
        website_payload: version?.website_payload,
        threads_payload: version?.threads_payload,
        images,
        sources: version?.sources || [],
        image_url: version?.website_payload?.image_url || images[0]?.url,
      }, visible.find(finding => finding.finding_id === row.finding_id) || visible[0]))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được session Agent.")
    } finally {
      setSessionLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    setSessionsLoading(true)
    refreshSessionList()
      .then(rows => {
        if (!active) return
        const stored = window.localStorage.getItem(threadStorageKey)
        const selected = rows.find(row => row.id === stored) || rows[0]
        if (selected) return loadSessionData(selected.id)
        setThreadId("")
        setMessages([welcomeMessage])
        setFindings([])
        setDraft(null)
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Không tải được danh sách session Agent.") })
      .finally(() => { if (active) setSessionsLoading(false) })
    return () => { active = false }
  }, [accessToken])

  function sessionTitle(session: AgentThread) {
    return String(session.title || "Cuộc trò chuyện mới").trim() || "Cuộc trò chuyện mới"
  }

  function sessionDate(session: AgentThread) {
    if (!session.updated_at) return ""
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(session.updated_at))
  }

  async function selectSession(id: string) {
    if (id === threadId || sessionLoading) return
    await loadSessionData(id)
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    const content = value.trim()
    if (!content || loading || !configured) return
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "admin", content }
    setMessages(current => [...current, userMessage])
    setValue("")
    setLoading(true)
    setError("")
    try {
      const payload = JSON.stringify({ message: content, thread_id: threadId || null, client_message_id: userMessage.id, timezone: "Asia/Ho_Chi_Minh" })
      const sendRequest = (token: string) => fetch(webhookUrl, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: payload })
      let response = await sendRequest(accessToken)
      if (response.status === 401) {
        const storedSession = getStoredSession()
        if (!storedSession) throw new Error("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.")
        const freshSession = await refreshSession(storedSession)
        response = await sendRequest(freshSession.access_token)
      }
      const body = await response.json().catch(() => ({})) as AgentResponse
      if (!response.ok) throw new Error(body.message || body.error || `Agent trả về HTTP ${response.status}.`)
      const nextThreadId = String(body.thread_id || threadId || "")
      if (nextThreadId) {
        setThreadId(nextThreadId)
        window.localStorage.setItem(threadStorageKey, nextThreadId)
      }
      const nextFindings = Array.isArray(body.findings) ? visibleFindings(body.findings) : findings
      if (Array.isArray(body.findings)) setFindings(nextFindings)
      if (body.draft) setDraft(enrichDraft(body.draft, nextFindings[0]))
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "agent", content: messageText(body) }])
      void refreshSessionList()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể kết nối với Admin Agent.")
    } finally {
      setLoading(false)
    }
  }

  function chooseFinding(finding: Finding, index: number) {
    const id = finding.finding_id || finding.id
    const name = finding.location_name || `địa điểm ${index + 1}`
    setValue(id ? `Tôi chọn ${name} (finding_id: ${id}). Hãy tiếp tục quy trình.` : `Tôi chọn địa điểm số ${index + 1}: ${name}. Hãy tiếp tục quy trình.`)
  }

  function resetThread() {
    window.localStorage.removeItem(threadStorageKey)
    setThreadId("")
    setFindings([])
    setDraft(null)
    setMessages([{ id: crypto.randomUUID(), role: "agent", content: "Đã bắt đầu cuộc trò chuyện mới. Bạn muốn tìm hiểu vấn đề môi trường nào?" }])
    setError("")
  }

  function downloadDraft() {
    if (!draft) return
    const escapeHtml = (input: unknown) => String(input || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] || character)
    const website = draft.website_payload || {}
    const threads = draft.threads_payload || {}
    const image = draftImage(draft)
    const title = escapeHtml(website.title || draft.title || "Bản nháp Hà Nội Xanh")
    const content = escapeHtml(website.content || website.excerpt).replace(/\n/g, "<br>")
    const details = [["Ngày giờ", `${draftTimeRange(draft)}`], ["Địa điểm", draftLocation(draft)], ["Tình trạng ô nhiễm", website.pollution_status || "Chưa cập nhật"], ["Mục tiêu", website.objective || "Chưa cập nhật"], ["Trang bị hỗ trợ", website.support_equipment || "Chưa cập nhật"]].map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("")
    const threadsContent = escapeHtml(threads.text || threads.content)
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title><style>body{max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.65 Arial;color:#173326}img{max-width:100%;border-radius:14px}h1{color:#0f382c}.details{display:grid;gap:10px;margin:24px 0}.details div{padding:12px 14px;border:1px solid #dce8df;border-radius:10px}.details strong{display:block;color:#166534;font-size:12px;text-transform:uppercase}.details span{display:block}.threads{margin-top:36px;padding:20px;background:#f0fdf4;border-radius:12px;white-space:pre-wrap}</style></head><body><h1>${title}</h1>${image ? `<img src="${escapeHtml(image)}" alt="Ảnh bài viết">` : ""}<section class="details">${details}</section><div>${content}</div><section class="threads"><strong>Nội dung Threads</strong><p>${threadsContent}</p></section></body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `hnx-draft-${draft.draft_id || draft.id || "post"}-v${draft.version || 1}.html`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!configured) return <section className="admin-panel agent-setup"><h2>Trợ lý AI chưa được kết nối</h2><p>Thêm <code>VITE_N8N_ADMIN_AGENT_WEBHOOK_URL</code> vào <code>.env.local</code>, sau đó build lại frontend. Không đặt API key hoặc credential n8n trong biến frontend.</p></section>

  return <div className="agent-console">
    <aside className="agent-session-sidebar">
      <div className="agent-session-sidebar-head"><div><span className="admin-kicker">LỊCH SỬ</span><h3>Cuộc trò chuyện</h3></div><button type="button" onClick={resetThread}>+</button></div>
      <button className="agent-new-session" type="button" onClick={resetThread}>＋ Cuộc trò chuyện mới</button>
      <div className="agent-session-list">
        {sessionsLoading && <p className="agent-session-empty">Đang tải session…</p>}
        {!sessionsLoading && !sessions.length && <p className="agent-session-empty">Chưa có cuộc trò chuyện nào.</p>}
        {sessions.map(session => <button type="button" key={session.id} className={`agent-session-item ${session.id === threadId ? "active" : ""}`} onClick={() => void selectSession(session.id)} disabled={sessionLoading}>
          <strong>{sessionTitle(session)}</strong><small>{sessionDate(session)}</small>
        </button>)}
      </div>
    </aside>
    <div className="agent-session-content">
    <section className="admin-panel agent-chat-panel">
      <div className="admin-panel-heading"><div><h2>Hà Nội Xanh Admin Agent</h2><p>{latestState}{threadId ? ` · Thread ${threadId.slice(0, 8)}` : ""}</p></div><button type="button" onClick={resetThread}>Cuộc trò chuyện mới</button></div>
      <div className="agent-messages" aria-live="polite">
        {messages.map(message => <article className={`agent-message ${message.role}`} key={message.id}><strong>{message.role === "admin" ? "Bạn" : "Agent"}</strong><p>{message.content}</p></article>)}
        {loading && <article className="agent-message agent"><strong>Agent</strong><p>Đang xử lý và gọi công cụ phù hợp…</p></article>}
      </div>
      {error && <div className="admin-error">{error}</div>}
      <form className="agent-composer" onSubmit={send}>
        <label htmlFor="agent-message">Yêu cầu hoặc feedback</label>
        <textarea id="agent-message" value={value} onChange={event => setValue(event.target.value)} placeholder="Ví dụ: Tìm các điểm có rác thải tồn đọng tại Hà Nội trong 30 ngày gần đây…" />
        <button className="admin-primary" disabled={loading || !value.trim()}>{loading ? "Đang gửi…" : "Gửi cho Agent"}</button>
      </form>
    </section>

    {findings.length > 0 && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Địa điểm Agent tìm được</h2><p>3 địa điểm tại Hà Nội · tóm tắt ngắn và bài báo nguồn.</p></div></div><div className="agent-finding-grid">{findings.slice(0, 3).map((finding, index) => <article className="agent-finding" key={finding.finding_id || finding.id || index}>
      <div><h3>{finding.location_name || `Địa điểm ${index + 1}`}</h3><p>{shortFindingSummary(finding)}</p>
        {finding.sources?.[0]?.url && <a href={finding.sources[0].url} target="_blank" rel="noreferrer">Đọc bài báo</a>}
        <button type="button" onClick={() => chooseFinding(finding, index)}>Chọn địa điểm này</button>
      </div>
    </article>)}</div></section>}

    {draft && <section className="admin-panel agent-draft"><div className="admin-panel-heading"><div><h2>{draft.website_payload?.title || draft.title || "Bản nháp chiến dịch"}</h2><p>Version {draft.version || 1} · {draft.status || "draft"}</p></div></div>{draftImage(draft) ? <img src={draftImage(draft)} alt="Ảnh đại diện chiến dịch" /> : <div className="agent-draft-missing-image">Bản nháp chưa có ảnh hợp lệ.</div>}<div className="agent-draft-details"><div><strong>Ngày giờ</strong><p>{draftTimeRange(draft)}</p></div><div><strong>Địa điểm</strong><p>{draftLocation(draft)}</p></div><div><strong>Tình trạng ô nhiễm</strong><p>{draft.website_payload?.pollution_status}</p></div><div><strong>Mục tiêu</strong><p>{draft.website_payload?.objective}</p></div><div><strong>Trang bị hỗ trợ</strong><p>{draft.website_payload?.support_equipment}</p></div></div>{(draft.threads_payload?.text || draft.threads_payload?.content) && <div className="agent-thread-preview"><strong>Nội dung Threads</strong><p>{draft.threads_payload.text || draft.threads_payload.content}</p></div>}<div className="agent-draft-actions"><button type="button" onClick={() => setValue(`Tôi đã đọc draft ${draft.draft_id || draft.id || "hiện tại"}. Feedback của tôi là: `)}>Gửi feedback</button></div></section>}
    </div>
  </div>
}

import { useMemo, useState, type FormEvent } from "react"

type ChatMessage = { id: string; role: "admin" | "agent"; content: string }
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
  website_payload?: { title?: string; content?: string; excerpt?: string; image_url?: string }
  threads_payload?: { text?: string; content?: string }
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

const webhookUrl = String(import.meta.env.VITE_N8N_ADMIN_AGENT_WEBHOOK_URL || "").trim()
const threadStorageKey = "hnx-admin-agent-thread"

function messageText(response: AgentResponse) {
  return String(response.message || response.reply || response.output || "Agent đã xử lý yêu cầu nhưng chưa trả nội dung.")
}

export function AdminAgentConsole({ accessToken }: { accessToken: string }) {
  const [threadId, setThreadId] = useState(() => window.localStorage.getItem(threadStorageKey) || "")
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "agent", content: "Xin chào. Tôi có thể tìm địa điểm ô nhiễm tại Hà Nội, tạo bản nháp có ảnh, nhận feedback và đăng bài sau khi bạn duyệt." },
  ])
  const [findings, setFindings] = useState<Finding[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [value, setValue] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const configured = Boolean(webhookUrl)
  const latestState = useMemo(() => draft?.status || (findings.length ? "Đã có kết quả nghiên cứu" : "Sẵn sàng"), [draft, findings.length])

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
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          thread_id: threadId || null,
          client_message_id: userMessage.id,
          timezone: "Asia/Ho_Chi_Minh",
        }),
      })
      const body = await response.json().catch(() => ({})) as AgentResponse
      if (!response.ok) throw new Error(body.message || body.error || `Agent trả về HTTP ${response.status}.`)
      const nextThreadId = String(body.thread_id || threadId || "")
      if (nextThreadId) {
        setThreadId(nextThreadId)
        window.localStorage.setItem(threadStorageKey, nextThreadId)
      }
      if (Array.isArray(body.findings)) setFindings(body.findings)
      if (body.draft) setDraft(body.draft)
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "agent", content: messageText(body) }])
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
    const image = draft.image_url || website.image_url || ""
    const title = escapeHtml(website.title || draft.title || "Bản nháp Hà Nội Xanh")
    const content = escapeHtml(website.content || website.excerpt).replace(/\n/g, "<br>")
    const threadsContent = escapeHtml(threads.text || threads.content)
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title><style>body{max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.65 Arial;color:#173326}img{max-width:100%;border-radius:14px}h1{color:#0f382c}.threads{margin-top:36px;padding:20px;background:#f0fdf4;border-radius:12px;white-space:pre-wrap}</style></head><body><h1>${title}</h1>${image ? `<img src="${escapeHtml(image)}" alt="Ảnh bài viết">` : ""}<div>${content}</div><section class="threads"><strong>Nội dung Threads</strong><p>${threadsContent}</p></section></body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `hnx-draft-${draft.draft_id || draft.id || "post"}-v${draft.version || 1}.html`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!configured) return <section className="admin-panel agent-setup"><h2>Trợ lý AI chưa được kết nối</h2><p>Thêm <code>VITE_N8N_ADMIN_AGENT_WEBHOOK_URL</code> vào <code>.env.local</code>, sau đó build lại frontend. Không đặt API key hoặc credential n8n trong biến frontend.</p></section>

  return <div className="agent-console">
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

    {findings.length > 0 && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Địa điểm Agent tìm được</h2><p>Kiểm tra nguồn và ảnh trước khi chọn.</p></div></div><div className="agent-finding-grid">{findings.map((finding, index) => {
      const image = finding.images?.[0]
      return <article className="agent-finding" key={finding.finding_id || finding.id || index}>
        {image?.url && <img src={image.url} alt={image.caption || finding.location_name || "Ảnh địa điểm"} />}
        <div><span className="status-pill">{finding.confidence || "Chưa đánh giá"}</span><h3>{finding.location_name || `Địa điểm ${index + 1}`}</h3><small>{[finding.district, finding.pollution_type].filter(Boolean).join(" · ")}</small><p>{finding.summary}</p>
          {finding.sources?.[0]?.url && <a href={finding.sources[0].url} target="_blank" rel="noreferrer">Xem nguồn</a>}
          <button type="button" onClick={() => chooseFinding(finding, index)}>Chọn địa điểm này</button>
        </div>
      </article>
    })}</div></section>}

    {draft && <section className="admin-panel agent-draft"><div className="admin-panel-heading"><div><h2>{draft.website_payload?.title || draft.title || "Bản nháp bài viết"}</h2><p>Version {draft.version || 1} · {draft.status || "draft"}</p></div></div>{(draft.image_url || draft.website_payload?.image_url) && <img src={draft.image_url || draft.website_payload?.image_url} alt="Ảnh đại diện bản nháp" />}{draft.website_payload?.content && <div className="agent-draft-copy">{draft.website_payload.content}</div>}<div className="agent-draft-actions">{draft.preview_url && <a href={draft.preview_url} target="_blank" rel="noreferrer">Mở preview</a>}{draft.file_url && <a href={draft.file_url} target="_blank" rel="noreferrer">Tải file bản nháp</a>}<button type="button" onClick={downloadDraft}>Tải HTML có ảnh</button><button type="button" onClick={() => setValue(`Tôi đã đọc draft ${draft.draft_id || draft.id || "hiện tại"}. Feedback của tôi là: `)}>Gửi feedback</button></div></section>}
  </div>
}

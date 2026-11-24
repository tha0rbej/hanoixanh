'use strict';
// Supabase giả cho kiểm thử e2e (PostgREST + RPC theo hợp đồng giai đoạn 1). Dữ liệu giả, không có khóa thật.
// Chạy: HNX_E2E_MOCK=1 HNX_MOCK_BIND=172.17.0.1 HNX_MOCK_SUPABASE_PORT=19999 node mock-supabase.js
// Quan sát: GET /__log (mọi request), DELETE /__log, GET /__db (toàn bộ dữ liệu).
const http = require('node:http');
const crypto = require('node:crypto');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const SECRET = 'e2e-fake-supabase-secret';
const MAX_RECIPIENTS = 1000;
const CAMPAIGNS = [
  { id: 'c1c1c1c1-0000-4000-8000-000000000001', title: 'Dọn rác La Phù', start_at: new Date(Date.now() + 5 * 86400e3).toISOString(), end_at: null, location: 'Xã La Phù, Hoài Đức', campaign_status: 'upcoming', registrant_count: 12 },
  { id: 'c1c1c1c1-0000-4000-8000-000000000002', title: 'Dọn rác Hồ Tây', start_at: new Date(Date.now() + 9 * 86400e3).toISOString(), end_at: null, location: 'Hồ Tây', campaign_status: 'upcoming', registrant_count: 0 },
];

// ---- bảng cho luồng bài đăng (PostgREST đơn giản) ----
const known = {
  pollution_findings: ['id', 'thread_id', 'location_name', 'district', 'address', 'latitude', 'longitude', 'pollution_type', 'summary', 'observed_at', 'confidence', 'sources', 'images', 'selected', 'created_at', 'updated_at'],
  content_drafts: ['id', 'thread_id', 'finding_id', 'created_by', 'status', 'current_version', 'approved_version', 'cleanup_start_at', 'cleanup_end_at', 'meeting_point', 'contact', 'created_at', 'updated_at', 'approved_at', 'approved_by'],
  draft_versions: ['id', 'draft_id', 'version', 'website_payload', 'threads_payload', 'images', 'sources', 'preview_url', 'file_url', 'feedback', 'created_by', 'created_at'],
  publication_jobs: ['id', 'draft_id', 'draft_version', 'channel', 'status', 'publish_at', 'provider_post_id', 'published_url', 'error_message', 'attempts', 'requested_by', 'created_at', 'updated_at', 'published_at'],
  posts: ['id', 'title', 'slug', 'content', 'excerpt', 'image_url', 'source_name', 'source_url', 'category', 'status', 'author_id', 'published_at', 'created_at', 'updated_at'],
};
const required = { pollution_findings: ['thread_id', 'location_name', 'pollution_type', 'summary'], content_drafts: ['thread_id', 'created_by', 'cleanup_start_at'], draft_versions: ['draft_id', 'version'], publication_jobs: ['draft_id', 'draft_version', 'channel', 'requested_by'], posts: ['title', 'slug'] };
const unique = { publication_jobs: ['draft_id', 'draft_version', 'channel'], posts: ['slug'], draft_versions: ['draft_id', 'version'] };
const db = Object.fromEntries(Object.keys(known).map((t) => [t, []]));
db.announcements = [];
const LOG = [];
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };

function matchRow(row, params) {
  for (const [k, v] of params) {
    if (['select', 'limit', 'order'].includes(k)) continue;
    if (k === 'and') {
      for (const c of v.replace(/^\(|\)$/g, '').split(',')) {
        const m = /^([a-z_]+)\.eq\.(.*)$/.exec(c);
        if (m && String(row[m[1]]) !== m[2]) return false;
      }
      continue;
    }
    const eq = /^eq\.(.*)$/.exec(v);
    if (eq && String(row[k]) !== eq[1]) return false;
    const lte = /^lte\.(.*)$/.exec(v);
    if (lte && !(Date.parse(row[k]) <= Date.parse(lte[1]))) return false;
  }
  return true;
}

// ---- RPC giai đoạn 1 (mô phỏng đúng mã status của hợp đồng) ----
const SIGNATURES = {
  prepare_admin_agent_turn: { args: ['requested_user_id', 'requested_thread_id', 'requested_message', 'requested_client_message_id'], optional: [] },
  finalize_admin_agent_turn: { args: ['requested_thread_id', 'assistant_message', 'requested_workflow_state'], optional: [] },
  claim_publication_job: { args: ['p_job_id', 'p_stale_after'], optional: [] },
  find_announcement_campaigns: { args: ['p_query', 'p_limit'], optional: ['p_limit'] },
  announcement_campaign_registrants: { args: ['p_campaign_id'], optional: [] },
  upsert_announcement_draft: { args: ['p_thread_id', 'p_admin_id', 'p_campaign_id', 'p_subject', 'p_body'], optional: [] },
  get_announcement: { args: ['p_thread_id', 'p_announcement_id'], optional: ['p_announcement_id'] },
  request_announcement_test: { args: ['p_thread_id', 'p_admin_id', 'p_announcement_id', 'p_version'], optional: [] },
  approve_announcement: { args: ['p_thread_id', 'p_admin_id', 'p_announcement_id', 'p_version', 'p_confirmation_text', 'p_turn_started_at'], optional: [] },
  cancel_announcement: { args: ['p_thread_id', 'p_admin_id', 'p_announcement_id'], optional: [] },
};

const campaignOf = (id) => CAMPAIGNS.find((c) => c.id === id);
const view = (a) => {
  if (a.status === 'approved' && a.polled) { a.status = 'sending'; a.progress = { pending: a.recipient_count - 3, sent: 3, failed: 0, skipped: 0 }; }
  if (a.status === 'approved') a.polled = true;
  const c = campaignOf(a.campaign_id);
  return { id: a.id, status: a.status, version: a.version, subject: a.subject, body_text: a.body_text, campaign: { id: c.id, title: c.title, start_at: c.start_at, end_at: c.end_at, location: c.location }, registrant_count: c.registrant_count, test: a.test, approved_version: a.approved_version, approved_at: a.approved_at, recipient_count: a.recipient_count, progress: a.progress, updated_at: a.updated_at };
};
const gate = (b, announcementId) => {
  if (b.p_admin_id !== ADMIN || b.p_thread_id !== THREAD) return { status: 'forbidden' };
  const a = db.announcements.find((x) => x.id === announcementId && x.thread_id === b.p_thread_id);
  return a ? { a } : { status: 'not_found' };
};
const IMPL = {
  prepare_admin_agent_turn: (b) => {
    if (!b.requested_message) return [400, { code: 'P0001', message: 'message_required' }];
    const last = db.content_drafts[db.content_drafts.length - 1] || null;
    return { thread_id: b.requested_thread_id || THREAD, state: {}, workflow_state: 'active', recent_messages: [{ role: 'user', content: b.requested_message }], findings: db.pollution_findings, draft: last };
  },
  finalize_admin_agent_turn: (b) => ({ thread_id: b.requested_thread_id, message: b.assistant_message, state: b.requested_workflow_state, findings: db.pollution_findings, draft: db.content_drafts[db.content_drafts.length - 1] || null }),
  claim_publication_job: (b) => {
    const now = Date.now();
    const j = db.publication_jobs.find((r) => r.id === b.p_job_id);
    if (j && ((j.status === 'scheduled' && (!j.publish_at || Date.parse(j.publish_at) <= now + 60000)) || j.status === 'failed' || ((j.status === 'queued' || j.status === 'publishing') && Date.parse(j.updated_at) < now - 600000))) {
      Object.assign(j, { status: 'publishing', attempts: (j.attempts || 0) + 1, error_message: null, updated_at: nowIso() });
      return [j];
    }
    return [];
  },
  find_announcement_campaigns: (b) => {
    if (typeof b.p_query !== 'string') return { status: 'invalid_input' };
    const q = b.p_query.toLowerCase();
    return { status: 'ok', campaigns: CAMPAIGNS.filter((c) => c.title.toLowerCase().includes(q)).slice(0, Math.min(10, b.p_limit || 5)) };
  },
  announcement_campaign_registrants: (b) => {
    const c = campaignOf(b.p_campaign_id);
    if (!c) return { status: 'campaign_not_found' };
    return { status: 'ok', campaign: { id: c.id, title: c.title, start_at: c.start_at, end_at: c.end_at, location: c.location }, registrant_count: c.registrant_count, max_recipients: MAX_RECIPIENTS, sample_names: c.registrant_count ? ['Nguyễn V. A.', 'Trần T. B.'] : [] };
  },
  upsert_announcement_draft: (b) => {
    if (b.p_admin_id !== ADMIN || b.p_thread_id !== THREAD) return { status: 'forbidden' };
    if (!campaignOf(b.p_campaign_id)) return { status: 'campaign_not_found' };
    if (!b.p_subject || b.p_subject.length > 150) return { status: 'invalid_input', field: 'subject', reason: b.p_subject ? 'too_long' : 'empty', max: 150 };
    if (!b.p_body || b.p_body.length > 5000) return { status: 'invalid_input', field: 'body', reason: b.p_body ? 'too_long' : 'empty', max: 5000 };
    let a = db.announcements.find((x) => x.thread_id === b.p_thread_id && x.campaign_id === b.p_campaign_id && x.status === 'draft');
    if (a && a.subject === b.p_subject && a.body_text === b.p_body) return { status: 'ok', created: false, unchanged: true, announcement: view(a) };
    const created = !a;
    if (!a) {
      a = { id: uuid(), thread_id: b.p_thread_id, campaign_id: b.p_campaign_id, status: 'draft', version: 0, test: { state: 'none' }, recipient_count: 0, approved_version: null, approved_at: null, progress: { pending: 0, sent: 0, failed: 0, skipped: 0 }, test_window: [] };
      db.announcements.push(a);
    }
    Object.assign(a, { version: a.version + 1, subject: b.p_subject, body_text: b.p_body, version_created_at: nowIso(), updated_at: nowIso(), test: { state: 'none' } });
    return { status: 'ok', created, unchanged: false, announcement: view(a) };
  },
  get_announcement: (b) => {
    const list = db.announcements.filter((x) => x.thread_id === b.p_thread_id);
    const a = b.p_announcement_id ? list.find((x) => x.id === b.p_announcement_id) : list[list.length - 1];
    return a ? { status: 'ok', announcement: view(a) } : { status: 'not_found' };
  },
  request_announcement_test: (b) => {
    const g = gate(b, b.p_announcement_id);
    if (!g.a) return { status: g.status };
    if (g.a.status !== 'draft') return { status: 'not_draft', announcement_status: g.a.status };
    if (g.a.version !== b.p_version) return { status: 'version_mismatch', current_version: g.a.version };
    g.a.test_window = g.a.test_window.filter((t) => t > Date.now() - 3600e3);
    if (g.a.test_window.length >= 5) return { status: 'rate_limited', retry_after_seconds: 1800 };
    g.a.test_window.push(Date.now());
    g.a.test = { state: 'pending', requested_version: g.a.version };
    return { status: 'queued', version: g.a.version, tests_left_this_hour: 5 - g.a.test_window.length };
  },
  approve_announcement: (b) => {
    const g = gate(b, b.p_announcement_id);
    if (!g.a) return { status: g.status };
    const a = g.a;
    if (a.status === 'cancelled') return { status: 'cancelled' };
    if (a.status !== 'draft') return { status: 'already_approved', announcement_status: a.status, version: a.approved_version, recipient_count: a.recipient_count };
    if (a.version !== b.p_version) return { status: 'version_mismatch', current_version: a.version };
    if (!String(b.p_confirmation_text || '').trim()) return { status: 'confirmation_required' };
    if (Number.isNaN(Date.parse(b.p_turn_started_at))) return { status: 'invalid_input', field: 'p_turn_started_at' };
    if (Date.parse(a.version_created_at) >= Date.parse(b.p_turn_started_at)) return { status: 'needs_admin_review' };
    const count = campaignOf(a.campaign_id).registrant_count;
    if (count === 0) return { status: 'no_recipients' };
    if (count > MAX_RECIPIENTS) return { status: 'too_many_recipients', count, max: MAX_RECIPIENTS };
    Object.assign(a, { status: 'approved', approved_version: a.version, approved_at: nowIso(), recipient_count: count, approval_text: b.p_confirmation_text, progress: { pending: count, sent: 0, failed: 0, skipped: 0 } });
    return { status: 'approved', announcement_id: a.id, version: a.version, recipient_count: count };
  },
  cancel_announcement: (b) => {
    const g = gate(b, b.p_announcement_id);
    if (!g.a) return { status: g.status };
    if (g.a.status === 'sent') return { status: 'already_sent' };
    if (g.a.status === 'cancelled') return { status: 'already_cancelled' };
    const skipped = g.a.progress.pending;
    Object.assign(g.a, { status: 'cancelled', progress: { ...g.a.progress, pending: 0, skipped: g.a.progress.skipped + skipped } });
    return { status: 'cancelled', skipped, sent_count: g.a.progress.sent };
  },
};

function handleRpc(name, body) {
  const sig = SIGNATURES[name];
  const args = body && typeof body === 'object' ? Object.keys(body) : [];
  const missing = sig ? sig.args.filter((a) => !sig.optional.includes(a) && !args.includes(a)) : [];
  const extra = sig ? args.filter((a) => !sig.args.includes(a)) : [];
  if (!sig || missing.length || extra.length) return [404, { code: 'PGRST202', message: `Could not find the function public.${name}(${args.join(', ')}) in the schema cache` }];
  const out = IMPL[name](body);
  return Array.isArray(out) && typeof out[0] === 'number' ? out : [200, out];
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    if (u.pathname === '/__log') {
      if (req.method === 'DELETE') { LOG.length = 0; return send(res, 200, { ok: true }); }
      return send(res, 200, LOG);
    }
    if (u.pathname === '/__db') return send(res, 200, db);
    LOG.push({ at: nowIso(), method: req.method, path: u.pathname, body });
    if (u.pathname === '/auth/v1/user') {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (token === 'admin-token') return send(res, 200, { id: ADMIN, email: 'admin@e2e.test' });
      if (token === 'user-token') return send(res, 200, { id: USER, email: 'user@e2e.test' });
      return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    }
    if (req.headers.authorization !== `Bearer ${SECRET}` || req.headers.apikey !== SECRET) return send(res, 401, { message: 'Invalid API key (mock)' });
    if (u.pathname === '/rest/v1/profiles') {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      return send(res, 200, id === ADMIN ? [{ id, role: 'admin' }] : id === USER ? [{ id, role: 'user' }] : []);
    }
    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u.pathname);
    if (rpc) {
      const [code, out] = handleRpc(rpc[1], body);
      return send(res, code, out);
    }
    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
    if (m && db[m[1]] && known[m[1]]) {
      const t = m[1];
      if (req.method === 'GET') {
        let rows = db[t].filter((r) => matchRow(r, u.searchParams));
        const l = u.searchParams.get('limit');
        if (l) rows = rows.slice(0, Number(l));
        return send(res, 200, rows);
      }
      if (req.method === 'POST') {
        const out = [];
        for (const b of Array.isArray(body) ? body : [body]) {
          const unk = Object.keys(b).filter((k) => !known[t].includes(k));
          if (unk.length) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${unk[0]}' column of '${t}'` });
          for (const k of required[t]) if (b[k] === undefined || b[k] === null || b[k] === '') return send(res, 400, { code: '23502', message: `null value in column "${k}" violates not-null constraint` });
          if (unique[t] && db[t].some((r) => unique[t].every((k) => String(r[k]) === String(b[k])))) return send(res, 409, { code: '23505', message: `duplicate key value violates unique constraint on ${t}` });
          const row = { id: uuid(), created_at: nowIso(), updated_at: nowIso(), ...(t === 'content_drafts' ? { status: 'draft', current_version: 1 } : {}), ...b };
          db[t].push(row);
          out.push(row);
        }
        return send(res, 201, out);
      }
      if (req.method === 'PATCH') {
        const rows = db[t].filter((r) => matchRow(r, u.searchParams));
        for (const r of rows) Object.assign(r, body);
        return send(res, 200, rows);
      }
    }
    return send(res, 404, { message: 'mock: not found ' + req.url });
  });
});

module.exports = { ADMIN, USER, THREAD, SECRET, CAMPAIGNS };

if (require.main === module) {
  if (!process.env.HNX_E2E_MOCK) {
    console.log('mock-supabase: đặt HNX_E2E_MOCK=1 để chạy (dùng bởi run-e2e.sh).');
    process.exit(0);
  }
  server.listen(Number(process.env.HNX_MOCK_SUPABASE_PORT || 19999), process.env.HNX_MOCK_BIND || '127.0.0.1', () => console.log('mock supabase sẵn sàng'));
}

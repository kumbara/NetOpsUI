// Hermes adapter (hermes-agent gateway, platform `api_server`).
//
// Threads are Hermes sessions (/api/sessions), persisted server-side. Each
// turn is a run: POST /v1/runs starts it bound to the session, then
// GET /v1/runs/{id}/events streams lifecycle events. The runs API (rather than
// /api/sessions/{id}/chat/stream) is used because only runs emit
// `approval.request` and accept /approval and /stop.
//
// The API key (API_SERVER_KEY) is kept in the manager's database and injected by
// the nginx proxy (auth_request) — never here, and not in an environment variable.
import { http, ensureOk, readSSE, toDate, contentText, uuid } from './common.js';
import { mgr, getActiveProfile } from '../manager.js';

const BASE = '/backend/hermes';
const _runs = {}; // threadId → run_id of the in-flight run

function summary(s) {
  const created = toDate(s.started_at) || new Date();
  return {
    id: s.id,
    title: s.title || s.preview || 'New Chat',
    createdAt: created,
    updatedAt: toDate(s.last_active) || created,
    lastMessage: s.preview || '',
  };
}

export const hermes = {
  id: 'hermes',
  label: 'Hermes Agent',
  shortLabel: 'Hermes',
  description: 'Agent Hermes (NousResearch) lewat gateway api_server: session tersimpan di server, approval command berisiko, stop, dan skills.',
  capabilities: {
    approval: true,
    stop: 'interrupt',
    serverThreads: true,
    credential: true,     // needs an API key, managed in Settings > Backend
    jobs: true,           // scheduled (cron) jobs via /api/jobs
    devices: true,        // node inventory shared with NetOps Agent
  },

  // Cron jobs: agent runs on a schedule. Fields used by the dashboard:
  // id, name, schedule_display, state, enabled, last_run_at, next_run_at, last_status, last_error.
  async listJobs() {
    const r = await http(BASE, '/api/jobs?include_disabled=true');
    return r?.jobs || [];
  },

  async runJob(id) {
    await http(BASE, `/api/jobs/${encodeURIComponent(id)}/run`, { method: 'POST' });
  },

  async pauseJob(id) {
    await http(BASE, `/api/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST' });
  },

  async resumeJob(id) {
    await http(BASE, `/api/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' });
  },

  async health() {
    const h = await http(BASE, '/health');
    let model = '—';
    try {
      const m = await http(BASE, '/v1/models');
      model = m?.data?.[0]?.id || model;
    } catch { /* /health is enough to call it reachable */ }
    return { ok: h?.status === 'ok', model, detail: h?.version ? `hermes-agent ${h.version}` : '' };
  },

  async listThreads() {
    const r = await http(BASE, '/api/sessions?limit=50&source=api_server');
    return (r?.data || []).map(summary);
  },

  async createThread() {
    const r = await http(BASE, '/api/sessions', { method: 'POST', body: { id: uuid() } });
    return summary(r.session);
  },

  async loadMessages(id) {
    const r = await http(BASE, `/api/sessions/${encodeURIComponent(id)}/messages`);
    return (r?.data || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role === 'assistant' ? 'agent' : 'user', content: contentText(m.content) }))
      .filter(m => m.content);
  },

  async renameThread(id, title) {
    await http(BASE, `/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title } });
  },

  async deleteThread(id) {
    await http(BASE, `/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async send(threadId, text, emit) {
    const body = { input: text, session_id: threadId };
    const slug = getActiveProfile();
    if (slug) {
      // The profile prompt rides along as the run's ephemeral system prompt.
      try { body.instructions = (await mgr('/profiles/' + encodeURIComponent(slug))).prompt; }
      catch (e) { emit({ type: 'note', text: `Profil "${slug}" tidak dimuat (${e.message}); dijalankan tanpa profil.` }); }
    }
    const start = await http(BASE, '/v1/runs', { method: 'POST', body });
    const runId = start.run_id;
    _runs[threadId] = runId;
    let streamed = false;
    try {
      const r = await fetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}/events`);
      await ensureOk(r, '/v1/runs/{id}/events');
      await readSSE(r, ({ data: ev }) => {
        if (!ev || typeof ev !== 'object') return;
        switch (ev.event) {
          case 'message.delta':
            streamed = true;
            emit({ type: 'delta', text: ev.delta || '' });
            break;
          case 'message.interim':
            emit({ type: 'note', text: ev.text || '' });
            break;
          case 'reasoning.available':
            if (ev.text) emit({ type: 'thinking', text: ev.text });
            break;
          case 'tool.started':
            emit({ type: 'tool_start', name: ev.tool, detail: ev.preview || '' });
            break;
          case 'tool.completed':
            emit({
              type: 'tool_end', name: ev.tool, detail: ev.preview || '',
              durationMs: (ev.duration || 0) * 1000, error: !!ev.error,
            });
            break;
          case 'subagent.start':
          case 'subagent.complete':
            emit({ type: 'note', text: `${ev.event}${ev.preview ? ': ' + ev.preview : ''}` });
            break;
          case 'approval.request':
            emit({
              type: 'approval',
              data: {
                action: ev.command || ev.description || '—',
                description: ev.description || '',
                choices: ev.choices || ['once', 'deny'],
                requestId: ev.request_id || null,
              },
            });
            break;
          case 'approval.responded':
            emit({ type: 'note', text: `Approval: ${ev.choice}` });
            break;
          case 'run.completed':
            // Deltas already carried the text; `output` is the fallback when
            // the provider did not stream.
            if (!streamed && ev.output) emit({ type: 'delta', text: ev.output });
            break;
          case 'run.failed':
            emit({ type: 'error', text: ev.error || 'Run gagal' });
            break;
          case 'run.cancelled':
          case 'run.interrupted':
            emit({ type: 'stopped', text: ev.error || 'Run dihentikan.' });
            break;
        }
      });
    } finally {
      delete _runs[threadId];
    }
  },

  async stop(threadId) {
    const runId = _runs[threadId];
    if (!runId) return { ok: false };
    await http(BASE, `/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', body: {} });
    return { ok: true };
  },

  // choice: 'once' | 'session' | 'always' | 'deny'
  async respondApproval(threadId, choice, requestId) {
    const runId = _runs[threadId];
    if (!runId) throw new Error('Tidak ada run aktif');
    const body = { choice };
    if (requestId) body.request_id = requestId;
    await http(BASE, `/v1/runs/${encodeURIComponent(runId)}/approval`, { method: 'POST', body });
  },

  // Node inventory: shared with the NetOps Agent (palapa) - same inventory.yaml,
  // so nodes added here are visible to both backends.
  async addDevice(device) {
    return http('/backend/netops', '/devices', { method: 'POST', body: device });
  },

  async listDevices() {
    return (await http('/backend/netops', '/devices')) || [];
  },

  async updateDevice(name, device) {
    return http('/backend/netops', '/devices/' + encodeURIComponent(name), { method: 'PATCH', body: device });
  },

  async deleteDevice(name) {
    return http('/backend/netops', '/devices/' + encodeURIComponent(name), { method: 'DELETE' });
  },

  async listSkills() {
    const r = await http(BASE, '/v1/skills');
    return (r?.data || []).map(s => ({
      name: s.name,
      description: s.description || '',
      tags: s.category ? [s.category] : [],
    }));
  },
};

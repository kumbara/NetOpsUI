// Tasks: scheduled agent jobs (server/scheduler.py). Manager-owned like Skills.
import { $, esc, pageHeader, loadingHtml, errorHtml, badge, confirmDialog, fmtFullDateTime, alertDialog } from '../utils.js';
import { mgr } from '../manager.js';

const PRESETS = [
  { label: 'Setiap 10 menit', trigger: { type: 'interval', minutes: 10 } },
  { label: 'Setiap 1 jam', trigger: { type: 'interval', minutes: 60 } },
  { label: 'Setiap hari 08:00', trigger: { type: 'cron', hour: 8, minute: 0 } },
  { label: 'Setiap Senin 08:00', trigger: { type: 'cron', day_of_week: 'mon', hour: 8, minute: 0 } },
  { label: 'Setiap jam kerja (08-17, tiap jam)', trigger: { type: 'cron', hour: '8-17', minute: 0 } },
];

function triggerLabel(t) {
  if (!t) return '—';
  if (t.type === 'interval') return `Setiap ${t.minutes} menit`;
  const parts = [];
  if (t.day_of_week) parts.push({ mon: 'Senin', tue: 'Selasa', wed: 'Rabu', thu: 'Kamis', fri: 'Jumat', sat: 'Sabtu', sun: 'Minggu' }[t.day_of_week] || t.day_of_week);
  if (t.day) parts.push(`hari ${t.day}`);
  if (t.month) parts.push(`bulan ${t.month}`);
  const hm = `${String(t.hour ?? '*').padStart(2, '0')}:${String(t.minute ?? 0).padStart(2, '0')}`;
  parts.push(t.hour === '*' && t.minute === '*' ? `tiap menit` : hm);
  return parts.join(' ');
}

function statusBadge(s) {
  const m = { success: ['berhasil', 'green'], failed: ['gagal', 'red'], running: ['berjalan', 'yellow'] };
  const [l, v] = m[s] || [s, 'gray'];
  return badge(l, v);
}

export async function screenTasks(c) {
  c.innerHTML = `<div class="p-6 max-w-[1600px] mx-auto">
    ${pageHeader('Tasks', 'Jadwal eksekusi agent — prompt dijalankan otomatis, hasilnya tersimpan dan bisa dilihat di AI Chat.',
      `<button id="btn-new-task" class="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-body-sm font-medium hover:opacity-90 transition-opacity">
        <span class="material-symbols-outlined text-lg">add</span>Jadwal Baru</button>`)}
    <div id="tasks-body">${loadingHtml('Memuat jadwal...')}</div>
  </div>`;
  $('btn-new-task').onclick = () => taskForm();
  await loadTasks();
}

async function loadTasks() {
  const body = $('tasks-body');
  try {
    const { schedules, runs } = await mgr('/schedules');
    if (!schedules.length) {
      body.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-12 flex flex-col items-center text-center">
        <span class="material-symbols-outlined text-5xl text-outline-variant mb-3">schedule</span>
        <h3 class="text-title-sm font-title-sm text-primary mb-1">Belum ada jadwal</h3>
        <p class="text-body-sm text-on-surface-variant max-w-md">Buat jadwal pertama — misalnya "Audit WLC zona FP tiap Senin 08:00" atau "Cek status 10.0.20.25 tiap 10 menit".</p>
      </div>`;
      return;
    }
    const runsBySched = {};
    for (const r of runs) (runsBySched[r.schedule_id] ||= []).push(r);
    body.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-x-auto mb-6">
        <table class="w-full text-body-sm">
          <thead><tr class="border-b border-outline-variant text-left text-on-surface-variant">
            <th class="px-4 py-3">Nama</th><th class="px-4 py-3">Jadwal</th><th class="px-4 py-3">Backend</th>
            <th class="px-4 py-3">Aktif</th><th class="px-4 py-3">Run Terakhir</th><th class="px-4 py-3 text-right">Aksi</th>
          </tr></thead>
          <tbody>${schedules.map(s => {
            const last = (runsBySched[s.id] || [])[0];
            return `<tr class="border-b border-outline-variant/40 hover:bg-surface-container-low">
              <td class="px-4 py-3 font-medium text-on-surface">${esc(s.name)}</td>
              <td class="px-4 py-3 text-on-surface-variant">${esc(triggerLabel(s.trigger))}</td>
              <td class="px-4 py-3 text-on-surface-variant">${s.backend === 'netops' ? 'NetOps Agent' : 'Hermes'}</td>
              <td class="px-4 py-3"><label class="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" data-toggle="${esc(s.id)}" ${s.enabled ? 'checked' : ''} class="accent-primary w-4 h-4"></label></td>
              <td class="px-4 py-3">${last ? `${statusBadge(last.status)} <span class="text-on-surface-variant text-xs ml-1">${esc(fmtFullDateTime(new Date(last.started_at * 1000)))}</span>` : '<span class="text-on-surface-variant">belum pernah</span>'}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button data-run="${esc(s.id)}" title="Jalankan sekarang" class="p-1.5 text-primary hover:bg-surface-container rounded"><span class="material-symbols-outlined text-lg">play_arrow</span></button>
                <button data-edit="${esc(s.id)}" title="Edit" class="p-1.5 text-on-surface-variant hover:bg-surface-container rounded"><span class="material-symbols-outlined text-lg">edit</span></button>
                <button data-del="${esc(s.id)}" title="Hapus" class="p-1.5 text-red-600 hover:bg-surface-container rounded"><span class="material-symbols-outlined text-lg">delete</span></button>
              </td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <h3 class="text-title-sm font-title-sm text-on-surface mb-2">Riwayat Run</h3>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead><tr class="border-b border-outline-variant text-left text-on-surface-variant">
            <th class="px-4 py-3">Waktu</th><th class="px-4 py-3">Jadwal</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Durasi</th><th class="px-4 py-3 text-right">Output</th>
          </tr></thead>
          <tbody>${runs.length ? runs.map(r => `<tr class="border-b border-outline-variant/40 hover:bg-surface-container-low">
            <td class="px-4 py-2 text-on-surface-variant">${esc(fmtFullDateTime(new Date(r.started_at * 1000)))}</td>
            <td class="px-4 py-2 text-on-surface">${esc(r.schedule_name || r.schedule_id)}</td>
            <td class="px-4 py-2">${statusBadge(r.status)}${r.error ? `<span class="text-xs text-red-600 ml-2" title="${esc(r.error)}">⚠</span>` : ''}</td>
            <td class="px-4 py-2 text-on-surface-variant">${r.finished_at ? Math.round((r.finished_at - r.started_at)) + ' dtk' : '—'}</td>
            <td class="px-4 py-2 text-right"><button data-view="${esc(r.id)}" class="text-primary hover:underline text-body-sm">lihat</button></td>
          </tr>`).join('') : '<tr><td colspan="5" class="px-4 py-6 text-center text-on-surface-variant">Belum ada run.</td></tr>'}</tbody>
        </table>
      </div>`;
    body.querySelectorAll('[data-toggle]').forEach(el => el.onchange = async () => {
      const s = await mgr(`/schedules/${el.dataset.toggle}`, { method: 'PUT', body: { enabled: el.checked } });
      await loadTasks();
    });
    body.querySelectorAll('[data-run]').forEach(el => el.onclick = async () => {
      el.disabled = true;
      try { await mgr(`/schedules/${el.dataset.run}/run`, { method: 'POST' }); alertDialog('Job dijalankan — pantau di riwayat run.'); }
      catch (e) { alertDialog(e.message, 'Gagal menjalankan'); }
      await loadTasks();
    });
    body.querySelectorAll('[data-edit]').forEach(el => el.onclick = () => taskForm(el.dataset.edit));
    body.querySelectorAll('[data-del]').forEach(el => el.onclick = async () => {
      if (!await confirmDialog({ title: 'Hapus jadwal', message: 'Jadwal dan riwayatnya akan dihapus permanen.', confirmLabel: 'Hapus', danger: true })) return;
      await mgr(`/schedules/${el.dataset.del}`, { method: 'DELETE' });
      await loadTasks();
    });
    body.querySelectorAll('[data-view]').forEach(el => el.onclick = () => viewRun(el.dataset.view));
  } catch (e) {
    body.innerHTML = errorHtml(e.message);
  }
}

async function viewRun(runId) {
  const r = (await mgr('/schedules/runs/' + runId));
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/30 backdrop-blur-sm z-[300] flex items-center justify-center';
  overlay.innerHTML = `<div class="bg-surface-container-lowest rounded-xl shadow-xl max-w-[760px] w-full mx-4 overflow-hidden">
    <div class="p-4 border-b border-outline-variant flex items-center justify-between">
      <h3 class="text-title-sm font-title-sm font-bold text-on-surface">${esc(r.schedule_name || 'Run')}</h3>
      <button data-close class="p-1 text-on-surface-variant hover:text-on-surface"><span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="p-4 max-h-[70vh] overflow-y-auto text-body-sm text-on-surface whitespace-pre-wrap font-mono">${esc(r.output || r.error || '(kosong)')}</div>
  </div>`;
  overlay.onclick = e => { if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove(); };
  document.body.appendChild(overlay);
}

function taskForm(editId) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/30 backdrop-blur-sm z-[300] flex items-center justify-center';
  overlay.innerHTML = `<div class="bg-surface-container-lowest rounded-xl shadow-xl max-w-[560px] w-full mx-4 overflow-hidden">
    <div class="p-4 border-b border-outline-variant"><h3 class="text-title-sm font-title-sm font-bold text-on-surface">${editId ? 'Edit Jadwal' : 'Jadwal Baru'}</h3></div>
    <div class="p-6 space-y-4 text-body-sm">
      <div><label class="block text-on-surface-variant mb-1">Nama</label>
        <input id="tf-name" class="w-full border border-outline-variant rounded-lg px-3 py-2 bg-surface-container-lowest text-on-surface" placeholder="Audit WLC zona FP"></div>
      <div><label class="block text-on-surface-variant mb-1">Prompt (apa yang dijalankan agent)</label>
        <textarea id="tf-prompt" rows="4" class="w-full border border-outline-variant rounded-lg px-3 py-2 bg-surface-container-lowest text-on-surface font-mono text-xs" placeholder="Cek status device 10.0.20.25 dan laporkan ringkasan"></textarea></div>
      <div class="grid grid-cols-2 gap-4">
        <div><label class="block text-on-surface-variant mb-1">Jadwal</label>
          <select id="tf-preset" class="w-full border border-outline-variant rounded-lg px-3 py-2 bg-surface-container-lowest text-on-surface">
            ${PRESETS.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}
          </select></div>
        <div><label class="block text-on-surface-variant mb-1">Backend</label>
          <select id="tf-backend" class="w-full border border-outline-variant rounded-lg px-3 py-2 bg-surface-container-lowest text-on-surface">
            <option value="netops">NetOps Agent</option><option value="hermes">Hermes</option>
          </select></div>
      </div>
    </div>
    <div class="px-6 pb-6 flex justify-end gap-3">
      <button data-close class="px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg text-body-sm font-medium hover:bg-surface-container">Batal</button>
      <button data-save class="px-4 py-2 bg-primary text-white rounded-lg text-body-sm font-medium hover:opacity-90">Simpan</button>
    </div>
  </div>`;
  overlay.onclick = e => { if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove(); };
  document.body.appendChild(overlay);

  if (editId) {
    mgr('/schedules/' + editId).then(s => {
      $('tf-name').value = s.name;
      $('tf-prompt').value = s.prompt;
      $('tf-backend').value = s.backend;
      const idx = PRESETS.findIndex(p => JSON.stringify(p.trigger) === JSON.stringify(s.trigger));
      $('tf-preset').value = idx >= 0 ? idx : 0;
    }).catch(() => {});
  }

  overlay.querySelector('[data-save]').onclick = async () => {
    const name = $('tf-name').value.trim();
    const prompt = $('tf-prompt').value.trim();
    if (!name || !prompt) { alertDialog('Nama dan prompt wajib diisi.'); return; }
    const body = { name, prompt, trigger: PRESETS[+$('tf-preset').value].trigger, backend: $('tf-backend').value };
    try {
      if (editId) await mgr('/schedules/' + editId, { method: 'PUT', body });
      else await mgr('/schedules', { method: 'POST', body });
      overlay.remove();
      await loadTasks();
    } catch (e) { alertDialog(e.message, 'Gagal menyimpan'); }
  };
}
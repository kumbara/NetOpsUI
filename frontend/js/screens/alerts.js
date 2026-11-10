// Alerts: notification channels (server/notify.py) + send log.
import { $, esc, pageHeader, loadingHtml, errorHtml, badge, confirmDialog, fmtFullDateTime, alertDialog } from '../utils.js';
import { mgr } from '../manager.js';

const TYPE_FIELDS = {
  webhook: [
    { key: 'url', label: 'URL Webhook', ph: 'https://example.com/hook', req: true },
    { key: 'secret', label: 'Secret (opsional, header X-NetOpsUI-Signature)', ph: '' },
  ],
  telegram: [
    { key: 'token', label: 'Bot Token', ph: '123456:ABC...', req: true, secret: true },
    { key: 'chat_id', label: 'Chat ID', ph: '167540179', req: true },
  ],
  email: [
    { key: 'host', label: 'SMTP Host', ph: 'smtp.ub.ac.id', req: true },
    { key: 'port', label: 'Port', ph: '587' },
    { key: 'user', label: 'User', ph: 'netopsui@ub.ac.id', req: true },
    { key: 'password', label: 'Password', ph: '', req: true, secret: true },
    { key: 'to', label: 'Tujuan', ph: 'kumbara@ub.ac.id', req: true },
  ],
};

export async function screenAlerts(c) {
  c.innerHTML = `<div class="p-6 max-w-[1600px] mx-auto">
    ${pageHeader('Alerts', 'Kanal notifikasi untuk hasil job terjadwal dan alert sistem.',
      `<button id="btn-new-chan" class="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-body-sm font-medium hover:opacity-90 transition-opacity">
        <span class="material-symbols-outlined text-lg">add</span>Kanal Baru</button>`)}
    <div id="alerts-body">${loadingHtml('Memuat kanal...')}</div>
  </div>`;
  $('btn-new-chan').onclick = () => channelForm();
  await loadAlerts();
}

async function loadAlerts() {
  const body = $('alerts-body');
  try {
    const { channels } = await mgr('/notify/channels');
    const { log } = await mgr('/notify/log?limit=50');
    body.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-x-auto mb-6">
        <table class="w-full text-body-sm">
          <thead><tr class="border-b border-outline-variant text-left text-on-surface-variant">
            <th class="px-4 py-3">Nama</th><th class="px-4 py-3">Tipe</th><th class="px-4 py-3">Detail</th>
            <th class="px-4 py-3">Aktif</th><th class="px-4 py-3 text-right">Aksi</th>
          </tr></thead>
          <tbody>${channels.length ? channels.map(ch => `<tr class="border-b border-outline-variant/40 hover:bg-surface-container-low">
            <td class="px-4 py-3 font-medium text-on-surface">${esc(ch.name)}</td>
            <td class="px-4 py-3 text-on-surface-variant">${ch.type}</td>
            <td class="px-4 py-3 text-on-surface-variant text-xs">${esc(channelDetail(ch))}</td>
            <td class="px-4 py-3"><input type="checkbox" data-toggle="${esc(ch.id)}" ${ch.enabled ? 'checked' : ''} class="accent-primary w-4 h-4"></td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              <button data-test="${esc(ch.id)}" title="Kirim tes" class="p-1.5 text-primary hover:bg-surface-container rounded"><span class="material-symbols-outlined text-lg">send</span></button>
              <button data-edit="${esc(ch.id)}" title="Edit" class="p-1.5 text-on-surface-variant hover:bg-surface-container rounded"><span class="material-symbols-outlined text-lg">edit</span></button>
              <button data-del="${esc(ch.id)}" title="Hapus" class="p-1.5 text-red-600 hover:bg-surface-container rounded"><span class="material-symbols-outlined text-lg">delete</span></button>
            </td></tr>`).join('')
          : `<tr><td colspan="5" class="px-4 py-8 text-center text-on-surface-variant">Belum ada kanal. Tambahkan Telegram, webhook, atau email.</td></tr>`}</tbody>
        </table>
      </div>
      <h3 class="text-title-sm font-title-sm text-on-surface mb-2">Log Pengiriman</h3>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead><tr class="border-b border-outline-variant text-left text-on-surface-variant">
            <th class="px-4 py-3">Waktu</th><th class="px-4 py-3">Kanal</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Detail</th>
          </tr></thead>
          <tbody>${log.length ? log.map(l => `<tr class="border-b border-outline-variant/40">
            <td class="px-4 py-2 text-on-surface-variant">${esc(fmtFullDateTime(new Date(l.sent_at * 1000)))}</td>
            <td class="px-4 py-2 text-on-surface">${esc(l.channel)}</td>
            <td class="px-4 py-2">${l.ok ? badge('ok', 'green') : badge('gagal', 'red')}</td>
            <td class="px-4 py-2 text-on-surface-variant text-xs max-w-[400px] truncate" title="${esc(l.detail)}">${esc(l.detail)}</td>
          </tr>`).join('') : '<tr><td colspan="4" class="px-4 py-6 text-center text-on-surface-variant">Belum ada pengiriman.</td></tr>'}</tbody>
        </table>
      </div>`;
    body.querySelectorAll('[data-toggle]').forEach(el => el.onchange = async () => {
      try {
        const { channels } = await mgr('/notify/channels');
        const ch = channels.find(x => x.id === el.dataset.toggle);
        if (ch) await mgr('/notify/channels/' + ch.id, { method: 'PUT', body: { name: ch.name, type: ch.type, config: ch.config, enabled: el.checked } });
      } catch (e) { /* ignore */ }
      await loadAlerts();
    });
    body.querySelectorAll('[data-test]').forEach(el => el.onclick = async () => {
      const r = await mgr('/notify/channels/' + el.dataset.test + '/test', { method: 'POST' });
      if (r.ok) alertDialog('Notifikasi tes terkirim. Cek tujuan Anda.');
      else alertDialog('Gagal: ' + r.detail, 'Tes Gagal');
      await loadAlerts();
    });
    body.querySelectorAll('[data-edit]').forEach(el => el.onclick = () => channelForm(el.dataset.edit));
    body.querySelectorAll('[data-del]').forEach(el => el.onclick = async () => {
      if (!await confirmDialog({ title: 'Hapus kanal', message: 'Kanal notifikasi akan dihapus.', confirmLabel: 'Hapus', danger: true })) return;
      await mgr('/notify/channels/' + el.dataset.del, { method: 'DELETE' });
      await loadAlerts();
    });
  } catch (e) {
    body.innerHTML = errorHtml(e.message);
  }
}

function channelDetail(ch) {
  const c = ch.config || {};
  if (ch.type === 'webhook') return c.url || '';
  if (ch.type === 'telegram') return 'chat_id: ' + (c.chat_id || '?');
  if (ch.type === 'email') return `${c.host || ''}:${c.port || ''} → ${c.to || ''}`;
  return '';
}

function channelForm(editId) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/30 backdrop-blur-sm z-[300] flex items-center justify-center';
  overlay.innerHTML = `<div class="bg-surface-container-lowest rounded-xl shadow-xl max-w-[520px] w-full mx-4 overflow-hidden">
    <div class="p-4 border-b border-outline-variant"><h3 class="text-title-sm font-title-sm font-bold text-on-surface">${editId ? 'Edit Kanal' : 'Kanal Baru'}</h3></div>
    <div class="p-6 space-y-4 text-body-sm">
      <div class="grid grid-cols-2 gap-4">
        <div><label class="block text-on-surface-variant mb-1">Nama</label>
          <input id="cf-name" class="w-full border border-outline-variant rounded-lg px-3 py-2 bg-surface-container-lowest text-on-surface" placeholder="Telegram Kumbara"></div>
        <div><label class="block text-on-surface-variant mb-1">Tipe</label>
          <select id="cf-type" class="w-full border border-outline-variant rounded-lg px-3 py-2 bg-surface-container-lowest text-on-surface">
            <option value="telegram">Telegram</option><option value="webhook">Webhook</option><option value="email">Email (SMTP)</option>
          </select></div>
      </div>
      <div id="cf-fields" class="space-y-3"></div>
    </div>
    <div class="px-6 pb-6 flex justify-end gap-3">
      <button data-close class="px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg text-body-sm font-medium hover:bg-surface-container">Batal</button>
      <button data-save class="px-4 py-2 bg-primary text-white rounded-lg text-body-sm font-medium hover:opacity-90">Simpan</button>
    </div>
  </div>`;
  overlay.onclick = e => { if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove(); };
  document.body.appendChild(overlay);

  function renderFields() {
    const type = $('cf-type').value;
    $('cf-fields').innerHTML = TYPE_FIELDS[type].map(f => `
      <div><label class="block text-on-surface-variant mb-1">${esc(f.label)}${f.req ? ' *' : ''}</label>
        <input id="cf-${f.key}" type="${f.secret ? 'password' : 'text'}"
          class="w-full border border-outline-variant rounded-lg px-3 py-2 bg-surface-container-lowest text-on-surface"
          placeholder="${esc(f.ph || '')}" ${f.secret ? 'autocomplete="new-password"' : ''}></div>`).join('');
  }
  $('cf-type').onchange = renderFields;
  renderFields();

  if (editId) {
    mgr('/notify/channels').then(({ channels }) => {
      const ch = channels.find(x => x.id === editId);
      if (!ch) return;
      $('cf-name').value = ch.name;
      $('cf-type').value = ch.type;
      renderFields();
      for (const f of TYPE_FIELDS[ch.type]) {
        const el = $('cf-' + f.key);
        if (el) el.value = ch.config[f.key] === '***' ? '' : (ch.config[f.key] || '');
      }
    }).catch(() => {});
  }

  overlay.querySelector('[data-save]').onclick = async () => {
    const type = $('cf-type').value;
    const config = {};
    for (const f of TYPE_FIELDS[type]) {
      const v = ($('cf-' + f.key).value || '').trim();
      if (f.req && !v) { alertDialog(`Field "${f.label}" wajib diisi.`); return; }
      config[f.key] = v;
    }
    const body = { name: $('cf-name').value.trim(), type, config };
    if (!body.name) { alertDialog('Nama wajib diisi.'); return; }
    try {
      if (editId) await mgr('/notify/channels/' + editId, { method: 'PUT', body });
      else await mgr('/notify/channels', { method: 'POST', body });
      overlay.remove();
      await loadAlerts();
    } catch (e) { alertDialog(e.message, 'Gagal menyimpan'); }
  };
}
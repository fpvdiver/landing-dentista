/* =========================================================
   CRM API – OdontoCRM (n8n + Supabase)  [UMD/Browser]
   ========================================================= */
(function () {
  /* ===================== CONFIG ===================== */
  function getBase() {
    const b = (window.CRM_API_BASE || 'https://allnsnts.app.n8n.cloud/webhook/odonto');
    return String(b).replace(/\/+$/, '');
  }
  const urlJoin = (p) => (p.startsWith('/') ? p : '/' + p);
  const url = (p) => getBase() + urlJoin(p);

  function buildHeaders(method, hasBody, extra) {
    const h = {
      Accept: 'application/json',
      ...(window.CRM_API_KEY ? { 'x-crm-key': window.CRM_API_KEY } : {}),
      ...(extra || {}),
    };
    // Evitar preflight desnecessário em GET
    if (hasBody && method !== 'GET') h['Content-Type'] = 'application/json';
    return h;
  }

  async function api(path, { method = 'GET', body, headers } = {}) {
    const hasBody = body !== undefined && body !== null;
    const res = await fetch(url(path), {
      method,
      headers: buildHeaders(method, hasBody, headers),
      body: hasBody ? JSON.stringify(body) : undefined,
      mode: 'cors',
      cache: 'no-store',
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      const msg = (data && (data.message || data.error?.message)) || res.statusText || 'Erro na API';
      throw new Error(msg);
    }
    return data;
  }

  /* ===================== UTILS ===================== */
  const toBRL = (v) => (Number(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const qs = (obj) => {
    const p = new URLSearchParams();
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
    });
    const s = p.toString();
    return s ? '?' + s : '';
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms || 250); }; };

  /* ===================== CEP (ViaCEP) ===================== */
  async function buscaCEP(cepRaw) {
    const cep = String(cepRaw || '').replace(/\D/g, '');
    if (cep.length !== 8) return null;
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const j = await r.json();
    if (j && j.erro) return null;
    return { cep, street: j.logradouro || '', district: j.bairro || '', city: j.localidade || '', uf: j.uf || '' };
  }
  function attachCepAutofill(formEl) {
    const cepIn = formEl?.querySelector('[name="cep"]');
    if (!cepIn) return;
    const setVal = (sel, val) => { const el = formEl.querySelector(sel); if (el) el.value = val || ''; };
    cepIn.addEventListener('blur', async () => {
      const addr = await buscaCEP(cepIn.value);
      if (!addr) return;
      setVal('[name="street"]', addr.street);
      setVal('[name="district"]', addr.district);
      setVal('[name="city"]', addr.city);
      setVal('[name="uf"]', addr.uf);
    });
  }

  /* ===================== PROCEDURES ===================== */
  let PROCEDURES_CACHE = []; // [{id,name,price,duration,code}]

  // Se você precisar filtrar por org_id, ajuste o n8n e use qs({org_id})
  async function listProcedures(orgId) {
    return api('/procedures' + qs(orgId ? { org_id: orgId } : {}));
  }

  // Preenche o select do agendamento (#ag-proc) e sugere a duração (#ag-dur em horas)
  async function loadProcedures() {
    let raw;
    try {
      raw = await listProcedures();
    } catch (e) {
      console.error('[procedures] erro ao buscar:', e);
      return;
    }

    // n8n pode devolver array puro, ou objeto com .items/.data
    const arr = Array.isArray(raw) ? raw : (raw?.items || raw?.data || []);
    PROCEDURES_CACHE = (arr || []).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price) || 0,
      // mapeia seu schema: default_duration_min -> duration
      duration: Number(p.default_duration_min || p.duration || 60),
      code: p.code || null,
    }));

    const selAg = document.getElementById('ag-proc');
    const selDur = document.getElementById('ag-dur');

    if (selAg) {
      if (!PROCEDURES_CACHE.length) {
        selAg.innerHTML = '<option value="" disabled>Sem procedimentos</option>';
      } else {
        selAg.innerHTML =
          '<option value="" selected disabled>Selecione o procedimento…</option>' +
          PROCEDURES_CACHE.map(
            (p) =>
              `<option value="${p.id}"
                       data-name="${p.name}"
                       data-dur="${p.duration}"
                       data-price="${p.price}">
                 ${p.name}
               </option>`
          ).join('');
      }

      // quando trocar, ajusta a duração sugerida (em horas, 1h..4h)
      const setDur = () => {
        const d = parseInt(selAg.selectedOptions[0]?.dataset?.dur || 60, 10);
        if (!selDur) return;
        // se #ag-dur guarda minutos (60,120,...), escolha o mais próximo
        const h = Math.max(1, Math.round(d / 60));
        const opt = selDur.querySelector(`option[value="${h * 60}"]`);
        if (opt) selDur.value = String(h * 60);
      };
      selAg.addEventListener('change', setDur);
    }

    // também garante que a tabela de orçamento conheça os procedimentos
    const orcTable = document.querySelector('#orc-table tbody');
    if (orcTable && orcTable.children.length === 0) addOrcRow();
  }

  async function createProcedure({ name, duration, price, code }) {
    // seu n8n deve gravar em default_duration_min
    const created = await api('/procedures', {
      method: 'POST',
      body: { name, duration, price, code },
    });
    await loadProcedures();
    return created;
  }
  async function deleteProcedure(id) {
    await api('/procedures/delete', { method: 'POST', body: { id } });
    await loadProcedures();
  }

  /* ===================== PACIENTES ===================== */
  async function upsertPaciente(payload) { return api('/patient/upsert', { method: 'POST', body: payload }); }
  async function listPatients(limit) { return api('/patients' + qs({ limit: limit || 50 })); }
  async function searchPatients(q) { return api('/patients/search' + qs({ q })); }

  // Autocomplete simples para campo de paciente
  function bindPatientAutocomplete({ input, onSelect, onCreateNew }) {
    const el = typeof input === 'string' ? document.querySelector(input) : input;
    if (!el) return;
    let popup;

    async function show(q) {
      if (q.length < 2) { close(); return; }
      try {
        const res = await searchPatients(q);
        render(res || []);
      } catch (e) {
        console.warn(e);
      }
    }
    function render(items) {
      close();
      popup = document.createElement('div');
      popup.className = 'dropdown-menu show';
      popup.style.position = 'absolute';
      popup.style.top = (el.offsetTop + el.offsetHeight) + 'px';
      popup.style.left = el.offsetLeft + 'px';
      popup.style.width = el.offsetWidth + 'px';
      popup.style.zIndex = 2000;

      (items.length ? items : [{ id: null, full_name: `Cadastrar “${el.value}”` }]).forEach(p => {
        const a = document.createElement('a');
        a.className = 'dropdown-item';
        a.href = '#';
        a.textContent = p.full_name || p.name || '';
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (p.id) { onSelect?.(p); el.value = p.full_name || p.name || ''; }
          else { onCreateNew?.(el.value); }
          close();
        });
        popup.appendChild(a);
      });

      el.parentElement.appendChild(popup);
    }
    function close() { popup?.remove(); popup = null; }

    el.addEventListener('input', debounce(() => show(el.value.trim()), 220));
    document.addEventListener('click', (e) => { if (!popup) return; if (!popup.contains(e.target) && e.target !== el) close(); });
  }

  /* ===================== AGENDA ===================== */
  // Backend deve responder com: { events:[{start,end}], officeHours:{start,end}, intervalMinutes }
  async function getAppointmentsByDay(dateStr, dentist, tz) {
    const timezone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const bag = await api('/appointments/day' + qs({ date: dateStr, dentist, tz: timezone }));
    return bag;
  }

  // Helpers hora/min
  function minuteOfDayFromISO(s) {
    if (!s) return null;
    // ISO / ISO com offset
    let m = String(s).match(/T(\d{2}):(\d{2})/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    // "HH:MM"
    m = String(s).match(/^(\d{2}):(\d{2})$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return null;
  }
  function minuteOfDayFromHHMM(hhmm) {
    if (!hhmm) return null;
    const m = String(hhmm).match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  function minToHHMM(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // Calcula horários livres respeitando intervalos e eventos ocupados
  function computeAvailableSlots(bag, durationMinInput) {
    const officeStart = minuteOfDayFromHHMM(bag?.officeHours?.start || '08:00');
    const officeEnd = minuteOfDayFromHHMM(bag?.officeHours?.end || '19:00');
    const interval = Number(bag?.intervalMinutes || 60);
    const durationMin = Math.max(1, Number(durationMinInput || 60));
    const needBlocks = Math.max(1, Math.ceil(durationMin / interval));

    // normaliza busy
    const busy = (bag?.events || []).map(ev => {
      const s = minuteOfDayFromISO(ev.start || ev.start_time || ev.startAt);
      const e = minuteOfDayFromISO(ev.end || ev.end_time || ev.endAt);
      return (s != null && e != null) ? [s, e] : null;
    }).filter(Boolean);

    const overlap = (a1, a2, b1, b2) => a1 < b2 && a2 > b1; // [a1,a2) x [b1,b2)
    const slots = [];

    for (let start = officeStart; start + durationMin <= officeEnd; start += interval) {
      let ok = true, cur = start;
      for (let i = 0; i < needBlocks; i++) {
        const end = cur + interval;
        if (busy.some(([bs, be]) => overlap(cur, end, bs, be))) { ok = false; break; }
        cur += interval;
      }
      if (ok) slots.push(minToHHMM(start));
    }
    return slots;
  }

  async function createAppointment(payload) { return api('/appointments', { method: 'POST', body: payload }); }
  async function rescheduleAppointment({ id, date, time, duracaoMin }) { return api('/appointments/reschedule', { method: 'POST', body: { id, date, time, duracaoMin } }); }
  async function cancelAppointment(id) { return api('/appointments/cancel', { method: 'POST', body: { id } }); }

   /* ====== CONTATO: travar/destravar Telefone/E-mail ====== */
function attachContactEditToggles() {
  const f = document.getElementById('form-agendamento');
  if (!f) return;
  ['phone','email'].forEach(name => {
    const input = f.querySelector(`[name="${name}"]`);
    if (!input || input.parentElement.querySelector('.toggle-edit')) return;
    input.parentElement.classList.add('field-lock');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle-edit';
    btn.textContent = 'Editar';
    btn.addEventListener('click', () => {
      const locking = input.readOnly;
      input.readOnly = !locking ? true : false;   // alterna OK/Editar
      if (!input.readOnly) input.focus();
      btn.textContent = input.readOnly ? 'Editar' : 'OK';
    });
    input.parentElement.appendChild(btn);
  });
}
function lockContactFields(lock = true) {
  const f = document.getElementById('form-agendamento');
  if (!f) return;
  ['phone','email'].forEach(name => {
    const input = f.querySelector(`[name="${name}"]`);
    if (input) input.readOnly = lock;
    const btn = input?.parentElement.querySelector('.toggle-edit');
    if (btn) btn.textContent = lock ? 'Editar' : 'OK';
  });
}
function fillAgendamentoFromPatient(p) {
  const f = document.getElementById('form-agendamento');
  if (!f) return;
  f.querySelector('input[name="paciente"]').value = p.full_name || p.name || '';
  f.querySelector('input[name="phone"]').value    = p.phone || '';
  f.querySelector('input[name="email"]').value    = p.email || '';
  lockContactFields(true);
}
function clearAgendamentoPatient() {
  const f = document.getElementById('form-agendamento');
  if (!f) return;
  f.querySelector('input[name="paciente"]').value = '';
  f.querySelector('input[name="phone"]').value = '';
  f.querySelector('input[name="email"]').value = '';
  lockContactFields(false);
}

/* ====== HORÁRIOS DISPONÍVEIS (Hora como <select>) ====== */
async function refreshAvailableTimes() {
  const f = document.getElementById('form-agendamento');
  const timeSel = document.getElementById('ag-time');
  if (!f || !timeSel) return;

  const date = f.querySelector('[name="date"]')?.value;
  const dentist = f.querySelector('[name="doctor"]')?.value || '';
  const durMin = parseInt(f.querySelector('#ag-dur')?.value || '60', 10);

  if (!date) { timeSel.innerHTML = '<option value="" disabled selected>Selecione</option>'; return; }

  timeSel.innerHTML = '<option value="" disabled selected>Carregando…</option>';
  try {
    const bag = await CRMApi.getAppointmentsByDay(date, dentist);
    const slots = CRMApi.computeAvailableSlots(bag, durMin);
    if (!slots.length) {
      timeSel.innerHTML = '<option value="" disabled selected>Sem horários</option>';
      return;
    }
    timeSel.innerHTML = slots.map(h => `<option value="${h}">${h}</option>`).join('');
  } catch (e) {
    console.error(e);
    timeSel.innerHTML = '<option value="" disabled selected>Erro ao carregar</option>';
  }
}

/* ====== DURAÇÃO: sugerir pela do procedimento ====== */
function wireProcedureSuggestedDuration() {
  const selAg = document.getElementById('ag-proc');
  const durSel = document.getElementById('ag-dur');
  if (!selAg || !durSel) return;

  const setDur = () => {
    const d = parseInt(selAg.selectedOptions[0]?.dataset?.dur || '60', 10);
    const h = Math.max(1, Math.round(d / 60)); // 1..4
    const opt = durSel.querySelector(`option[value="${h*60}"]`);
    if (opt) durSel.value = String(h * 60);
    refreshAvailableTimes();
  };

  selAg.addEventListener('change', setDur);
  setDur(); // inicial
}

/* ====== BOOT: ligar tudo quando a página carregar ====== */
document.addEventListener('DOMContentLoaded', () => {
  attachContactEditToggles();

  // Hora dinâmica
  document.getElementById('ag-dur')?.addEventListener('change', refreshAvailableTimes);
  document.querySelector('#form-agendamento [name="date"]')?.addEventListener('change', refreshAvailableTimes);
  document.querySelector('#form-agendamento [name="doctor"]')?.addEventListener('change', refreshAvailableTimes);

  // Sugestão de duração pelo procedimento
  wireProcedureSuggestedDuration();
});

/* ====== expor helpers (caso já use no seu HTML) ====== */
window.CRMApi = {
  ...(window.CRMApi || {}),
  fillAgendamentoFromPatient,
  clearAgendamentoPatient,
  refreshAvailableTimes,
};


  /* ===================== ORÇAMENTO (dinâmico) ===================== */
  function addOrcRow() {
    const tbody = document.querySelector('#orc-table tbody');
    if (!tbody) return;

    const options = PROCEDURES_CACHE.map(
      (p) => `<option value="${p.name}" data-price="${p.price || 0}">${p.name}</option>`
    ).join('');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select class="form-control orc-proc">${options}</select></td>
      <td class="text-center"><input type="number" class="form-control form-control-sm orc-qtd" value="1" min="1"></td>
      <td><input type="number" class="form-control form-control-sm orc-unit" step="0.01" value="0"></td>
      <td class="orc-sub text-right">0,00</td>
      <td class="text-right"><button class="btn btn-sm btn-outline-secondary btn-pill orc-del">&times;</button></td>`;
    tbody.appendChild(tr);

    const sel = tr.querySelector('.orc-proc');
    const unit = tr.querySelector('.orc-unit');
    unit.value = Number(sel.selectedOptions[0]?.dataset?.price || 0).toFixed(2);
    calcOrc();
  }

  function calcOrc() {
    const tbody = document.querySelector('#orc-table tbody');
    if (!tbody) return;
    let subtotal = 0;
    tbody.querySelectorAll('tr').forEach(tr => {
      const qtd = Number(tr.querySelector('.orc-qtd').value || 0);
      const unit = Number(tr.querySelector('.orc-unit').value || 0);
      const sub = qtd * unit;
      tr.querySelector('.orc-sub').textContent = sub.toFixed(2).replace('.', ',');
      subtotal += sub;
    });
    const subs = document.getElementById('orc-subtotal'); if (subs) subs.textContent = toBRL(subtotal);
    const dv = Number(document.getElementById('orc-desc')?.value || 0);
    const dt = document.getElementById('orc-desc-type')?.value || 'abs';
    const desconto = dt === 'pct' ? subtotal * (dv / 100) : dv;
    const total = Math.max(0, subtotal - desconto);
    const tot = document.getElementById('orc-total'); if (tot) tot.textContent = toBRL(total);
  }

  /* ===================== BOOTSTRAP ===================== */
  document.addEventListener('DOMContentLoaded', () => {
    // Carrega procedimentos e popula selects
    loadProcedures().catch(console.warn);

    // CRUD de procedimentos (se a tela existir)
    document.getElementById('proc-add')?.addEventListener('click', async () => {
      const name = document.getElementById('proc-name')?.value?.trim();
      const dur = parseInt((document.getElementById('proc-dur')?.value || '60').replace(' min', ''), 10);
      const price = Number(document.getElementById('proc-price')?.value || 0);
      const code = document.getElementById('proc-code')?.value?.trim() || null;
      if (!name) return alert('Informe o nome do procedimento.');
      try {
        await createProcedure({ name, duration: isNaN(dur) ? 60 : dur, price, code });
        if (document.getElementById('proc-name')) document.getElementById('proc-name').value = '';
        if (document.getElementById('proc-price')) document.getElementById('proc-price').value = '0';
        if (document.getElementById('proc-code')) document.getElementById('proc-code').value = '';
      } catch (err) { alert(err.message); }
    });

    document.querySelector('#proc-table tbody')?.addEventListener('click', async (e) => {
      if (e.target.classList.contains('proc-del')) {
        const id = e.target.dataset.id;
        if (!id) return;
        if (!confirm('Excluir este procedimento?')) return;
        try { await deleteProcedure(id); } catch (err) { alert(err.message); }
      }
    });

    // Orçamento
    document.getElementById('orc-add')?.addEventListener('click', addOrcRow);
    document.querySelector('#orc-table tbody')?.addEventListener('input', (e) => {
      if (e.target.classList.contains('orc-proc')) {
        const unit = e.target.closest('tr').querySelector('.orc-unit');
        unit.value = Number(e.target.selectedOptions[0].dataset.price || 0).toFixed(2);
      }
      calcOrc();
    });
    document.querySelector('#orc-table tbody')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('orc-del')) {
        e.preventDefault(); e.target.closest('tr').remove(); calcOrc();
      }
    });
    ['input', 'change'].forEach(ev => {
      document.getElementById('orc-desc')?.addEventListener(ev, calcOrc);
      document.getElementById('orc-desc-type')?.addEventListener(ev, calcOrc);
    });
  });

  /* ===================== EXPOSE ===================== */
  window.attachCepAutofill = attachCepAutofill;
  window.CRMApi = {
    // base
    api, url, qs, toBRL,
    // cep
    buscaCEP, attachCepAutofill,
    // procedures
    listProcedures, loadProcedures, createProcedure, deleteProcedure,
    // pacientes
    upsertPaciente, listPatients, searchPatients, bindPatientAutocomplete,
    // agenda
    getAppointmentsByDay, computeAvailableSlots, createAppointment, rescheduleAppointment, cancelAppointment,
    // orçamento
    addOrcRow, calcOrc,
  };
})();


/* =========================================================
   CRM API – OdontoCRM (n8n + Supabase)  [UMD/Browser]
   ---------------------------------------------------------
   - Defina window.CRM_API_BASE (sem barra no final) ANTES.
   - Este arquivo NÃO usa "export". Tudo é IIFE + window.*
   ========================================================= */

(function () {
  /* ===================== CONFIG ===================== */
  function getBase() {
    const b = (window.CRM_API_BASE || 'https://allnsnts.app.n8n.cloud/webhook/odonto');
    return String(b).replace(/\/+$/, '');            // remove barra(s) final(is)
  }
  function join(path) {
    return path.startsWith('/') ? path : '/' + path; // garante 1 barra no meio
  }
  function buildHeaders(method, hasBody, extra) {
    const h = {
      Accept: 'application/json',
      ...(window.CRM_API_KEY ? { 'x-crm-key': window.CRM_API_KEY } : {}),
      ...(extra || {}),
    };
    // NÃO mande Content-Type em GET (evita preflight/OPTIONS)
    if (hasBody && method !== 'GET') h['Content-Type'] = 'application/json';
    return h;
  }
  function url(path) { return getBase() + join(path); }

  /* ===================== UTILS ===================== */
  function toBRL(v){ return (Number(v||0)).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
  function qs(obj) {
    const p = new URLSearchParams();
    Object.entries(obj||{}).forEach(([k,v])=>{
      if (v!==undefined && v!==null && v!=='') p.append(k, String(v));
    });
    const s = p.toString();
    return s ? '?' + s : '';
  }
  function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms||250); }; }

  // Converte qualquer payload "estranho" em array
  function toArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload == null) return [];
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.result)) return payload.result;
    if (payload.json && typeof payload.json === 'object') return [payload.json];
    if (typeof payload === 'object') {
      const vals = Object.values(payload);
      if (vals.every(v => typeof v === 'object')) return vals;
    }
    return [];
  }

  // Padroniza campos do paciente
  function normPatient(p = {}) {
    const id        = p.id || p.patient_id || p.uuid || p._id || null;
    const full_name = p.full_name || p.name || p.nome || '';
    const phone     = p.phone || p.whatsapp || p.celular || p.telefone || '';
    const email     = p.email || p.mail || '';
    return { id, full_name, phone, email, ...p };
  }

  async function api(path, { method='GET', body, headers } = {}) {
    const hasBody = body !== undefined && body !== null;
    const res = await fetch(url(path), {
      method,
      headers: buildHeaders(method, hasBody, headers),
      body: hasBody ? JSON.stringify(body) : undefined,
      mode: 'cors',
      cache: 'no-store',
    });

    const text = await res.text(); // lida com JSON e texto
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      const msg =
        (data && data.message) ||
        (data && data.error && data.error.message) ||
        res.statusText || 'Erro na API';
      throw new Error(msg);
    }
    return data;
  }

  /* ===================== CEP (ViaCEP) ===================== */
  async function buscaCEP(cepRaw){
    const cep = String(cepRaw||'').replace(/\D/g,'');
    if (cep.length !== 8) return null;
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const j = await r.json();
    if (j && j.erro) return null;
    return {
      cep,
      street:   j.logradouro || '',
      district: j.bairro     || '',
      city:     j.localidade || '',
      uf:       j.uf         || ''
    };
  }

  function attachCepAutofill(formEl){
    const cepIn = formEl?.querySelector('[name="cep"]');
    if (!cepIn) return;

    const setVal = (sel, val) => {
      const el = formEl.querySelector(sel);
      if (el) el.value = val || '';
    };

    cepIn.addEventListener('blur', async ()=>{
      const addr = await buscaCEP(cepIn.value);
      if (!addr) return;
      setVal('[name="street"]',   addr.street);
      setVal('[name="district"]', addr.district);
      setVal('[name="city"]',     addr.city);
      setVal('[name="uf"]',       addr.uf);
    });
  }

  /* ===================== PROCEDURES ===================== */
  let PROCEDURES_CACHE = []; // [{id,name,price,duration,code}]

  async function loadProcedures(){
    const list = await api('/procedures');
    PROCEDURES_CACHE = Array.isArray(list) ? list : [];

    // select do agendamento
    const selAg = document.getElementById('ag-proc');
    if (selAg) {
      selAg.innerHTML = PROCEDURES_CACHE.map(p =>
        `<option value="${p.name}" data-id="${p.id||''}" data-dur="${p.duration||60}" data-price="${p.price||0}">
          ${p.name}
        </option>`
      ).join('');
      const dur = document.getElementById('ag-dur');
      if (dur && selAg.selectedOptions[0]) dur.value = `${selAg.selectedOptions[0].dataset.dur} min`;
      selAg.onchange = () => {
        const d = selAg.selectedOptions[0]?.dataset?.dur;
        if (d && dur) dur.value = `${d} min`;
      };
    }

    // tabela do modal “Procedimentos”
    const tbody = document.querySelector('#proc-table tbody');
    if (tbody) {
      tbody.innerHTML = '';
      PROCEDURES_CACHE.forEach(p=>{
        const tr=document.createElement('tr');
        tr.innerHTML = `
          <td>${p.name}</td>
          <td>${p.duration||60} min</td>
          <td>${(p.price||0).toFixed(2).replace('.',',')}</td>
          <td>${p.code||'-'}</td>
          <td class="text-right">
            <button class="btn btn-sm btn-outline-secondary btn-pill proc-del" data-id="${p.id||''}">Excluir</button>
          </td>`;
        tbody.appendChild(tr);
      });
    }

    // orçamento: se não tem linhas, cria a 1ª
    const orcTable = document.querySelector('#orc-table tbody');
    if (orcTable && orcTable.children.length===0) addOrcRow();
  }

  async function createProcedure({name, duration, price, code}){
    const created = await api('/procedures', { method:'POST', body:{ name, duration, price, code }});
    await loadProcedures();
    return created;
  }
  async function deleteProcedure(id){
    await api('/procedures/delete', { method:'POST', body:{ id } });
    await loadProcedures();
  }

  /* ===================== PACIENTES ===================== */
  // Cache leve para autocomplete e preenchimento
  let PATIENTS_CACHE = []; // [{id, full_name, phone, email, ...}]

  async function upsertPaciente(payload){
    const res = await api('/patient/upsert', { method:'POST', body: payload });
    const arr = toArray(res);
    const one = arr[0] || res?.record || res;
    const norm = normPatient(one || {});
    // atualiza cache (se o nome existir substitui, senão inclui)
    const idx = PATIENTS_CACHE.findIndex(p => p.id && p.id === norm.id);
    if (idx >= 0) PATIENTS_CACHE[idx] = norm;
    else PATIENTS_CACHE.unshift(norm);
    return norm;
  }

  async function listPatients(limit){
    const res = await api('/patients' + qs({limit: limit||50}));
    const arr = toArray(res).map(normPatient);
    PATIENTS_CACHE = arr;
    return arr;
  }

  async function searchPatients(q){
    const res = await api('/patients/search' + qs({q}));
    const arr = toArray(res).map(normPatient);
    // não perde o cache atual; apenas mescla (por id)
    arr.forEach(n=>{
      const i = PATIENTS_CACHE.findIndex(p=>p.id===n.id);
      if (i>=0) PATIENTS_CACHE[i]=n; else PATIENTS_CACHE.push(n);
    });
    return arr;
  }

// substitua toda a função setupPatientsDatalist por esta versão
async function setupPatientsDatalist(){
  const inputs = Array.from(document.querySelectorAll('input[name="paciente"]'));
  if (!inputs.length) return;

  // garante que temos algo em cache para mostrar no foco
  if (PATIENTS_CACHE.length === 0) {
    try { await listPatients(50); } catch(e) { console.warn(e); }
  }

  inputs.forEach((input) => {
    // remove o datalist nativo (mantemos o elemento <datalist> só como fallback)
    if (input.getAttribute('list')) input.removeAttribute('list');

    // cria wrapper / dropdown / botão limpar
    const box  = document.createElement('div');  box.className = 'acbox';
    const list = document.createElement('div');  list.className = 'ac-list';
    const clr  = document.createElement('button'); clr.type='button'; clr.className='ac-clear'; clr.innerHTML='&times;'; clr.title='Limpar seleção';

    // envolve o input no wrapper
    input.parentNode.insertBefore(box, input);
    box.appendChild(input);
    box.appendChild(clr);
    box.appendChild(list);

    let currentItems = [];
    let lastQuery = '';

    // helpers
    const show = () => { list.style.display = 'block'; };
    const hide = () => { list.style.display = 'none'; };
    const render = (items) => {
      currentItems = items || [];
      if (!currentItems.length) { hide(); return; }
      list.innerHTML = currentItems.map(p => `
        <div class="ac-item" data-id="${p.id||''}">
          <div class="ac-title">${p.full_name || ''}</div>
          <div class="ac-sub">${p.phone ? p.phone : ''}${p.email ? (p.phone ? ' • ' : '') + p.email : ''}</div>
        </div>`).join('');
      show();
    };
    const showInitial = () => render(PATIENTS_CACHE.slice(0, 12));

    const select = (p) => {
      input.value = p.full_name || '';
      input.dataset.patientId = p.id || '';
      const modal = input.closest('.modal-content') || document;
      const set = (sel,val)=>{ const el = modal.querySelector(sel); if (el) el.value = val || ''; };
      set('[name="phone"]', p.phone || '');
      set('[name="email"]', p.email || '');
      box.classList.add('has-selection');
      hide();
    };

    // eventos
    list.addEventListener('click', (ev)=>{
      const row = ev.target.closest('.ac-item');
      if (!row) return;
      const id = row.dataset.id;
      const p = PATIENTS_CACHE.find(x => (x.id||'')===id) || currentItems.find(x => (x.id||'')===id);
      if (p) select(p);
    });

    input.addEventListener('focus', ()=>{ if (!input.value) showInitial(); });

    input.addEventListener('input', debounce(async ()=>{
      const q = (input.value||'').trim();
      box.classList.remove('has-selection');
      input.dataset.patientId = '';
      if (!q) { showInitial(); return; }

      const qlc = q.toLowerCase();
      // primeiro, filtra localmente
      let items = PATIENTS_CACHE
        .filter(p => (p.full_name||'').toLowerCase().includes(qlc))
        .slice(0, 12);
      render(items);

      // depois, busca no servidor se tiver 2+ chars
      if (q.length >= 2) {
        lastQuery = q;
        try {
          const remote = await searchPatients(q); // já normaliza + mescla o cache
          if (lastQuery !== q) return; // evita sobrescrever com resposta antiga
          const map = new Map();
          [...remote, ...items].forEach(p => map.set(p.id||p.full_name, p));
          render(Array.from(map.values()).slice(0, 20));
        } catch(e) { /* silencia */ }
      }
    }, 180));

    clr.addEventListener('click', ()=>{
      input.value = '';
      input.dataset.patientId = '';
      const modal = input.closest('.modal-content') || document;
      ['[name="phone"]','[name="email"]'].forEach(sel=>{
        const el = modal.querySelector(sel); if (el) el.value='';
      });
      box.classList.remove('has-selection');
      input.focus();
      showInitial();
    });

    document.addEventListener('click', (e)=>{
      if (!box.contains(e.target)) hide();
    });
  });
}


/* ===================== AUTOCOMPLETE DE PACIENTES ===================== */
/**
 * CRMApi.bindPatientAutocomplete({
 *   input: '#ag-paciente',
 *   onSelect(patient){ ...preenche form... },
 *   onCreateNew(query){ ...abre modal novo paciente... }
 * })
 */
function bindPatientAutocomplete(opts){
  const input = typeof opts.input === 'string' ? document.querySelector(opts.input) : opts.input;
  if (!input) return;
  let box, listEl, current = -1, results = [];

  function initials(name=''){
    const p = name.trim().split(/\s+/).slice(0,2);
    return (p[0]?.[0]||'').toUpperCase() + (p[1]?.[0]||'').toUpperCase();
  }
  function close(){ box?.remove(); box=null; current=-1; results=[]; }
  function highlight(i){
    [...listEl.querySelectorAll('.crm-ac-item')].forEach((el,idx)=>{
      el.classList.toggle('active', idx===i);
    });
    current = i;
  }
  function pick(i){
    const p = results[i]; if(!p) return;
    opts.onSelect?.(p);
    close();
  }

  function render(items, q){
    if (!box){
      box = document.createElement('div');
      box.className = 'crm-ac';
      box.innerHTML = `
        <div class="crm-ac-header">Pacientes</div>
        <div class="crm-ac-list"></div>
        <div class="crm-ac-footer">
          <div class="crm-ac-new"><i class="fa-regular fa-square-plus"></i> Cadastrar novo paciente…</div>
          <div style="font-size:12px;color:var(--muted)">Enter para selecionar</div>
        </div>`;
      input.parentElement.appendChild(box);
      listEl = box.querySelector('.crm-ac-list');

      box.querySelector('.crm-ac-new')?.addEventListener('click', ()=>{
        const qv = input.value.trim();
        opts.onCreateNew?.(qv);
        close();
      });
    }
    // posiciona
    const r = input.getBoundingClientRect();
    box.style.minWidth = r.width + 'px';

    // conteudo
    listEl.innerHTML = items.length
      ? items.map(p=>`
          <div class="crm-ac-item" data-id="${p.id}">
            <div class="crm-ac-avatar">${(p.avatar_url ? `<img src="${p.avatar_url}" style="width:36px;height:36px;border-radius:999px;object-fit:cover">` : initials(p.full_name||p.name))}</div>
            <div>
              <div class="crm-ac-name">${p.full_name || p.name}</div>
              <div class="crm-ac-meta">
                ${p.cpf ? `CPF ${p.cpf} • ` : ''}${p.phone || ''}${p.phone && p.email ? ' • ' : ''}${p.email || ''}
              </div>
            </div>
          </div>`).join('')
      : `<div class="crm-ac-empty">Sem resultados para “${q}”.</div>`;

    listEl.querySelectorAll('.crm-ac-item').forEach((el,idx)=>{
      el.addEventListener('mouseenter',()=>highlight(idx));
      el.addEventListener('click',()=>pick(idx));
    });
  }

  const runSearch = debounce(async ()=>{
    const q = input.value.trim();
    let data = [];
    if (q.length < 2) {
      try{ data = await listPatients(50); } catch(e){ data=[]; }
    } else {
      try{ data = await searchPatients(q); } catch(e){ data=[]; }
    }
    results = data || [];
    render(results, q);
  }, 200);

  input.addEventListener('focus', runSearch);
  input.addEventListener('input', runSearch);

  input.addEventListener('keydown', (e)=>{
    if(!box) return;
    if (e.key === 'ArrowDown'){ e.preventDefault(); highlight(Math.min(current+1, results.length-1)); }
    if (e.key === 'ArrowUp'){ e.preventDefault(); highlight(Math.max(current-1, 0)); }
    if (e.key === 'Enter'){ if(current>=0){ e.preventDefault(); pick(current); } }
    if (e.key === 'Escape'){ close(); }
  });

  document.addEventListener('click', (e)=>{
    if (!box) return;
    if (!box.contains(e.target) && e.target !== input) close();
  });
}

/* Helper para preencher/limpar o agendamento */
function fillAgendamentoFromPatient(p, form){
  const f = form || document.getElementById('form-agendamento');
  if(!f) return;
  f.paciente.value = p.full_name || p.name || '';
  f.phone.value    = p.phone || '';
  f.email.value    = p.email || '';
  f.querySelector('#ag-paciente-id').value = p.id || '';

  const picked = document.getElementById('ag-paciente-picked');
  if (picked){
    picked.querySelector('.sel-name').textContent = f.paciente.value;
    picked.classList.remove('d-none');
  }
}
function clearAgendamentoPatient(form){
  const f = form || document.getElementById('form-agendamento');
  if(!f) return;
  f.querySelector('#ag-paciente-id').value = '';
  const picked = document.getElementById('ag-paciente-picked');
  picked?.classList.add('d-none');
}

/* Expose */
window.bindPatientAutocomplete = bindPatientAutocomplete;
window.fillAgendamentoFromPatient = fillAgendamentoFromPatient;
window.clearAgendamentoPatient = clearAgendamentoPatient;


  /* ===================== AGENDAMENTOS ===================== */
  async function getAppointmentsByDay(dateStr, tz='America/Sao_Paulo') {
    const bag = await api('/appointments/day' + qs({ date: dateStr, tz }));
    const events = Array.isArray(bag) ? bag : (bag?.events || []);
    const officeHours = bag?.officeHours || { start:'08:00', end:'19:00' };
    const interval = bag?.intervalMinutes || 60;
    return { events, officeHours, interval, raw: bag };
  }

  async function createAppointment(payload){ return api('/appointments', { method:'POST', body: payload }); }
  async function rescheduleAppointment({id,date,time,duracaoMin}){ return api('/appointments/reschedule', { method:'POST', body:{ id, date, time, duracaoMin } }); }
  async function cancelAppointment(id){ return api('/appointments/cancel', { method:'POST', body:{ id } }); }

  /* ===================== ORÇAMENTOS ===================== */
  async function createQuote(payload){ return api('/quotes', { method:'POST', body: payload }); }

  /* ===================== UI: ORÇAMENTO DINÂMICO ===================== */
  function addOrcRow(){
    const tbody = document.querySelector('#orc-table tbody');
    if (!tbody) return;
    const options = PROCEDURES_CACHE.map(p => `<option value="${p.name}" data-price="${p.price||0}">${p.name}</option>`).join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select class="form-control orc-proc">${options}</select></td>
      <td class="text-center"><input type="number" class="form-control form-control-sm orc-qtd" value="1" min="1"></td>
      <td><input type="number" class="form-control form-control-sm orc-unit" step="0.01" value="0"></td>
      <td class="orc-sub text-right">0,00</td>
      <td class="text-right"><button class="btn btn-sm btn-outline-secondary btn-pill orc-del">&times;</button></td>`;
    tbody.appendChild(tr);
    const sel = tr.querySelector('.orc-proc');
    const unit= tr.querySelector('.orc-unit');
    unit.value = Number(sel.selectedOptions[0]?.dataset?.price||0).toFixed(2);
    calcOrc();
  }

  function calcOrc(){
    const tbody = document.querySelector('#orc-table tbody');
    if (!tbody) return;
    let subtotal=0;
    tbody.querySelectorAll('tr').forEach(tr=>{
      const qtd  = Number(tr.querySelector('.orc-qtd').value||0);
      const unit = Number(tr.querySelector('.orc-unit').value||0);
      const sub  = qtd * unit;
      tr.querySelector('.orc-sub').textContent = sub.toFixed(2).replace('.',',');
      subtotal += sub;
    });
    const subs = document.getElementById('orc-subtotal'); if (subs) subs.textContent = toBRL(subtotal);
    const dv = Number(document.getElementById('orc-desc')?.value || 0);
    const dt = document.getElementById('orc-desc-type')?.value || 'abs';
    const desconto = dt==='pct' ? subtotal*(dv/100) : dv;
    const total = Math.max(0, subtotal - desconto);
    const tot = document.getElementById('orc-total'); if (tot) tot.textContent = toBRL(total);
  }

  /* ===================== BOOTSTRAP DE FORMULÁRIOS ===================== */
  document.addEventListener('DOMContentLoaded', ()=>{
    // Carregamentos iniciais
    Promise.all([ loadProcedures(), setupPatientsDatalist() ]).catch(console.warn);

    /* ---- Procedimentos ---- */
    document.getElementById('proc-add')?.addEventListener('click', async ()=>{
      const name = document.getElementById('proc-name').value.trim();
      const dur  = (document.getElementById('proc-dur').value||'60').replace(' min','');
      const price= Number(document.getElementById('proc-price').value||0);
      const code = document.getElementById('proc-code').value.trim();
      if (!name) return alert('Informe o nome do procedimento.');
      try{
        await createProcedure({ name, duration:Number(dur), price, code });
        document.getElementById('proc-name').value=''; document.getElementById('proc-price').value='0'; document.getElementById('proc-code').value='';
      }catch(err){ alert(err.message); }
    });

    document.querySelector('#proc-table tbody')?.addEventListener('click', async (e)=>{
      if (e.target.classList.contains('proc-del')){
        const id = e.target.dataset.id;
        if (!id) return;
        if (!confirm('Excluir este procedimento?')) return;
        try{ await deleteProcedure(id); }catch(err){ alert(err.message); }
      }
    });

    /* ---- Orçamento ---- */
    document.getElementById('orc-add')?.addEventListener('click', addOrcRow);
    document.querySelector('#orc-table tbody')?.addEventListener('input',(e)=>{
      if (e.target.classList.contains('orc-proc')){
        const unit = e.target.closest('tr').querySelector('.orc-unit');
        unit.value = Number(e.target.selectedOptions[0].dataset.price||0).toFixed(2);
      }
      calcOrc();
    });
    document.querySelector('#orc-table tbody')?.addEventListener('click',(e)=>{
      if (e.target.classList.contains('orc-del')){
        e.preventDefault(); e.target.closest('tr').remove(); calcOrc();
      }
    });
    ['input','change'].forEach(ev=>{
      document.getElementById('orc-desc')?.addEventListener(ev, calcOrc);
      document.getElementById('orc-desc-type')?.addEventListener(ev, calcOrc);
    });
    document.getElementById('form-orc')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const f=e.target;
      const items=[];
      document.querySelectorAll('#orc-table tbody tr').forEach(tr=>{
        items.push({
          name: tr.querySelector('.orc-proc').value,
          qty:  Number(tr.querySelector('.orc-qtd').value||0),
          unit: Number(tr.querySelector('.orc-unit').value||0)
        });
      });
      const payload={
        paciente: f.paciente?.value || '',
        validade: f.validade?.value || null,
        status:   f.status?.value || 'Rascunho',
        canal:    f.canal?.value || 'WhatsApp',
        obs:      f.obs?.value || '',
        descontoValor: Number(document.getElementById('orc-desc')?.value||0),
        descontoTipo:  document.getElementById('orc-desc-type')?.value || 'abs',
        items
      };
      try{
        const resp = await createQuote(payload);
        $('#md-orcamento').modal('hide');
        alert(`Orçamento #${resp?.quoteId||'—'} salvo ✅`);
        if (resp?.shareUrl) window.open(resp.shareUrl,'_blank');
      }catch(err){ alert(err.message); }
    });

    /* ---- Paciente ---- */
    const formPac = document.getElementById('form-paciente');
    if (formPac){
      attachCepAutofill(formPac);
      formPac.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const f=e.target;
        const payload={
          org_id: document.getElementById('org-id')?.value || '00000000-0000-0000-0000-000000000000',
          full_name: f.name?.value?.trim() || '',
          cpf:  f.cpf?.value?.trim() || null,
          dob:  f.dob?.value || null,
          sex:  f.gender?.value || null,
          phone:f.phone?.value || null,
          email:f.email?.value || null,
          address:{
            cep: f.cep?.value || null, street:f.street?.value || null, number:f.number?.value || null,
            district:f.district?.value || null, city:f.city?.value || null, uf:f.uf?.value || null,
            complement:f.complement?.value || null
          },
          notes: f.notes?.value || null
        };
        try{
          const saved = await upsertPaciente(payload);
          $('#md-paciente').modal('hide');
          alert(`Paciente salvo: ${saved?.full_name || payload.full_name} ✅`);
          setupPatientsDatalist(); // atualiza datalist
        }catch(err){
          alert(err.message || 'Erro ao salvar paciente');
          console.error(err);
        }
      });
    }

    /* ---- Agendamento ---- */
    document.getElementById('form-agendamento')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const f=e.target;
      const procOpt = document.getElementById('ag-proc')?.selectedOptions[0];
      const payload = {
        paciente: f.paciente?.value || '',
        phone:    f.phone?.value || null,
        email:    f.email?.value || null,
        canalPreferido: f.channel?.value || 'WhatsApp',
        procedimento:   f.proc?.value || procOpt?.value || '',
        procedimentoId: procOpt?.dataset?.id || null,
        data:      f.date?.value || null,
        hora:      f.time?.value || null,
        duracaoMin: parseInt((f.dur?.value || '60').replace(' min',''),10),
        dentista:  f.doctor?.value || '',
        obs:       f.notes?.value || '',
        confirmar: document.getElementById('ag-status')?.checked || false,
        enviar:{
          whatsapp: f.querySelector('[name="send_whats"]')?.checked || false,
          email:    f.querySelector('[name="send_mail"]')?.checked  || false,
          sms:      f.querySelector('[name="send_sms"]')?.checked   || false
        }
      };
      try{
        const resp = await createAppointment(payload);
        $('#md-agendamento').modal('hide');
        alert(`Agendamento #${resp?.id||'—'} salvo ✅`);
      }catch(err){ alert(err.message); }
    });

    /* ---- Chips ---- */
    document.querySelectorAll('.crm-chip')?.forEach(ch=>{
      const label = ch.textContent.trim().toLowerCase();
      ch.addEventListener('click', ()=>{
        if(label.includes('agendamento')) $('#md-agendamento').modal('show');
        else if(label.includes('paciente')) $('#md-paciente').modal('show');
        else if(label.includes('orçamento')) $('#md-orcamento').modal('show');
        else if(label.includes('procedimentos')) $('#md-procedimentos').modal('show');
      });
    });
  });

  /* ===================== EXPOSE ===================== */
  window.attachCepAutofill = attachCepAutofill;
  window.upsertPaciente    = upsertPaciente;

  window.CRMApi = {
    api, url, toBRL, qs,
    buscaCEP, attachCepAutofill,
    loadProcedures, createProcedure, deleteProcedure,
    upsertPaciente, listPatients, searchPatients, setupPatientsDatalist,
    getAppointmentsByDay, createAppointment, rescheduleAppointment, cancelAppointment,
    createQuote, addOrcRow, calcOrc,
  };
})();



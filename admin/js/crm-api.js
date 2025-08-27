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
      'Accept': 'application/json',
      ...(window.CRM_API_KEY ? { 'x-crm-key': window.CRM_API_KEY } : {}),
      ...(extra || {})
    };
    if (hasBody && method !== 'GET') h['Content-Type'] = 'application/json';
    return h;
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
  const toBRL = (v)=> (Number(v||0)).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const qs = (obj)=>{
    const p = new URLSearchParams();
    Object.entries(obj||{}).forEach(([k,v])=>{
      if (v!==undefined && v!==null && v!=='') p.append(k, String(v));
    });
    const s = p.toString();
    return s ? '?' + s : '';
  };
  const debounce = (fn,ms)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms||250); }; };

  /* ===================== CEP (ViaCEP) ===================== */
  async function buscaCEP(cepRaw){
    const cep = String(cepRaw||'').replace(/\D/g,'');
    if (cep.length !== 8) return null;
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const j = await r.json();
    if (j && j.erro) return null;
    return { cep, street:j.logradouro||'', district:j.bairro||'', city:j.localidade||'', uf:j.uf||'' };
  }
  function attachCepAutofill(formEl){
    const cepIn = formEl?.querySelector('[name="cep"]');
    if (!cepIn) return;
    const setVal = (sel, val) => { const el = formEl.querySelector(sel); if (el) el.value = val || ''; };
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

    // preenche select do agendamento
    const selAg = document.getElementById('ag-proc');
    if (selAg) {
      selAg.innerHTML = PROCEDURES_CACHE.map(p =>
        `<option value="${p.name}" data-id="${p.id||''}" data-dur="${p.duration||60}" data-price="${p.price||0}">${p.name}</option>`
      ).join('');
      // sugere duração do 1º
      const dur = document.getElementById('ag-dur');
      const firstDur = Number(selAg.selectedOptions[0]?.dataset?.dur || 60);
      if (dur) dur.value = String([60,120,180,240].includes(firstDur) ? firstDur : 60);
    }

    // tabela do modal “Procedimentos” (se houver)
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
  async function upsertPaciente(payload){ return api('/patient/upsert', { method:'POST', body: payload }); }
  async function listPatients(limit){ return api('/patients' + qs({limit: limit||50})); }
  async function searchPatients(q){ return api('/patients/search' + qs({q})); }

  // Autocomplete enxuto (opcional — você já liga no HTML principal)
  function bindPatientAutocomplete({input,onSelect,onCreateNew}){
    const el = typeof input==='string'? document.querySelector(input): input;
    if(!el) return;
    let popup;

    async function show(q){
      if(q.length<2){ close(); return; }
      const res = await searchPatients(q);
      render(res||[]);
    }
    function render(items){
      close();
      popup = document.createElement('div');
      popup.className = 'dropdown-menu show';
      popup.style.position='absolute';
      popup.style.top   = (el.offsetTop + el.offsetHeight)+'px';
      popup.style.left  = el.offsetLeft+'px';
      popup.style.width = el.offsetWidth+'px';
      popup.style.zIndex= 2000;

      (items.length? items: [{id:null,full_name:`Cadastrar “${el.value}”`}]).forEach(p=>{
        const a = document.createElement('a');
        a.className='dropdown-item';
        a.href='#';
        a.textContent = p.full_name || p.name || '';
        a.addEventListener('click', (ev)=>{
          ev.preventDefault();
          if(p.id){ onSelect?.(p); el.value = p.full_name || p.name || ''; }
          else { onCreateNew?.(el.value); }
          close();
        });
        popup.appendChild(a);
      });

      el.parentElement.appendChild(popup);
    }
    function close(){ popup?.remove(); popup=null; }

    el.addEventListener('input', debounce(()=>show(el.value.trim()), 220));
    document.addEventListener('click', (e)=>{ if(!popup) return; if(!popup.contains(e.target) && e.target!==el) close(); });
  }

  /* ===================== AGENDA ===================== */
  // Busca compromissos do dia (retorne do n8n: { events:[{start,end}], officeHours:{start,end}, intervalMinutes })
  async function getAppointmentsByDay(dateStr, dentist, tz) {
    const timezone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const bag = await api('/appointments/day' + qs({ date: dateStr, dentist, tz: timezone }));
    return bag;
  }

  // Helpers de horário
  const HHMM_to_min = (s)=>{ const [h,m]=String(s||'00:00').split(':').map(Number); return h*60+m; };
  const dateStr_to_min = (iso)=>{ const d=new Date(iso); return d.getHours()*60 + d.getMinutes(); };
  const min_to_HHMM = (m)=> String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
  const overlap = (a1,a2,b1,b2)=> a1 < b2 && a2 > b1;

  // Gera horários livres considerando officeHours, interval e eventos ocupados
  function computeAvailableSlots(bag, durationMin){
    const startHH = bag?.officeHours?.start || '08:00';
    const endHH   = bag?.officeHours?.end   || '19:00';
    const interval= bag?.intervalMinutes || 60;
    const needBlocks = Math.max(1, Math.ceil((durationMin||60) / interval));

    const dayStart = HHMM_to_min(startHH);
    const dayEnd   = HHMM_to_min(endHH);

    const busy = (bag?.events || []).map(ev=> [dateStr_to_min(ev.start), dateStr_to_min(ev.end)]);

    const slots=[];
    for(let s = dayStart; s + durationMin <= dayEnd; s += interval){
      let ok = true, cur = s;
      for(let i=0;i<needBlocks;i++){
        const e = cur + interval;
        if (busy.some(([bs,be])=> overlap(cur,e,bs,be))) { ok=false; break; }
        cur += interval;
      }
      if(ok) slots.push(min_to_HHMM(s));
    }
    return slots;
  }

  async function createAppointment(payload){ return api('/appointments', { method:'POST', body: payload }); }
  async function rescheduleAppointment({id,date,time,duracaoMin}){ return api('/appointments/reschedule', { method:'POST', body:{ id, date, time, duracaoMin } }); }
  async function cancelAppointment(id){ return api('/appointments/cancel', { method:'POST', body:{ id } }); }

  /* ===================== ORÇAMENTOS DINÂMICOS ===================== */
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

  /* ===================== BOOTSTRAP INICIAL ===================== */
  document.addEventListener('DOMContentLoaded', ()=>{
    // Carrega procedures + inicia datalist (se usado)
    loadProcedures().catch(console.warn);

    // Procedimentos – add/excluir (se a tela de procedimentos existir)
    document.getElementById('proc-add')?.addEventListener('click', async ()=>{
      const name = document.getElementById('proc-name').value.trim();
      const dur  = parseInt((document.getElementById('proc-dur').value||'60').replace(' min',''),10);
      const price= Number(document.getElementById('proc-price').value||0);
      const code = document.getElementById('proc-code').value.trim();
      if (!name) return alert('Informe o nome do procedimento.');
      try{
        await createProcedure({ name, duration:isNaN(dur)?60:dur, price, code });
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


  // -------- helpers robustos p/ extrair minuto-do-dia --------
  function minuteOfDayFromISO(s) {
    if (!s) return null;

    // tenta ISO/ISO com offset: 2025-08-29T16:00:00-03:00
    let m = String(s).match(/T(\d{2}):(\d{2})/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);

    // tenta "16:00" simples
    m = String(s).match(/^(\d{2}):(\d{2})/);
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

  // -------- versão corrigida do cálculo de horários livres --------
  (function ensureCompute() {
    const overlap = (a1, a2, b1, b2) => a1 < b2 && a2 > b1; // [a1,a2) x [b1,b2)

    window.CRMApi = window.CRMApi || {};
    CRMApi.computeAvailableSlots = function computeAvailableSlots(bag, durationMinInput) {
      const officeStart = minuteOfDayFromHHMM(bag?.officeHours?.start || '08:00');
      const officeEnd   = minuteOfDayFromHHMM(bag?.officeHours?.end   || '19:00');
      const interval    = Number(bag?.intervalMinutes || 60);
      const durationMin = Math.max(1, Number(durationMinInput || 60));

      // normaliza eventos -> pares [startMin, endMin]
      const busy = (bag?.events || []).map(ev => {
        const s = minuteOfDayFromISO(ev.start || ev.start_time || ev.startAt);
        const e = minuteOfDayFromISO(ev.end   || ev.end_time   || ev.endAt);
        return (s != null && e != null) ? [s, e] : null;
      }).filter(Boolean);

      const needBlocks = Math.max(1, Math.ceil(durationMin / interval));
      const slots = [];

      for (let start = officeStart; start + durationMin <= officeEnd; start += interval) {
        let ok = true;
        let cur = start;

        // precisa de N blocos contíguos de 'interval'
        for (let i = 0; i < needBlocks; i++) {
          const end = cur + interval;          // bloco [cur, end)
          // algum evento colide com este bloco?
          if (busy.some(([bs, be]) => overlap(cur, end, bs, be))) {
            ok = false; break;
          }
          cur += interval;
        }

        if (ok) slots.push(minToHHMM(start));
      }

      // DEBUG opcional (ajuda a validar no console)
      // console.table(busy.map(([s,e])=>({s:minToHHMM(s), e:minToHHMM(e)})));

      return slots;
    };
  })();\

     // --- PROCS: buscar no backend (n8n) e popular o <select> ---
async function listProcedures(orgId){
  // seu webhook deve aceitar org_id; adapte se o seu n8n usar outro nome
  return api('/procedures' + qs({ org_id: orgId }));
}

function buildDurationSelect(durSel, maxHours=4){
  if(!durSel) return;
  durSel.innerHTML = '';
  for(let h=1; h<=maxHours; h++){
    durSel.insertAdjacentHTML('beforeend', `<option value="${h*60}">${h} h</option>`);
  }
}

async function loadProceduresSelect({ select='#ag-proc', dur='#ag-dur', orgId } = {}){
  const sel = document.querySelector(select);
  const durSel = document.querySelector(dur);
  if(!sel) return;

  // deixa um estado de carregamento
  sel.innerHTML = '<option value="" disabled selected>Carregando…</option>';

  try{
    const res  = await listProcedures(orgId);
    // aceitamos tanto array puro quanto {items:[...]}
    const items = Array.isArray(res) ? res : (res?.items || []);
    if(!items.length){
      sel.innerHTML = '<option value="" disabled>Sem procedimentos</option>';
      return;
    }

    // monta options (id é o value; duração e preço vão como data-*)
    sel.innerHTML = items.map(p => `
      <option value="${p.id}"
              data-name="${p.name}"
              data-dur="${p.default_duration_min || 60}"
              data-price="${p.price || 0}">
        ${p.name}
      </option>
    `).join('');

    // monta o <select> de duração em horas (1h..4h)
    buildDurationSelect(durSel, 4);

    // sempre que trocar o procedimento, ajusta a duração sugerida
    const setDur = () => {
      const d = parseInt(sel.selectedOptions[0]?.dataset?.dur || 60, 10);
      if(!durSel) return;
      // escolhe a opção equivalente (em horas) se existir
      const h = Math.max(1, Math.round(d/60));
      const opt = durSel.querySelector(`option[value="${h*60}"]`);
      if(opt) durSel.value = String(h*60);
    };
    setDur();
    sel.addEventListener('change', setDur);
  }catch(err){
    console.error(err);
    sel.innerHTML = '<option value="" disabled>Erro ao carregar</option>';
  }
}

// --- expor na API pública ---
window.CRMApi = {
  ...(window.CRMApi || {}),
  listProcedures,
  loadProceduresSelect,
};





    // Orçamento
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
  });

  /* ===================== EXPOSE ===================== */
  window.attachCepAutofill = attachCepAutofill;

  window.CRMApi = {
    // base
    api, url, qs, toBRL,
    // cep
    buscaCEP, attachCepAutofill,
    // procedures
    loadProcedures, createProcedure, deleteProcedure,
    // pacientes
    upsertPaciente, listPatients, searchPatients, bindPatientAutocomplete,
    // agenda
    getAppointmentsByDay, computeAvailableSlots, createAppointment, rescheduleAppointment, cancelAppointment,
    // orçamento
    addOrcRow, calcOrc,
  };
})();




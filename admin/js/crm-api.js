/* js/crm-api.js */
/** ============ CONFIG ============ **/
const API_BASE = 'https://allnsnts.app.n8n.cloud/webhook'; // ajuste se necessário
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** helper fetch com tratamento de erro */
async function api(path, { method='GET', body, headers=JSON_HEADERS } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.message || `Erro ${res.status}`);
  return data;
}
const toBRL = v => (Number(v||0)).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

/** ============ PROCEDIMENTOS ============ **/
let PROCEDURES_CACHE = []; // [{id,name,price,duration,code}]

async function loadProcedures() {
  // GET /procedures -> [{id,name,price,duration,code}]
  const list = await api('/procedures');
  PROCEDURES_CACHE = Array.isArray(list) ? list : [];
  // preencher selects da UI
  const selAg = document.getElementById('ag-proc');
  const orcTable = document.querySelector('#orc-table tbody');
  if (selAg) {
    selAg.innerHTML = PROCEDURES_CACHE.map(p =>
      `<option value="${p.name}" data-id="${p.id||''}" data-dur="${p.duration||60}" data-price="${p.price||0}">
         ${p.name}
       </option>`).join('');
    // setar duração automática
    const dur = document.getElementById('ag-dur');
    if (dur && selAg.selectedOptions[0]) dur.value = `${selAg.selectedOptions[0].dataset.dur} min`;
    selAg.onchange = () => {
      const d = selAg.selectedOptions[0]?.dataset?.dur;
      if (d) dur.value = `${d} min`;
    };
  }
  // tabela de gerência de procedimentos (modal md-procedimentos)
  const tbody = document.querySelector('#proc-table tbody');
  if (tbody) {
    tbody.innerHTML = '';
    PROCEDURES_CACHE.forEach(p => {
      const tr = document.createElement('tr');
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
  // se existir tabela de orçamento, re-render dos itens para atualizar lista
  if (orcTable && orcTable.children.length === 0) addOrcRow(); // garante 1ª linha
}

/** adicionar procedimento (POST /procedures) */
async function createProcedure({name, duration, price, code}) {
  const created = await api('/procedures', { method:'POST', body:{ name, duration, price, code }});
  await loadProcedures();
  return created;
}

/** excluir procedimento (POST /procedures/delete) – n8n costuma aceitar só GET/POST */
async function deleteProcedure(id) {
  await api('/procedures/delete', { method:'POST', body:{ id } });
  await loadProcedures();
}

/** ============ PACIENTES ============ **/
async function loadPatientsToDatalist() {
  // GET /patients?limit=50 -> [{id,name,phone,email}]
  const list = await api('/patients?limit=50');
  const dl = document.getElementById('dl-pacientes');
  if (dl) {
    dl.innerHTML = (list||[]).map(p => `<option value="${p.name}">`).join('');
  }
}

async function createPatient(payload) {
  // POST /patients
  return api('/patients', { method:'POST', body: payload });
}

/** ============ AGENDAMENTOS ============ **/
async function createAppointment(payload) {
  // POST /appointments -> retorna {id/status/...}
  return api('/appointments', { method:'POST', body: payload });
}

/** ============ ORÇAMENTOS ============ **/
async function createQuote(payload) {
  // POST /quotes -> {quoteId, total, shareUrl?}
  return api('/quotes', { method:'POST', body: payload });
}

/** ============ ORÇAMENTO – UI dinâmica ============ **/
function addOrcRow() {
  const tbody = document.querySelector('#orc-table tbody');
  if (!tbody) return;
  const tr = document.createElement('tr');
  const options = PROCEDURES_CACHE.map(p =>
    `<option value="${p.name}" data-price="${p.price||0}">${p.name}</option>`
  ).join('');
  tr.innerHTML = `
    <td>
      <select class="form-control orc-proc">${options}</select>
    </td>
    <td class="text-center"><input type="number" class="form-control form-control-sm orc-qtd" value="1" min="1"></td>
    <td><input type="number" class="form-control form-control-sm orc-unit" step="0.01" value="0"></td>
    <td class="orc-sub text-right">0,00</td>
    <td class="text-right"><button class="btn btn-sm btn-outline-secondary btn-pill orc-del">&times;</button></td>
  `;
  tbody.appendChild(tr);
  // set preço inicial
  const sel = tr.querySelector('.orc-proc');
  const unit = tr.querySelector('.orc-unit');
  unit.value = Number(sel.selectedOptions[0]?.dataset?.price || 0).toFixed(2);
  calcOrc();
}

function calcOrc() {
  const tbody = document.querySelector('#orc-table tbody');
  if (!tbody) return;
  let subtotal = 0;
  tbody.querySelectorAll('tr').forEach(tr=>{
    const qtd  = Number(tr.querySelector('.orc-qtd').value||0);
    const unit = Number(tr.querySelector('.orc-unit').value||0);
    const sub = qtd*unit;
    tr.querySelector('.orc-sub').textContent = sub.toFixed(2).replace('.',',');
    subtotal += sub;
  });
  document.getElementById('orc-subtotal').textContent = toBRL(subtotal);
  const dv = Number(document.getElementById('orc-desc').value||0);
  const dt = document.getElementById('orc-desc-type').value;
  const desconto = dt==='pct' ? subtotal*(dv/100) : dv;
  const total = Math.max(0, subtotal - desconto);
  document.getElementById('orc-total').textContent = toBRL(total);
}

/** ============ BOOTSTRAP DOS MODAIS/FORMULÁRIOS ============ **/
document.addEventListener('DOMContentLoaded', () => {
  // carrega dados iniciais
  Promise.all([loadProcedures(), loadPatientsToDatalist()]).catch(console.error);

  /* === Modal: Procedimentos === */
  const btnAddProc = document.getElementById('proc-add');
  if (btnAddProc) {
    btnAddProc.addEventListener('click', async ()=>{
      const name = document.getElementById('proc-name').value.trim();
      const duration = (document.getElementById('proc-dur').value||'60').replace(' min','');
      const price = Number(document.getElementById('proc-price').value||0);
      const code  = document.getElementById('proc-code').value.trim();
      if(!name){ alert('Informe o nome.'); return; }
      try{
        await createProcedure({ name, duration:Number(duration), price, code });
        document.getElementById('proc-name').value='';
        document.getElementById('proc-price').value='0';
        document.getElementById('proc-code').value='';
      }catch(err){ alert(err.message); }
    });
  }
  const procTableBody = document.querySelector('#proc-table tbody');
  if (procTableBody) {
    procTableBody.addEventListener('click', async e=>{
      if (e.target.classList.contains('proc-del')) {
        const id = e.target.dataset.id;
        if (!id) return;
        if (!confirm('Excluir este procedimento?')) return;
        try{ await deleteProcedure(id); }catch(err){ alert(err.message); }
      }
    });
  }

  /* === Modal: Orçamento === */
  const tbody = document.querySelector('#orc-table tbody');
  const addBtn = document.getElementById('orc-add');
  if (addBtn) addBtn.addEventListener('click', addOrcRow);
  if (tbody) {
    tbody.addEventListener('input', e=>{
      if (e.target.classList.contains('orc-proc')) {
        const unit = e.target.closest('tr').querySelector('.orc-unit');
        unit.value = Number(e.target.selectedOptions[0].dataset.price||0).toFixed(2);
      }
      calcOrc();
    });
    tbody.addEventListener('click', e=>{
      if (e.target.classList.contains('orc-del')) {
        e.preventDefault();
        e.target.closest('tr').remove();
        calcOrc();
      }
    });
  }
  ['input','change'].forEach(ev=>{
    const f1 = document.getElementById('orc-desc');
    const f2 = document.getElementById('orc-desc-type');
    if (f1) f1.addEventListener(ev, calcOrc);
    if (f2) f2.addEventListener(ev, calcOrc);
  });

  const formOrc = document.getElementById('form-orc');
  if (formOrc) {
    formOrc.addEventListener('submit', async e=>{
      e.preventDefault();
      const fd = new FormData(formOrc);
      // coleta itens
      const items = [];
      document.querySelectorAll('#orc-table tbody tr').forEach(tr=>{
        const name = tr.querySelector('.orc-proc').value;
        const qty  = Number(tr.querySelector('.orc-qtd').value||0);
        const unit = Number(tr.querySelector('.orc-unit').value||0);
        items.push({ name, qty, unit });
      });
      const payload = {
        paciente: fd.get('paciente'),
        validade: fd.get('validade'),
        status: fd.get('status'),
        canal: fd.get('canal'),
        obs: fd.get('obs'),
        descontoValor: Number(document.getElementById('orc-desc').value||0),
        descontoTipo: document.getElementById('orc-desc-type').value,
        items
      };
      try{
        const resp = await createQuote(payload);
        $('#md-orcamento').modal('hide');
        alert(`Orçamento #${resp?.quoteId||'—'} salvo ✅`);
        if (resp?.shareUrl) window.open(resp.shareUrl, '_blank');
      }catch(err){ alert(err.message); }
    });
  }

  /* === Modal: Paciente === */
  const formPac = document.getElementById('form-paciente');
  if (formPac) {
    formPac.addEventListener('submit', async e=>{
      e.preventDefault();
      const fd = new FormData(formPac);
      const payload = Object.fromEntries(fd.entries());
      try{
        await createPatient(payload);
        $('#md-paciente').modal('hide');
        await loadPatientsToDatalist();
        alert('Paciente cadastrado ✅');
      }catch(err){ alert(err.message); }
    });
  }

  /* === Modal: Agendamento === */
  const formAg = document.getElementById('form-agendamento');
  if (formAg) {
    formAg.addEventListener('submit', async e=>{
      e.preventDefault();
      const fd = new FormData(formAg);
      const procOpt = document.getElementById('ag-proc')?.selectedOptions[0];
      const payload = {
        paciente: fd.get('paciente'),
        phone: fd.get('phone'),
        email: fd.get('email'),
        canalPreferido: fd.get('channel'),
        procedimento: fd.get('proc'),
        procedimentoId: procOpt?.dataset?.id || null,
        data: fd.get('date'),
        hora: fd.get('time'),
        duracaoMin: parseInt((fd.get('dur')||'60').replace(' min',''),10),
        dentista: fd.get('doctor'),
        obs: fd.get('notes'),
        confirmar: document.getElementById('ag-status')?.checked || false,
        enviar: {
          whatsapp: formAg.querySelector('[name="send_whats"]')?.checked || false,
          email:    formAg.querySelector('[name="send_mail"]')?.checked  || false,
          sms:      formAg.querySelector('[name="send_sms"]')?.checked   || false,
        }
      };
      try{
        const resp = await createAppointment(payload);
        $('#md-agendamento').modal('hide');
        alert(`Agendamento #${resp?.id||'—'} salvo ✅`);
      }catch(err){ alert(err.message); }
    });
  }

  // atalho: chips na home para abrir modais
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


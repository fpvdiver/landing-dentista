// admin/js/admin.js
(function () {
  // Se já tiver em outro lugar, pode remover/reusar
  const API_BASE = '/webhooks';

  const listEl   = document.getElementById('booking-list');
  const qEl      = document.getElementById('search-q');
  const filterBtn= document.getElementById('date-filter');
  const menu     = document.getElementById('menu-date');
  const btnNew   = document.getElementById('btn-new');

  let bookings = [];
  let dateRange = 'all';
  let q = '';

  // --------- Carregar dados ---------
  async function loadBookings() {
    try {
      const res = await fetch(`${API_BASE}/bookings`, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      // Normaliza pro formato que o render espera
      bookings = (data || []).map(ev => ({
        id: ev.id,
        title: ev.title || (ev.client && ev.client.name) || 'Agendamento',
        desc: ev.description || '',
        date: ev.date,          // 'YYYY-MM-DD'
        start: ev.startTime,    // 'HH:mm'
        end: ev.endTime,        // 'HH:mm'
        client: (ev.client && ev.client.name) || ''
      }));
    } catch (err) {
      console.warn('Falha ao obter /bookings. Usando mock.', err);
      // Fallback mock para você ver a UI funcionando
      bookings = [
        { id:'1', title:'Emilane', desc:'—', date:'2025-08-23', start:'16:46', end:'17:45', client:'Emilane' },
        { id:'2', title:'Agendamento — Felipe Lima', desc:'Consulta com Dra. Elen', date:'2025-08-22', start:'17:00', end:'18:00', client:'Felipe Lima' },
        { id:'3', title:'Fulvio', desc:'—', date:'2025-08-21', start:'18:00', end:'19:00', client:'Fulvio' },
        { id:'4', title:'Agendamento — Amanda', desc:'Telefone não informado', date:'2025-08-21', start:'15:00', end:'16:00', client:'Amanda' },
      ];
    }
    render();
  }

  // --------- Render ---------
  function render() {
    const filtered = bookings.filter(b => {
      const matchesQ = !q || ( (b.title || '') + (b.client || '') + (b.desc || '') )
        .toLowerCase()
        .includes(q);
      const matchesDate = filterDate(b.date);
      return matchesQ && matchesDate;
    });

    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = '<div style="color:#64748b;padding:14px;">Nenhum agendamento encontrado.</div>';
      return;
    }

    filtered.forEach(b => {
      const card = document.createElement('div');
      card.className = 'card';

      // selo data/hora à esquerda
      const stamp = document.createElement('div');
      stamp.className = 'stamp';
      stamp.innerHTML = `
        <div class="day">${formatDayMonth(b.date)}</div>
        <div class="time"><i class="fa fa-clock-o"></i> ${b.start}</div>
      `;

      // conteúdo
      const cont = document.createElement('div');
      cont.innerHTML = `
        <div class="title-row"><span class="client-name">${escapeHtml(b.title)}</span></div>
        <div class="desc">${escapeHtml(b.desc || '')}</div>
        <div class="badges">
          <span class="badge badge-date"><i class="fa fa-calendar-o"></i> ${formatLong(b.date)}</span>
          <span class="badge badge-time"><i class="fa fa-clock-o"></i> ${b.start} - ${b.end}</span>
          <span class="badge badge-client"><i class="fa fa-user-o"></i> ${escapeHtml(b.client)}</span>
        </div>
      `;

      // ações
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.innerHTML = `
        <a href="#" title="Editar"><i class="fa fa-pencil"></i></a>
        <a href="#" title="Excluir"><i class="fa fa-trash"></i></a>
      `;

      card.appendChild(stamp);
      card.appendChild(cont);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  // --------- Filtro de data ---------
  function filterDate(dateStr) {
    if (dateRange === 'all') return true;
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    if (dateRange === 'today') return sameDay(d, today);
    if (dateRange === 'future') {
      const in30 = new Date(today.getTime() + 30*24*3600*1000);
      return d >= today && d <= in30;
    }
    return true;
  }

  // --------- Utils ---------
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function formatDayMonth(iso){
    const d = new Date(iso+'T00:00:00'); return `${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
  }
  function formatLong(iso){
    return new Intl.DateTimeFormat('pt-BR',{ day:'2-digit', month:'long', year:'numeric'}).format(new Date(iso+'T00:00:00'));
  }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  // --------- Eventos UI ---------
  if (qEl) qEl.addEventListener('input', e => { q = (e.target.value || '').toLowerCase(); render(); });

  if (filterBtn && menu) {
    filterBtn.addEventListener('click', () => { menu.hidden = !menu.hidden; });
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('button'); if (!btn) return;
      dateRange = btn.dataset.range || 'all';
      filterBtn.innerHTML = (btn.textContent || 'Todas as datas') + ' <i class="fa fa-chevron-down"></i>';
      menu.hidden = true;
      render();
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && !filterBtn.contains(e.target)) menu.hidden = true;
    });
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      // redirecionar ou abrir modal
      alert('Abrir fluxo de "Novo Agendamento"');
    });
  }

  // start
  loadBookings();
})();

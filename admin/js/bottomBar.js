// js/bottombar.js
(function(){
  const bar = document.getElementById('bbBar');
  if(!bar) return;

  const tabAgenda = bar.querySelector('.bb-tab[data-act="agenda"]');
  const tabMenu   = bar.querySelector('.bb-tab[data-act="menu"]');
  const fab       = bar.querySelector('.bb-fab');
  const morph     = document.getElementById('bbMorph');

  const overlay = document.getElementById('crm-sheet-overlay');
  const quick   = document.getElementById('crm-quick-sheet');
  const menu    = document.getElementById('crm-menu-sheet');

  const wave = () => { try{ morph.beginElement(); }catch(e){} };
  const bounce = el => {
    const i = el.querySelector('i'), s = el.querySelector('span');
    i?.classList.remove('bb-bounce'); s?.classList.remove('bb-bounce');
    void i?.offsetWidth; void s?.offsetWidth;
    i?.classList.add('bb-bounce'); s?.classList.add('bb-bounce');
  };

  const openSheet = el => { overlay?.classList.add('show'); el?.classList.add('show'); };
  const closeSheets = () => { overlay?.classList.remove('show'); quick?.classList.remove('show'); menu?.classList.remove('show'); };
  overlay?.addEventListener('click', closeSheets);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeSheets(); });

  // Ativo por página
  const page = (document.body.dataset.page || '').toLowerCase();
  const agendaActive = page === 'agenda';
  tabAgenda.classList.toggle('active', agendaActive);
  tabMenu.classList.toggle('active', !agendaActive);

  tabAgenda.addEventListener('click', ()=>{
    wave(); bounce(tabAgenda);
    if(page!=='agenda'){ setTimeout(()=>location.href='agenda.html', 120); }
  });
  tabMenu.addEventListener('click', ()=>{ wave(); bounce(tabMenu); openSheet(menu); });

  fab.addEventListener('click', ()=>{
    wave(); fab.classList.remove('bb-fab-pop'); void fab.offsetWidth; fab.classList.add('bb-fab-pop');
    openSheet(quick);
  });

  // Ações do sheet "+"
  quick?.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-quick]'); if(!btn) return;
    const w = btn.dataset.quick;
    const openModal = (id, fallback) => {
      if (window.$ && $(id).length) { $(id).modal('show'); }
      else { location.href = fallback; }
    };
    if (w==='agendamento')  openModal('#md-agendamento', 'agenda.html');
    if (w==='paciente')     openModal('#md-paciente', 'pacientes.html');
    if (w==='orcamento')    openModal('#md-orcamento', 'orcamentos.html');
    if (w==='procedimentos') location.href='procedimentos.html';
    closeSheets();
  });
})();

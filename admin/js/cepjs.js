document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  document.querySelectorAll('.crm-nav a').forEach(a=>{
    if (a.dataset.nav === page) a.classList.add('active');
  });

  // ganchos básicos para chips/atalhos
  document.querySelectorAll('.crm-chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{
      const txt = ch.textContent.trim().toLowerCase();
      if (txt.includes('agendamento')) location.href = 'agenda.html';
      if (txt.includes('paciente')) location.href = 'pacientes.html';
      if (txt.includes('orçamento')) location.href = 'orcamentos.html';
    });
  });
});

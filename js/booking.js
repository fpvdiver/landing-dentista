/* booking.js */
(function(){
  /* ===== CONFIG ===== */
  const TZ   = 'America/Sao_Paulo';
  const HOOK = 'https://allnsnts.app.n8n.cloud/webhook/availability/';

  /* ===== helpers ===== */
  const el=(q,r=document)=>r.querySelector(q), els=(q,r=document)=>Array.from(r.querySelectorAll(q));
  const pad2=n=>String(n).padStart(2,'0');
  const ymd=d=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const fmtBR=iso=>{try{const [y,m,d]=iso.split('-');return `${d}/${m}/${y}`;}catch{return iso;}};
  const toHM = v => (typeof v==='string' && v.length>=5) ? v.slice(0,5) : new Date(v).toTimeString().slice(0,5);

  function rangeToSlots(start,end,step){const out=[],[sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);let d=new Date();d.setHours(sh,sm,0,0);const z=new Date();z.setHours(eh,em,0,0);while(d<z){out.push(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);d=new Date(d.getTime()+step*60000)}return out}
  function blockByBusy(slots,busy){
    const toMin=t=>{const[h,m]=t.split(':').map(Number);return h*60+m};
    const asRanges=(busy||[]).map(b=>{
      if(Array.isArray(b)) return [b[0],b[1]];
      // objeto com start/end ISO
      return [toHM(b.start), toHM(b.end)];
    });
    return slots.map(t=>{
      const tm=toMin(t);
      const taken = asRanges.some(([a,b])=>tm>=toMin(a) && tm<toMin(b));
      return {time:t, available:!taken};
    });
  }

  async function fetchAvailability(dateStr){
    const url = `${HOOK}?date=${encodeURIComponent(dateStr)}&tz=${encodeURIComponent(TZ)}`;
    const res = await fetch(url,{headers:{Accept:'application/json'}});
    if(!res.ok) throw new Error('Falha ao consultar disponibilidade');
    const data = await res.json();

    // normalização mínima
    if(!data.officeHours){ data.officeHours = { start:'09:00', end:'18:00' }; }
    if(!data.intervalMinutes){ data.intervalMinutes = 30; }
    return data;
  }

  /* ===== elementos ===== */
  const gMonth = el('#cal-month');
  const gGrid  = el('#cal-grid');
  const btnPrev= el('#cal-prev');
  const btnNext= el('#cal-next');

  const slotsBox = el('#slots');
  const dayLabel = el('#sel-day-label');
  const btnAgendar = el('#btn-agendar');
  const step2 = el('#step2');
  const fb = el('#booking-feedback');

  // estado
  let anchor = new Date(); // mês em exibição
  let selDate = new Date(); // dia selecionado
  let selTime = null;

  function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  function endOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0); }

  function buildMonthHeader(){
    const m = anchor.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
    gMonth.textContent = m.charAt(0).toUpperCase()+m.slice(1);
  }

  function dayCell(date,{out=false,avail=false,sel=false}={}){
    const id = ymd(date);
    return `<div class="mcal-day ${out?'out':''} ${avail?'avail':''} ${sel?'sel':''}" data-date="${id}" style="position:relative">
      ${date.getDate()} ${avail?'<span class="dot"></span>':''}
    </div>`;
  }

  async function renderMonth(){
    buildMonthHeader();
    const first = startOfMonth(anchor);
    const last  = endOfMonth(anchor);

    // montar células (completar a grade em múltiplos de 7)
    const padStart = first.getDay();
    const total = last.getDate();
    const cells = [];

    const prev = new Date(first);
    prev.setDate(1 - padStart);
    for(let i=0;i<padStart;i++){
      const d = new Date(prev); d.setDate(prev.getDate()+i);
      cells.push({date:d, out:true});
    }
    for(let i=1;i<=total;i++){
      const d = new Date(first); d.setDate(i);
      cells.push({date:d, out:false});
    }
    while(cells.length % 7 !== 0){
      const d = new Date(last); d.setDate(last.getDate() + (cells.length%7===0?0:(cells.length%7)));
      cells.push({date:d, out:true});
    }

    // marcar disponibilidade básica do mês (consulta leve por dia em exibição)
    const availMap = {};
    const work = cells.filter(c=>!c.out).map(c=>c.date);
    await Promise.all(work.map(async d=>{
      try{
        const bag = await fetchAvailability(ymd(d));
        const slots = rangeToSlots(bag.officeHours.start, bag.officeHours.end, bag.intervalMinutes||30);
        const withStatus = blockByBusy(slots, bag.busy||[]);
        availMap[ymd(d)] = withStatus.some(s=>s.available);
      }catch{ /* ignora dia com erro */ }
    }));

    gGrid.innerHTML = cells.map(c=>{
      const id = ymd(c.date);
      return dayCell(c.date,{out:c.out,avail:!!availMap[id],sel:(id===ymd(selDate))});
    }).join('');

    gGrid.querySelectorAll('.mcal-day').forEach(div=>{
      div.addEventListener('click', ()=>{
        selDate = new Date(div.dataset.date);
        gGrid.querySelectorAll('.mcal-day.sel').forEach(x=>x.classList.remove('sel'));
        div.classList.add('sel');
        loadDay();
      });
    });
  }

  async function loadDay(){
    const ds = ymd(selDate);
    dayLabel.textContent = `• ${fmtBR(ds)}`;
    selTime = null;
    btnAgendar.disabled = true;
    step2.style.display = 'none';
    slotsBox.innerHTML = 'Carregando horários…';

    try{
      const bag = await fetchAvailability(ds);
      const start = bag.officeHours.start || '09:00';
      const end   = bag.officeHours.end   || '18:00';
      const step  = bag.intervalMinutes   || 30;
      const slots = rangeToSlots(start, end, step);
      const withStatus = blockByBusy(slots, bag.busy||[]);

      if(!withStatus.some(s=>s.available)){
        slotsBox.innerHTML = '<div class="text-muted">Sem horários disponíveis.</div>';
        return;
      }
      slotsBox.innerHTML = withStatus.map(s =>
        `<button class="slot-btn ${s.available?'':'disabled'}" ${s.available?'':'disabled'} data-time="${s.time}">${s.time}</button>`
      ).join('');

      slotsBox.querySelectorAll('.slot-btn').forEach(b=>{
        if (b.disabled) return;
        b.addEventListener('click', ()=>{
          slotsBox.querySelectorAll('.slot-btn.active').forEach(x=>x.classList.remove('active'));
          b.classList.add('active');
          selTime = b.dataset.time;
          btnAgendar.disabled = false;
        });
      });
    }catch(e){
      console.error(e);
      slotsBox.innerHTML = '<div class="text-danger">Erro ao carregar disponibilidade.</div>';
    }
  }

  // navegação do mês
  btnPrev.addEventListener('click', ()=>{ anchor = new Date(anchor.getFullYear(), anchor.getMonth()-1, 1); renderMonth(); });
  btnNext.addEventListener('click', ()=>{ anchor = new Date(anchor.getFullYear(), anchor.getMonth()+1, 1); renderMonth(); });

  // passo 2 (mostrar formulário depois de escolher o horário)
  btnAgendar.addEventListener('click', ()=>{
    if(!selTime) return;
    step2.style.display = 'block';
    step2.scrollIntoView({behavior:'smooth', block:'nearest'});
  });

  step2.addEventListener('submit', async e=>{
    e.preventDefault();
    fb.textContent = 'Enviando…';

    const payload = {
      name:  step2.name.value,
      phone: step2.phone.value,
      email: step2.email.value,
      date:  ymd(selDate),
      time:  selTime,
      tz:    TZ
    };

    try{
      // aqui você pode chamar um outro webhook para criar o evento/lead
      // exemplo:
      const resp = await fetch('https://allnsnts.app.n8n.cloud/webhook/odonto/book', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if(!resp.ok) throw new Error('Falha ao agendar');
      fb.innerHTML = '<span class="text-success">Agendamento enviado! ✅</span>';
      step2.reset();
    }catch(err){
      console.error(err);
      fb.innerHTML = '<span class="text-danger">Não foi possível enviar. Tente novamente.</span>';
    }
  });

  // init
  (async function init(){
    await renderMonth();
    await loadDay();
  })();
})();

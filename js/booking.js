/** CONFIG **/
const API_BASE = 'https://allnsnts.app.n8n.cloud/webhook/availability';
const TIMEZONE = 'America/Sao_Paulo';

/** Helpers **/
function el(q, root = document) { return root.querySelector(q); }
function els(q, root = document) { return Array.from(root.querySelectorAll(q)); }

/** Disponibilidade **/
async function fetchAvailability(dateStr) {
  const url = `${API_BASE}?date=${encodeURIComponent(dateStr)}&tz=${encodeURIComponent(TIMEZONE)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) throw new Error(`Erro do servidor (${res.status})`);

    const data = await res.json();
    if (!data || typeof data !== 'object') {
      throw new Error("Resposta inválida do servidor");
    }
    return data;

  } catch (err) {
    console.error("Erro ao buscar disponibilidade:", err);
    const box = el('#slots');
    if (box) {
      box.innerHTML = `<div style="color:#dc2626">Erro ao carregar horários.<br>Tente novamente mais tarde ou fale com nossa equipe pelo chat.</div>`;
    }
    return { horarios: [], busy: [] };
  }
}

function renderSlots(availability) {
  const box = el('#slots');
  if (!box) return;
  box.innerHTML = '';

  const { horarios = [], busy = [] } = availability;

  if (!horarios.length) {
    const msg = document.createElement('div');
    msg.style.marginTop = '8px';
    msg.style.color = '#64748b';
    msg.textContent = 'Sem horários disponíveis nesta data. Selecione outra ou fale com o agente.';
    box.appendChild(msg);
    return;
  }

  horarios.forEach(h => {
    const isBusy = busy.some(b => {
      const start = new Date(b.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return start === h;
    });

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot btn btn-sm ' + (isBusy ? 'disabled' : '');
    b.textContent = h;
    b.disabled = isBusy;

    b.addEventListener('click', () => {
      if (b.classList.contains('disabled')) return;
      els('.slot.selected', box).forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      const hidden = el('#selected-time');
      if (hidden) hidden.value = h;
    });

    box.appendChild(b);
  });
}

/** Booking submit **/
async function submitBooking(payload) {
  try {
    const res = await fetch(`${API_BASE}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      console.error("Resposta não-JSON:", e);
    }

    if (!res.ok) {
      const msg = data?.message || 'Não foi possível concluir o agendamento.';
      throw new Error(msg);
    }

    return data;

  } catch (err) {
    console.error("Erro no submitBooking:", err);
    throw err;
  }
}

/** Wire-up **/
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = el('#booking-date');
  if (dateInput) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    dateInput.min = today.toISOString().slice(0, 10);
    const max = new Date(today.getTime() + 60 * 24 * 3600 * 1000);
    dateInput.max = max.toISOString().slice(0, 10);

    dateInput.addEventListener('change', async (e) => {
      const hidden = el('#selected-time'); 
      if (hidden) hidden.value = '';
      try {
        const data = await fetchAvailability(e.target.value);
        renderSlots(data);
      } catch (err) {
        const slots = el('#slots');
        if (slots) slots.innerHTML = '<div style="color:#dc2626">Erro ao carregar horários.</div>';
        console.error(err);
      }
    });
  }

  const bookingForm = el('#booking-form');
  if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const date = fd.get('date');
      const time = fd.get('time') || fd.get('selected-time') || el('#selected-time')?.value || '';
      const feedback = el('#booking-feedback');

      if (!time) {
        if (feedback) feedback.innerHTML = '<div class="text-danger">Selecione o horário.</div>';
        return;
      }

      const payload = {
        name: fd.get('name'),
        phone: fd.get('phone'),
        email: fd.get('email'),
        date, time,
        tz: TIMEZONE,
        source: 'web-form',
        idempotencyKey: (crypto?.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random()))
      };

      if (feedback) feedback.innerHTML = '⏳ Processando...';
      try {
        const resp = await submitBooking(payload);
        if (feedback) {
          feedback.innerHTML = `<div class="text-success">✅ Agendado com sucesso! Código: ${resp.eventId || 'N/A'}</div>`;
        }
      } catch (err) {
        if (feedback) feedback.innerHTML = `<div class="text-danger">${err.message}</div>`;
        console.error(err);
      }
    });
  }

  

// --------- Chat embutido (Leadster-like) ---------
  const AGENT_AVATAR = 'images/recepcionista.png'; // mantendo suas imagens

  const widget   = el('#agent-widget');
  const thread   = el('#agent-thread');
  const inputMsg = el('#agent-input');
  const sendBtn  = el('#agent-send');
  const minimize = el('#agent-minimize');

  // Sincroniza a paleta do chat com a cor destaque do site (Order Online / .btn1)
  (function syncChatPalette(){
    const src = el('.order_online') || el('.btn1') || el('.btn, .btn-primary');
    let accent = '#ffbe33'; // fallback
    if (src) {
      const bg = getComputedStyle(src).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') accent = bg;
    }
    function shade(color, pct){
      const toRGB = (c) => {
        if (c.startsWith('#')) {
          const hex = c.replace('#','');
          const arr = hex.length === 3
            ? hex.split('').map(ch=>parseInt(ch+ch,16))
            : [hex.slice(0,2),hex.slice(2,4),hex.slice(4,6)].map(x=>parseInt(x,16));
          return {r:arr[0], g:arr[1], b:arr[2]};
        }
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        return m ? { r:+m[1], g:+m[2], b:+m[3] } : { r:255, g:190, b:51 };
      };
      const {r,g,b} = toRGB(color);
      const f = (v)=> Math.max(0, Math.min(255, Math.round(v * (1 + pct/100))));
      const toHex = (v)=> v.toString(16).padStart(2,'0');
      return `#${toHex(f(r))}${toHex(f(g))}${toHex(f(b))}`;
    }
    const darker = shade(accent, -14);
    document.documentElement.style.setProperty('--lead-accent', accent);
    document.documentElement.style.setProperty('--lead-accent-dark', darker);
  })();

  function appendMsg(role, content) {
    if (!thread) return;
    const r = (role === 'assistant') ? 'agent' : role;
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (r === 'user' ? 'user' : 'agent');

    if (r === 'agent') {
      const av = document.createElement('img');
      av.src = AGENT_AVATAR;
      av.alt = 'Agente';
      av.className = 'avatar-sm';
      wrap.appendChild(av);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = content;
    wrap.appendChild(bubble);

    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
  }

  function bootAgent() {
    if (!thread) return;
    thread.innerHTML = '';
    appendMsg('assistant', 'Olá! Sou a Elana a recepcionista da Dra Elen, Posso te ajudar de alguma forma?');
  }

  async function sendMsg() {
    if (!inputMsg) return;
    const text = (inputMsg.value || '').trim();
    if (!text) return;
    appendMsg('user', text);
    inputMsg.value = '';

    const context = {
      tz: TIMEZONE,
      prefill: {
        name: el('input[name="name"]')?.value || '',
        phone: el('input[name="phone"]')?.value || '',
        email: el('input[name="email"]')?.value || '',
      }
    };

    try {
      const data = await sendMessage(text, context)
(text, context);
      appendMsg('assistant', data.reply || 'Ok.');
      if (data.booking && data.booking.status === 'confirmed') {
        const fb = el('#booking-feedback');
        if (fb) fb.innerHTML = `<div class="text-success">Agendado via agente! Código: ${data.booking.eventId}</div>`;
      }
    } catch (err) {
      appendMsg('assistant', 'Tive um problema ao processar. Tente novamente.');
      console.error(err);
    }
  }

  if (sendBtn && inputMsg) {
    sendBtn.addEventListener('click', sendMsg);
    inputMsg.addEventListener('keypress', (ev) => { if (ev.key === 'Enter') sendMsg(); });
  }

  // Minimizar/expandir (opcional)
  if (minimize && widget) {
    let minimized = false;
    minimize.addEventListener('click', () => {
      minimized = !minimized;
      widget.style.height = minimized ? '56px' : '';
      const body = el('.lead-body', widget);
      const bar  = el('.lead-inputbar', widget);
      if (body) body.style.display = minimized ? 'none' : '';
      if (bar)  bar.style.display  = minimized ? 'none' : '';
      minimize.textContent = minimized ? '+' : '–';
    });
  }

  // Se existir um botão "Agendar via Chat", apenas rola até o widget
  const openBtn = el('#open-agent');
  if (openBtn && widget) {
    openBtn.addEventListener('click', () => {
      widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inputMsg?.focus();
    });
  }

  // Mensagem de boas-vindas
  bootAgent();

});


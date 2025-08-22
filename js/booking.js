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
});

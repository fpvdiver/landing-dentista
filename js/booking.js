/** CONFIG **/
const API_BASE = 'https://allnsnts.app.n8n.cloud/webhook/availability';
const TIMEZONE = 'America/Sao_Paulo';
const SLOT_INTERVAL_MIN = 60; // fallback, mas não está sendo usado pois vem do servidor

/** Helpers **/
function el(q, root = document) { return root.querySelector(q); }
function els(q, root = document) { return Array.from(root.querySelectorAll(q)); }

/** Disponibilidade **/
async function fetchAvailability(dateStr) {
  const url = `${API_BASE}/?date=${encodeURIComponent(dateStr)}&tz=${encodeURIComponent(TIMEZONE)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Falha ao consultar disponibilidade');
  return res.json();
}

function renderSlots(availability) {
  const box = el('#slots'); 
  if (!box) return;
  box.innerHTML = '';

  console.log("🔍 Disponibilidade recebida:", availability);

  const freeSlots = availability.freeSlots || [];
  const busy = availability.busy || [];

  if (!Array.isArray(freeSlots)) {
    box.innerHTML = '<div style="color:#dc2626">Formato inesperado de disponibilidade.</div>';
    return;
  }

  // 🔹 Normaliza para lista de strings (HH:mm)
  const slotsNormalized = freeSlots.map(s => {
    if (typeof s === 'string') return s;
    if (s.start) {
      const d = new Date(s.start);
      return d.toISOString().substring(11,16); // pega "HH:mm"
    }
    return null;
  }).filter(Boolean);

  slotsNormalized.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot btn btn-sm';
    b.textContent = s;
    b.disabled = false;

    b.addEventListener('click', () => {
      els('.slot.selected', box).forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      const hidden = el('#selected-time');
      if (hidden) hidden.value = s;
    });

    box.appendChild(b);
  });

  if (slotsNormalized.length === 0) {
    const msg = document.createElement('div');
    msg.style.marginTop = '8px';
    msg.style.color = '#64748b';
    msg.textContent = 'Sem horários disponíveis nesta data. Selecione outra ou fale com o agente.';
    box.appendChild(msg);
  }
}


/** Booking submit **/
async function submitBooking(payload) {
  const res = await fetch(`${API_BASE}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    console.error("Resposta não JSON:", e);
  }

  if (!res.ok) {
    const msg = data?.message || 'Não foi possível concluir o agendamento.';
    throw new Error(msg);
  }
  return data;
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
      const hidden = el('#selected-time'); if (hidden) hidden.value = '';
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
        idempotencyKey: (crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random()))
      };

      if (feedback) feedback.innerHTML = 'Processando...';
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


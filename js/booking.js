/** CONFIG **/
const API_BASE = 'https://allnsnts.app.n8n.cloud/webhook/availability'; 
const TIMEZONE = 'America/Sao_Paulo';

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

function renderSlots(data) {
  const box = el('#slots');
  if (!box) return;
  box.innerHTML = '';
  
const slots = Array.isArray(data) ? data : (data.slots || []);


  slots.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot btn btn-sm ' + (s.available ? '' : 'disabled');
    b.textContent = `${s.start} - ${s.end}`;
    b.disabled = !s.available;

    b.addEventListener('click', () => {
      if (b.classList.contains('disabled')) return;
      els('.slot.selected', box).forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      const hidden = el('#selected-time');
      if (hidden) hidden.value = s.start;
    });

    box.appendChild(b);
  });

  if (!slots.some(s => s.available)) {
    const msg = document.createElement('div');
    msg.style.marginTop = '8px';
    msg.style.color = '#64748b';
    msg.textContent = 'Sem horários disponíveis nesta data. Selecione outra ou fale com o agente.';
    box.appendChild(msg);
  }
}

/** Booking submit **/
async function submitBooking(payload) {
  const res = await fetch(`${https://allnsnts.app.n8n.cloud/webhook/availability}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Não foi possível concluir o agendamento.');
  return data;
}

/** Wire-up **/
document.addEventListener('DOMContentLoaded', () => {
  // --------- Datepicker & Slots ---------
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

  // --------- Booking form ---------
  const bookingForm = el('#booking-form');
  if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const date = fd.get('date');
      const time = fd.get('time') || fd.get('selected-time') || '';
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
        idempotencyKey: Date.now() + '-' + Math.random()
      };
      if (feedback) feedback.innerHTML = 'Processando...';
      try {
        const resp = await submitBooking(payload);
        if (feedback) feedback.innerHTML = `<div class="text-success">Agendado! Confirmação enviada. Código: ${resp.eventId}</div>`;
      } catch (err) {
        if (feedback) feedback.innerHTML = `<div class="text-danger">${err.message}</div>`;
      }
    });
  }
});



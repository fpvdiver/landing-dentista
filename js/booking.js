/** CONFIG **/
const API_BASE = 'https://allnsnts.app.n8n.cloud/webhook/availability';
const TIMEZONE = 'America/Sao_Paulo';
const SLOT_INTERVAL_MIN = 60; // deve bater com o servidor

/** Helpers **/
function el(q, root = document) { return root.querySelector(q); }
function els(q, root = document) { return Array.from(root.querySelectorAll(q)); }
function fmtMoneyBRL(v) { return (v ?? '').toString(); }

/** Disponibilidade **/
async function fetchAvailability(dateStr) {
  const url = `${API_BASE}/?date=${encodeURIComponent(dateStr)}&tz=${encodeURIComponent(TIMEZONE)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Falha ao consultar disponibilidade');
  return res.json();
}

function rangeToSlots(start, end, stepMin) {
  const out = [];
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let d = new Date(); d.setHours(sh, sm, 0, 0);
  const z = new Date(); z.setHours(eh, em, 0, 0);
  while (d < z) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    out.push(`${hh}:${mm}`);
    d = new Date(d.getTime() + stepMin * 60000);
  }
  return out;
}

function blockByBusy(slots, busyWindows) {
  const toMin = t => {
    const [h, m] = t.split(':').map(Number); return h * 60 + m;
  };
  const isBusy = (t) => busyWindows.some(([bStart, bEnd]) => {
    const tm = toMin(t), bs = toMin(bStart), be = toMin(bEnd);
    return tm >= bs && tm < be;
  });
  return slots.map(t => ({ time: t, available: !isBusy(t) }));
}

function renderSlots(availability) {
  const box = el('#slots'); if (!box) return;
  box.innerHTML = '';
  const { officeHours, busy, intervalMinutes } = availability;

  const slots = rangeToSlots(officeHours.start, officeHours.end, intervalMinutes || SLOT_INTERVAL_MIN);

  // 🔹 Converte busy do formato ISO -> pares ["HH:MM", "HH:MM"]
  const busyWindows = (busy || []).map(b => {
    const s = new Date(b.start);
    const e = new Date(b.end);
    const fmt = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return [fmt(s), fmt(e)];
  });

  const withStatus = blockByBusy(slots, busyWindows);

  withStatus.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot btn btn-sm ' + (s.available ? '' : 'disabled');
    b.textContent = s.time;
    b.disabled = !s.available;
    b.addEventListener('click', () => {
      if (b.classList.contains('disabled')) return;
      els('.slot.selected', box).forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      const hidden = el('#selected-time');
      if (hidden) hidden.value = s.time;
    });
    box.appendChild(b);
  });

  if (!withStatus.some(s => s.available)) {
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


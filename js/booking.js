/** CONFIG **/
const API_BASE = 'https://allnsnts.app.n8n.cloud/webhook/availability';
const CHAT_WEBHOOK = 'https://allnsnts.app.n8n.cloud/webhook/agent-chat';
const TIMEZONE = 'America/Sao_Paulo';

/** Helpers **/
function el(q, root = document) { return root.querySelector(q); }
function els(q, root = document) { return Array.from(root.querySelectorAll(q)); }

/** ---------------------------
 * Disponibilidade / Agendamento
 * --------------------------- */
async function fetchAvailability(dateStr) {
  const url = `${API_BASE}?date=${encodeURIComponent(dateStr)}&tz=${encodeURIComponent(TIMEZONE)}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Erro do servidor (${res.status})`);
    return await res.json();
  } catch (err) {
    console.error("Erro ao buscar disponibilidade:", err);
    return { horarios: [], busy: [] };
  }
}

function renderSlots(availability) {
  const box = el('#slots');
  if (!box) return;
  box.innerHTML = '';

  const { horarios = [], busy = [] } = availability;

  if (!horarios.length) {
    box.innerHTML = `<div style="color:#64748b">Sem horários disponíveis nesta data.</div>`;
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
      el('#selected-time').value = h;
    });

    box.appendChild(b);
  });
}

async function submitBooking(payload) {
  const res = await fetch(`${API_BASE}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

/** ---------------------------
 * Chat da recepcionista
 * --------------------------- */
function addChatMessage(text, sender = "user") {
  const thread = el("#agent-thread");
  const msg = document.createElement("div");
  msg.classList.add("lead-msg", sender === "user" ? "user-msg" : "agent-msg");
  msg.textContent = text;
  thread.appendChild(msg);
  thread.scrollTop = thread.scrollHeight;
}

async function sendMessage() {
  const input = el("#agent-input");
  const message = input.value.trim();
  if (!message) return;

  // mostra no chat
  addChatMessage(message, "user");
  input.value = "";

  // placeholder "digitando..."
  const thread = el("#agent-thread");
  const typingMsg = document.createElement("div");
  typingMsg.classList.add("lead-msg", "agent-msg");
  typingMsg.textContent = "Digitando...";
  thread.appendChild(typingMsg);
  thread.scrollTop = thread.scrollHeight;

  try {
    const res = await fetch(CHAT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });

    let data;
    try {
      data = await res.json();
    } catch {
      data = await res.text(); // fallback se não for JSON válido
    }
    console.log("Resposta do n8n:", data);
addChatMessage(data.reply, "agent");
    
    addChatMessage(data.reply, "agent");


    typingMsg.remove();

    let reply;
    if (typeof data === "object" && data.reply) {
      reply = data.reply;
    } else if (typeof data === "string") {
      reply = data;
    } else {
      reply = "⚠️ A recepcionista não entendeu a resposta.";
    }

  } catch (err) {
    console.error("Erro no chat:", err);
    typingMsg.textContent = "⚠️ Erro ao conectar com a recepcionista.";
  }
}

/** ---------------------------
 * Inicialização
 * --------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  // ---- Datepicker ----
  const dateInput = el('#booking-date');
  if (dateInput) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    dateInput.min = today.toISOString().slice(0, 10);
    const max = new Date(today.getTime() + 60 * 24 * 3600 * 1000);
    dateInput.max = max.toISOString().slice(0, 10);

    dateInput.addEventListener('change', async (e) => {
      el('#selected-time').value = '';
      const data = await fetchAvailability(e.target.value);
      renderSlots(data);
    });
  }

  // ---- Booking Form ----
  const bookingForm = el('#booking-form');
  if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const feedback = el('#booking-feedback');
      const time = fd.get('time') || el('#selected-time').value;

      if (!time) {
        feedback.innerHTML = '<div class="text-danger">Selecione o horário.</div>';
        return;
      }

      const payload = {
        name: fd.get('name'),
        phone: fd.get('phone'),
        email: fd.get('email'),
        date: fd.get('date'),
        time,
        tz: TIMEZONE,
        source: 'web-form',
        idempotencyKey: (crypto?.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random())
      };

      feedback.innerHTML = '⏳ Processando...';
      try {
        const resp = await submitBooking(payload);
        feedback.innerHTML = `<div class="text-success">✅ Agendado com sucesso! Código: ${resp.eventId || 'N/A'}</div>`;
      } catch (err) {
        feedback.innerHTML = `<div class="text-danger">${err.message}</div>`;
      }
    });
  }

  // ---- Chat ----
  el("#agent-send")?.addEventListener("click", sendMessage);
  el("#agent-input")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });
});





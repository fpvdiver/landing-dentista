// Enviar mensagem
async function sendMessage() {
  const message = input.value.trim();
  if (!message) return;

  // mostra no chat do usuário
  addMessage(message, "user");
  input.value = "";

  // mostra que a recepcionista está digitando
  const typingMsg = document.createElement("div");
  typingMsg.classList.add("lead-msg", "agent-msg");
  typingMsg.textContent = "Digitando...";
  thread.appendChild(typingMsg);
  thread.scrollTop = thread.scrollHeight;

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });

    let data;
    try {
      data = await res.json();
    } catch (err) {
      // se não for JSON válido, pega texto direto
      data = await res.text();
    }

    // remove "Digitando..."
    typingMsg.remove();

    // garante que sempre pega alguma resposta
    const reply =
      (typeof data === "string" ? data : data.reply || data.message?.content) ||
      "⚠️ Sem resposta do agente";

    addMessage(reply, "agent");
  } catch (err) {
    typingMsg.textContent = "⚠️ Erro ao conectar com a recepcionista.";
  }
}

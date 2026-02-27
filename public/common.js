const API = "";

function getToken() {
  return localStorage.getItem("token") || "";
}

function setToken(token) {
  if (token) {
    localStorage.setItem("token", token);
  } else {
    localStorage.removeItem("token");
  }
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

function requireAuthRedirect() {
  if (!getToken()) {
    window.location.href = "/auth";
  }
}

function logoutToAuth() {
  setToken("");
  window.location.href = "/auth";
}

function setStatus(node, message, isError = false) {
  if (node) {
    if (node.id === "order-msg" && typeof message === "string" && message.includes("Download Receipt")) {
      node.innerHTML = message;
    } else {
      node.textContent = message || "";
    }
    node.classList.toggle("error", Boolean(isError));
  }
}

function initFloatingChat() {
  const fab = document.getElementById("chat-fab");
  const panel = document.getElementById("chat-panel");
  const askBtn = document.getElementById("chat-ask");
  const input = document.getElementById("chat-input");
  const history = document.getElementById("chat-history");
  const language = document.getElementById("chat-language");

  if (!fab || !panel || !askBtn || !input || !history) return;

  fab.addEventListener("click", () => panel.classList.toggle("hidden"));

  function formatAiListHtml(text) {
    const lines = String(text || "")
      .replace(/\*\*/g, "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const compact = [];
    for (const line of lines) {
      let item = line
        .replace(/^[\-\*\u2022]\s*/, "")
        .replace(/^\d+[\).\s-]*/, "")
        .trim();
      if (!item) continue;
      if (item.length > 180) item = item.slice(0, 177) + "...";
      compact.push(item);
      if (compact.length >= 7) break;
    }

    if (!compact.length) {
      return `<p>${text}</p>`;
    }
    return "<ul style=\"margin:0.3rem 0 0 1rem;\">" + compact.map((i) => `<li>${i}</li>`).join("") + "</ul>";
  }

  askBtn.addEventListener("click", async () => {
    const prompt = input.value.trim();
    if (!prompt) return;

    const q = document.createElement("p");
    q.innerHTML = `<strong>You:</strong> ${prompt}`;
    history.prepend(q);
    input.value = "";

    const selectedLanguage = language ? language.value : "en";
    try {
      const result = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          language: selectedLanguage,
          pagePath: window.location.pathname,
          pageHint: document.title || "marketplace"
        })
      });
      const a = document.createElement("p");
      a.innerHTML = `<strong>AI:</strong> ${formatAiListHtml(result.response)}`;
      history.prepend(a);
    } catch (error) {
      const a = document.createElement("p");
      a.innerHTML = `<strong>AI:</strong> ${error.message}`;
      history.prepend(a);
    }
  });
}

// Remove duplicate declaration
if (!window.Kiazala) {
  window.Kiazala = {
    api,
    getToken,
    setToken,
    requireAuthRedirect,
    logoutToAuth,
    setStatus,
    initFloatingChat
  };
}

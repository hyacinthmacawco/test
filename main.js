import { createP2P } from "./p2p.js";

const $ = selector => document.querySelector(selector);

const setup = $("#setupView");
const chat = $("#chat");
const paste = $("#pasteCode");
const copy = $("#copyCode");
const qr = $("#qrCode");
const messagesEl = $("#messages");
const fileInput = $("#chatFile");
const composeView = $("#composeView");
const composeText = $("#composeText");
const composeButton = $("#composeButton");
const composeSend = $("#composeSend");
const cancelComposeButton = $("#cancelComposeButton");
const versionPanel = $("#versionPanel");

const domainTypes = ["General", "Personal", "Work", "Link"];

let conversations = [];
let activeId = null;
let nextId = 1;

let mainUsers = new Set(["__mine__"]);
let composeUsers = new Set();

let mainDomains = new Set();
let composeDomains = new Set();

let timeFilter = "all";
let versions = [];
let selectedVersions = new Set();
let composerOpen = false;

let errorEl = $("#error");

if (!errorEl) {
  errorEl = document.createElement("p");
  errorEl.id = "error";
  errorEl.setAttribute("role", "status");
  setup.appendChild(errorEl);
}

function active() {
  return conversations.find(c => c.id === activeId);
}

function setError(message = "") {
  errorEl.textContent = message;
}

function newConversation(name) {
  const number = nextId++;

  const c = {
    id: "c" + number,
    name: name || "User " + number,
    p2p: null,
    localCode: "",
    stage: "offer",
    busy: false,
    messages: [],
    connected: false
  };

  c.p2p = createP2P({
    onMessage: payload => {
      let message;

      try {
        const data = JSON.parse(payload);

        if (
          data &&
          data.kind === "chat-message" &&
          typeof data.text === "string"
        ) {
          message = {
            text: data.text,
            domain: domainTypes.includes(data.domain)
              ? data.domain
              : "General",
            kind: "theirs",
            timestamp: Number(data.timestamp) || Date.now()
          };
        }
      } catch {
        // Treat non-JSON payloads as ordinary text messages.
      }

      if (!message) {
        message = {
          text: payload,
          domain: "General",
          kind: "theirs",
          timestamp: Date.now()
        };
      }

      addMessage(c, message);
    },

    onLocalCode: (code, type) => {
      c.localCode = code;
      c.stage = type;

      if (activeId === c.id) render();
    },

    onConnectionState: state => {
      c.connected = state.connected;

      if (activeId === c.id) render();

      renderFilters();
    },

    onError: message => {
      if (activeId === c.id) setError(message);
    }
  });

  conversations.push(c);
  mainUsers.add(c.id);

  if (composeUsers.size === 0) {
    composeUsers.add(c.id);
  }

  return c;
}

function addMessage(c, message) {
  c.messages.push({
    ...message,
    timestamp: Number(message.timestamp) || Date.now()
  });

  c.messages.sort((a, b) => a.timestamp - b.timestamp);

  if (activeId === c.id) {
    renderMessages();
  }

  renderFilters();
}

function getVisibleMessages() {
  const now = Date.now();

  const cutoff = {
    all: 0,
    hour: now - 60 * 60 * 1000,
    day: now - 24 * 60 * 60 * 1000,
    week: now - 7 * 24 * 60 * 60 * 1000
  }[timeFilter] ?? 0;

  return conversations
    .flatMap(c =>
      c.messages.map((message, index) => ({
        ...message,
        userId: c.id,
        userName: c.name,
        index
      }))
    )
    .filter(message =>
      mainUsers.has(
        message.kind === "mine" ? "__mine__" : message.userId
      )
    )
    .filter(message =>
      mainDomains.size === 0 ||
      mainDomains.has(message.domain || "General")
    )
    .filter(message => message.timestamp >= cutoff)
    .sort((a, b) =>
      a.timestamp - b.timestamp || a.index - b.index
    );
}

function renderMessages() {
  const wasNearBottom =
    messagesEl.scrollHeight -
    messagesEl.scrollTop -
    messagesEl.clientHeight < 80;

  messagesEl.replaceChildren();

  const fragment = document.createDocumentFragment();

  for (const message of getVisibleMessages()) {
    const article = document.createElement("article");

    article.className =
      "message " +
      (message.kind === "mine" ? "mine" : "theirs");

    const meta = document.createElement("div");
    meta.className = "message-meta";

    meta.textContent =
      (message.kind === "mine" ? "You" : message.userName) +
      " · " +
      (message.domain || "General") +
      " · " +
      new Date(message.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = message.text;

    article.append(meta, body);
    fragment.appendChild(article);
  }

  messagesEl.appendChild(fragment);

  if (wasNearBottom || messagesEl.scrollHeight > 0) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function render() {
  const c = active();
  if (!c) return;

  setup.hidden = c.connected;
  chat.hidden = !c.connected;

  composeView.hidden = !composerOpen;

  $("#timeToolbar").hidden = composerOpen;
  $("#versionButton").hidden = composerOpen;
  cancelComposeButton.hidden = !composerOpen;
  composeButton.hidden = composerOpen;
  composeSend.hidden = !composerOpen;

  document.body.classList.toggle("composer-open", composerOpen);

  copy.disabled = !c.localCode;
  copy.textContent =
    c.stage === "answer" ? "Copy Answer" : "Copy Request";

  qr.replaceChildren();

  if (c.localCode && typeof QRCode !== "undefined") {
    try {
      new QRCode(qr, {
        text: c.localCode,
        width: 260,
        height: 260,
        correctLevel: QRCode.CorrectLevel.L
      });
    } catch {
      setError("Could not generate QR code. Use the copy button.");
    }
  }

  paste.hidden = c.stage === "answer";
  $(".setup-separator").hidden = c.stage === "answer";

  if (c.connected) {
    setError("");
  }

  renderMessages();
  renderFilters();
  renderDomainButtons();
  renderVersions();
}

function renderCheckboxMenu(container, options, selected, changed) {
  if (!container) return;

  container.replaceChildren();

  for (const option of options) {
    const label = document.createElement("label");
    label.className = "check-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.has(option.id);

    input.addEventListener("change", () => {
      const next = new Set(selected);

      if (input.checked) {
        next.add(option.id);
      } else {
        next.delete(option.id);
      }

      changed(next);
    });

    const span = document.createElement("span");
    span.textContent = option.label;

    label.append(input, span);
    container.appendChild(label);
  }
}

function renderFilters() {
  const userOptions = [
    { id: "__mine__", label: "You" },
    ...conversations.map(c => ({
      id: c.id,
      label: c.name + (c.connected ? "" : " (not connected)")
    }))
  ];

  renderCheckboxMenu(
    $("#userMenu"),
    userOptions,
    mainUsers,
    next => {
      mainUsers = next;
      renderMessages();
    }
  );

  renderCheckboxMenu(
    $("#composeUserMenu"),
    conversations.map(c => ({
      id: c.id,
      label: c.name + (c.connected ? "" : " (not connected)")
    })),
    composeUsers,
    next => {
      composeUsers = next;
    }
  );
}

function renderDomainMenu(container, selected, changed) {
  renderCheckboxMenu(
    container,
    domainTypes.map(domain => ({
      id: domain,
      label: domain
    })),
    selected,
    changed
  );
}

function renderDomainButtons() {
  renderDomainMenu($("#domainMenu"), mainDomains, next => {
    mainDomains = next;
    renderMessages();
  });

  renderDomainMenu(
    $("#composeDomainMenu"),
    composeDomains,
    next => {
      composeDomains = next;
    }
  );
}

function toggleMenu(id) {
  const menu = $("#" + id);
  if (!menu) return;

  document.querySelectorAll(".filter-menu").forEach(item => {
    if (item !== menu) item.hidden = true;
  });

  menu.hidden = !menu.hidden;
}

document.querySelectorAll("[data-menu]").forEach(button => {
  button.addEventListener("click", () => {
    let menuId = button.dataset.menu;

    if (composerOpen && menuId === "userMenu") {
      menuId = "composeUserMenu";
    }

    if (composerOpen && menuId === "domainMenu") {
      menuId = "composeDomainMenu";
    }

    toggleMenu(menuId);
  });
});

document.addEventListener("click", event => {
  if (!event.target.closest(".toolbar-item")) {
    document.querySelectorAll(".filter-menu").forEach(menu => {
      menu.hidden = true;
    });
  }
});

// Time filtering
$("#timeFilterButton").addEventListener("click", () => {
  toggleMenu("timeMenu");
});

$("#timeMenu").querySelectorAll("[data-time]").forEach(button => {
  button.addEventListener("click", () => {
    timeFilter = button.dataset.time;
    $("#timeMenu").hidden = true;
    renderMessages();
  });
});

// Copy the current request or answer
copy.addEventListener("click", async () => {
  const c = active();

  if (!c || !c.localCode) return;

  try {
    await navigator.clipboard.writeText(c.localCode);

    const previousText = copy.textContent;
    copy.textContent = "Copied";

    setTimeout(() => {
      if (activeId === c.id) {
        copy.textContent = previousText;
      }
    }, 1500);
  } catch {
    setError("Clipboard unavailable. Copy the connection code manually.");
  }
});

// Process a pasted WebRTC request or answer
async function handlePaste() {
  const c = active();

  if (!c || c.busy || !paste.value.trim()) return;

  c.busy = true;
  setError("");

  try {
    await c.p2p.processCode(paste.value.trim(), c.stage);
    paste.value = "";
  } catch (error) {
    setError(error.message || "Could not process connection code.");
  } finally {
    c.busy = false;
  }
}

paste.addEventListener("paste", () => {
  setTimeout(handlePaste, 100);
});

paste.addEventListener("input", () => {
  const value = paste.value.trim();

  if (value.endsWith("}")) {
    handlePaste();
  }
});

// Open the full-screen composer
composeButton.addEventListener("click", () => {
  composerOpen = true;
  setError("");
  render();
  composeText.focus();
});

cancelComposeButton.addEventListener("click", () => {
  composerOpen = false;
  render();
});

// Send to selected connected peers
function sendComposedMessage() {
  const text = composeText.value.trim();

  if (!text) return;

  const recipients = conversations.filter(c =>
    composeUsers.has(c.id) && c.p2p.isConnected()
  );

  if (!recipients.length) {
    setError("Select at least one connected user.");
    return;
  }

  const domains = composeDomains.size
    ? [...composeDomains]
    : ["General"];

  const timestamp = Date.now();
  let sent = 0;
  let failed = 0;

  for (const domain of domains) {
    const payload = JSON.stringify({
      kind: "chat-message",
      text,
      domain,
      timestamp
    });

    for (const c of recipients) {
      try {
        c.p2p.sendMessage(payload);

        addMessage(c, {
          text,
          domain,
          kind: "mine",
          timestamp
        });

        sent++;
      } catch {
        failed++;
      }
    }
  }

  if (sent > 0) {
    composeText.value = "";
    setError("");
    composerOpen = false;
    render();
  }

  if (failed > 0) {
    setError("Some messages could not be sent.");
  }
}

composeSend.addEventListener("click", sendComposedMessage);

composeText.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendComposedMessage();
  }
});

// Download JSON files
function downloadJSON(data, filename) {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function snapshot(name) {
  return {
    id: "v" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 7),
    name: name || new Date().toLocaleString(),
    savedAt: new Date().toISOString(),

    conversations: conversations.map(c => ({
      name: c.name,
      messages: c.messages.map(m => ({ ...m }))
    }))
  };
}

// Version history
function renderVersions() {
  const container = $("#versionsList");
  if (!container) return;

  container.replaceChildren();

  for (const version of versions) {
    const label = document.createElement("label");
    label.className = "check-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selectedVersions.has(version.id);

    input.addEventListener("change", () => {
      if (input.checked) {
        selectedVersions.add(version.id);
      } else {
        selectedVersions.delete(version.id);
      }

      renderVersions();
    });

    const span = document.createElement("span");
    span.textContent =
      version.name + " (" +
      new Date(version.savedAt).toLocaleString() + ")";

    label.append(input, span);
    container.appendChild(label);
  }
}

$("#versionButton").addEventListener("click", () => {
  versionPanel.hidden = !versionPanel.hidden;
  document.querySelectorAll(".filter-menu").forEach(menu => {
    menu.hidden = true;
  });
});

$("#closeVersionPanel").addEventListener("click", () => {
  versionPanel.hidden = true;
});

$("#saveVersionButton").addEventListener("click", () => {
  const name = prompt(
    "Version name:",
    "Version " + (versions.length + 1)
  );

  if (name === null) return;

  const version = snapshot(
    name.trim() || "Version " + (versions.length + 1)
  );

  versions.unshift(version);
  selectedVersions = new Set([version.id]);

  renderVersions();
});

$("#openVersionButton").addEventListener("click", () => {
  const chosen = versions.filter(v => selectedVersions.has(v.id));

  if (!chosen.length) {
    setError("Select a saved version first.");
    return;
  }

  const merged = new Map();

  for (const version of [...chosen].reverse()) {
    for (const saved of version.conversations || []) {
      const key = saved.name || "Chat";

      if (!merged.has(key)) merged.set(key, []);

      for (const message of saved.messages || []) {
        merged.get(key).push(message);
      }
    }
  }

  replaceConversations(
    [...merged.entries()].map(([name, messages]) => ({
      name,
      messages
    }))
  );

  versionPanel.hidden = true;
  setError("");
});

// Export all chats
$("#exportChatsButton").addEventListener("click", () => {
  downloadJSON({
    format: "serverless-p2p-chat",
    version: 2,
    savedAt: new Date().toISOString(),

    conversations: conversations.map(c => ({
      name: c.name,
      messages: c.messages.map(m => ({ ...m }))
    }))
  }, "p2p-chats.json");
});

// Import saved chats
$("#importChatsButton").addEventListener("click", () => {
  fileInput.click();
});

function replaceConversations(savedConversations) {
  conversations.forEach(c => c.p2p.close());

  conversations = [];
  nextId = 1;

  mainUsers = new Set(["__mine__"]);
  composeUsers = new Set();
  mainDomains = new Set();
  composeDomains = new Set();

  for (const saved of savedConversations) {
    const c = newConversation(
      String(saved.name || "User " + nextId).slice(0, 60)
    );

    c.messages = Array.isArray(saved.messages)
      ? saved.messages
          .filter(m =>
            m &&
            typeof m.text === "string" &&
            ["mine", "theirs"].includes(m.kind)
          )
          .map(m => ({
            text: m.text,
            kind: m.kind,
            domain: domainTypes.includes(m.domain)
              ? m.domain
              : "General",
            timestamp: Number(m.timestamp) || Date.now()
          }))
          .sort((a, b) => a.timestamp - b.timestamp)
      : [];
  }

  if (!conversations.length) {
    newConversation();
  }

  activeId = conversations[0].id;
  composerOpen = false;

  render();
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());

    if (!Array.isArray(backup.conversations)) {
      throw new Error("This file is not a valid chat backup.");
    }

    replaceConversations(backup.conversations);
    setError("");
  } catch (error) {
    alert("Could not open chats: " + error.message);
  } finally {
    fileInput.value = "";
  }
});

// Start with a connection request
const first = newConversation("User 1");

activeId = first.id;
render();

first.p2p.createOffer();


import { createP2P } from "./p2p.js";

const $ = selector => document.querySelector(selector);

const setup = $("#setup");
const chat = $("#chat");
const paste = $("#paste");
const copy = $("#copy");
const qr = $("#qrcode");
const errorEl = $("#error");
const messagesEl = $("#messages");
const fileInput = $("#chatFile");
const composeView = $("#composeView");
const composeText = $("#composeText");

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
    viewChat: false,
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
      } catch {}

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
      c.viewChat = false;

      if (activeId === c.id) render();
    },

    onConnectionState: state => {
      c.connected = state.connected;

      if (state.connected) {
        c.viewChat = true;
      }

      if (activeId === c.id) render();

      renderFilters();
    },

    onError: message => {
      if (activeId === c.id) setError(message);
    }
  });

  conversations.push(c);

  if (composeUsers.size === 0) {
    composeUsers.add(c.id);
  }

  mainUsers.add(c.id);

  return c;
}

function addMessage(c, message) {
  c.messages.push({
    ...message,
    timestamp: Number(message.timestamp) || Date.now()
  });

  // Sort and render messages in chronological order.
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
  }[timeFilter];

  return conversations
    .flatMap(c =>
      c.messages.map((m, index) => ({
        ...m,
        userId: c.id,
        userName: c.name,
        index
      }))
    )
    .filter(m =>
      mainUsers.has(m.kind === "mine" ? "__mine__" : m.userId)
    )
    .filter(m =>
      mainDomains.size === 0 ||
      mainDomains.has(m.domain || "General")
    )
    .filter(m => m.timestamp >= cutoff)
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

  // Keep the newest messages at the bottom.
  // New messages force a scroll to the bottom.
  if (wasNearBottom || messagesEl.scrollHeight > 0) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function render() {
  const c = active();

  if (!c) return;

  setup.hidden = c.viewChat && c.connected;
  chat.hidden = !(c.viewChat && c.connected);

  composeView.hidden = !composerOpen;
  $("#timeToolbar").hidden = composerOpen;

  document.body.classList.toggle("composer-open", composerOpen);

  copy.disabled = !c.localCode;

  copy.textContent =
    c.stage === "answer" ? "Copy Answer" : "Copy Request";

  $("#setupTitle").textContent =
    c.stage === "answer" ? "Answer ready" : "Create a connection";

  $("#setupHint").textContent =
    c.stage === "answer"
      ? "Copy this answer and send it to the person who shared the request."
      : "Send this request to the other person.";

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
      setError("Could not generate QR. Use the copy button.");
    }
  }

  paste.hidden = c.stage === "answer";
  $(".divider").hidden = c.stage === "answer";

  renderMessages();
  renderFilters();
  renderDomainButtons();
}

function renderCheckboxMenu(container, options, selected, changed) {
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

// Time filter
$("#timeMenu").querySelectorAll("[data-time]").forEach(button => {
  button.addEventListener("click", () => {
    timeFilter = button.dataset.time;
    $("#timeMenu").hidden = true;
    renderMessages();
  });
});

// Create a new connection
$("#addUser").addEventListener("click", () => {
  const c = newConversation();

  activeId = c.id;
  composerOpen = false;

  setError("");
  render();

  c.p2p.createOffer();
});

$("#newConnection").addEventListener("click", () => {
  const c = active();

  if (!c) return;

  c.viewChat = c.connected;
  render();
});

// Copy offer or answer
copy.addEventListener("click", async () => {
  const c = active();

  if (!c || !c.localCode) return;

  try {
    await navigator.clipboard.writeText(c.localCode);
    copy.textContent = "Copied";
  } catch {
    setError("Clipboard unavailable. Copy the connection code manually.");
  }
});

// Process pasted connection data
async function handlePaste() {
  const c = active();

  if (!c || c.busy || !paste.value.trim()) return;

  c.busy = true;
  setError("");

  try {
    await c.p2p.processCode(paste.value, c.stage);
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
  if (paste.value.trim().endsWith("}")) handlePaste();
});

// Full-screen composer
function openComposer() {
  composerOpen = true;

  composeText.value = "";
  $("#composeError").textContent = "";

  render();
  composeText.focus();
}

function closeComposer() {
  composerOpen = false;
  render();
}

$("#composeOpen").addEventListener("click", openComposer);
$("#composeClose").addEventListener("click", closeComposer);

// Send to all selected connected users.
// If multiple domain types are selected, create one message
// per selected domain type.
$("#composeForm").addEventListener("submit", event => {
  event.preventDefault();

  const text = composeText.value.trim();

  const recipients = conversations.filter(c =>
    composeUsers.has(c.id) &&
    c.p2p.isConnected()
  );

  if (!text) return;

  if (!recipients.length) {
    $("#composeError").textContent =
      "Select at least one connected user.";
    return;
  }

  const domains = composeDomains.size
    ? [...composeDomains]
    : ["General"];

  const timestamp = Date.now();
  let sent = 0;

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
      } catch (error) {
        $("#composeError").textContent =
          error.message || "Could not send message.";
      }
    }
  }

  if (sent) {
    composeText.value = "";
    $("#composeError").textContent = "";
    closeComposer();
  }
});

// Export and import helpers
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

function renderVersions() {
  const container = $("#versionList");
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

$("#saveVersion").addEventListener("click", () => {
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

$("#exportChats").addEventListener("click", () => {
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

$("#openChats").addEventListener("click", () => {
  fileInput.click();
});

$("#openSelectedVersions").addEventListener("click", () => {
  const chosen = versions.filter(v =>
    selectedVersions.has(v.id)
  );

  if (!chosen.length) {
    $("#versionError").textContent =
      "Select one or more versions first.";
    return;
  }

  const merged = new Map();

  // Merge selected snapshots in chronological selection order.
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

  $("#versionMenu").hidden = true;
});

function replaceConversations(savedConversations) {
  conversations.forEach(c => c.p2p.close());

  conversations = [];
  nextId = 1;

  mainUsers = new Set(["__mine__"]);
  composeUsers = new Set();

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

  if (!conversations.length) newConversation();

  activeId = conversations[0].id;
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
  } catch (error) {
    alert("Could not open chats: " + error.message);
  } finally {
    fileInput.value = "";
  }
});

// Version history menu
$("#versionButton").addEventListener("click", () => {
  toggleMenu("versionMenu");
});

// Start with one connection request.
const first = newConversation("User 1");

activeId = first.id;
render();

first.p2p.createOffer();

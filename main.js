
import { createP2P } from "./p2p.js";

const $ = selector => document.querySelector(selector);

const tabsEl = $("#tabs");
const setup = $("#setup");
const chat = $("#chat");
const paste = $("#paste");
const copy = $("#copy");
const qr = $("#qrcode");
const errorEl = $("#error");
const messagesEl = $("#messages");
const messageInput = $("#message");
const sendButton = $("#send");
const fileInput = $("#chatFile");

let conversations = [];
let activeId = null;
let nextId = 1;

function newConversation(name) {
  const number = nextId++;

  const c = {
    id: "c" + number,
    name: name || "Chat " + number,
    p2p: null,
    localCode: "",
    stage: "starting",
    busy: false,
    messages: [],
    viewChat: false,
    connected: false
  };

  c.p2p = createP2P({
    onMessage: text => addMessage(c, text, "theirs"),

    onLocalCode: (code, type) => {
      c.localCode = code;
      c.stage = type;
      c.viewChat = false;

      if (activeId === c.id) renderActive();
    },

    onConnectionState: state => {
      c.connected = state.connected;

      if (state.connected) c.viewChat = true;

      if (activeId === c.id) renderActive();
    },

    onError: text => setActiveError(c, text)
  });

  conversations.push(c);
  return c;
}

function active() {
  return conversations.find(c => c.id === activeId);
}

function setError(text = "") {
  errorEl.textContent = text;
}

function setActiveError(c, text = "") {
  if (activeId === c.id) setError(text);
}

function renderTabs() {
  tabsEl.innerHTML = "";

  conversations.forEach(c => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "tab" + (c.id === activeId ? " active" : "");
    button.textContent = c.name;
    button.title = "Double-click to rename";

    button.addEventListener("click", () => {
      activeId = c.id;
      renderActive();
    });

    button.addEventListener("dblclick", () => {
      const name = prompt("Conversation name:", c.name);

      if (name && name.trim()) {
        c.name = name.trim().slice(0, 40);
        renderTabs();
      }
    });

    tabsEl.appendChild(button);
  });

  const add = document.createElement("button");
  add.type = "button";
  add.className = "tab tab-add";
  add.textContent = "+";
  add.title = "New conversation";
  add.setAttribute("aria-label", "New conversation");

  add.addEventListener("click", () => {
    const c = newConversation();
    activeId = c.id;
    renderActive();
    c.p2p.createOffer();
  });

  tabsEl.appendChild(add);
}

function renderActive() {
  const c = active();
  if (!c) return;

  renderTabs();
  setError("");
  paste.value = "";
  qr.innerHTML = "";

  copy.disabled = !c.localCode;
  copy.textContent =
    c.stage === "answer" ? "Copy Answer" : "Copy Request";

  $("#setupTitle").textContent =
    c.stage === "answer" ? "Answer ready" : "Create a connection";

  $("#setupHint").textContent =
    c.stage === "answer"
      ? "Copy this answer and send it back to the person who shared the request."
      : "Send this request to the other person. They can paste it on their device.";

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

  const divider = $(".divider");

  if (c.stage === "answer") {
    paste.style.display = "none";
    divider.style.display = "none";
  } else {
    paste.style.display = "";
    divider.style.display = "";
  }

  setup.style.display = c.viewChat ? "none" : "block";
  chat.style.display = c.viewChat ? "flex" : "none";

  const connected = c.p2p.isConnected();

  messageInput.disabled = !connected;
  sendButton.disabled = !connected;

  const isChatVisible = c.viewChat && connected;
  $("#openChats").hidden = !isChatVisible;
  $("#saveChats").hidden = !isChatVisible;

  messageInput.value = "";
  messageInput.style.height = "auto";
  messagesEl.innerHTML = "";

  if (!c.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No messages yet";
    messagesEl.appendChild(empty);
  } else {
    c.messages.forEach(m => appendMessageElement(m.text, m.kind));
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessageElement(text, kind) {
  const el = document.createElement("div");
  el.className = "message " + kind;
  el.textContent = text;
  messagesEl.appendChild(el);
}

function addMessage(c, text, kind) {
  c.messages.push({ text, kind });

  if (activeId === c.id) {
    const empty = messagesEl.querySelector(".empty");
    if (empty) empty.remove();

    appendMessageElement(text, kind);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

copy.addEventListener("click", async () => {
  const c = active();
  if (!c || !c.localCode) return;

  try {
    await navigator.clipboard.writeText(c.localCode);
    copy.textContent = "Copied";

    setTimeout(() => {
      if (activeId === c.id) {
        copy.textContent =
          c.stage === "answer" ? "Copy Answer" : "Copy Request";
      }
    }, 1300);
  } catch {
    setError("Clipboard unavailable. Copy the connection code manually.");
  }
});

async function handlePaste() {
  const c = active();
  if (!c || c.busy || !paste.value.trim()) return;

  c.busy = true;
  setError("");

  try {
    await c.p2p.processCode(paste.value, c.stage);
  } finally {
    c.busy = false;
  }
}

paste.addEventListener("paste", () => {
  setTimeout(handlePaste, 100);
});

paste.addEventListener("input", () => {
  if (paste.value.trim().endsWith("}")) {
    handlePaste();
  }
});

$("#composer").addEventListener("submit", event => {
  event.preventDefault();

  const c = active();
  const text = messageInput.value.trim();

  if (!c || !text || !c.p2p.isConnected()) return;

  try {
    c.p2p.sendMessage(text);
    addMessage(c, text, "mine");

    messageInput.value = "";
    messageInput.style.height = "auto";
    messageInput.focus();
  } catch (error) {
    setActiveError(c, error.message);
  }
});

messageInput.addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 130) + "px";
});

messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
});

// Export the conversation names and message histories.
$("#saveChats").addEventListener("click", () => {
  const backup = {
    format: "serverless-p2p-chat",
    version: 1,
    savedAt: new Date().toISOString(),
    conversations: conversations.map(c => ({
      name: c.name,
      messages: c.messages
    }))
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "p2p-chats.json";
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Open a previously exported chat backup.
$("#openChats").addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());

    if (!Array.isArray(backup.conversations)) {
      throw new Error("This file is not a valid chat backup.");
    }

    conversations.forEach(c => c.p2p.close());

    conversations = [];
    nextId = 1;

    backup.conversations.forEach(saved => {
      const c = newConversation(
        String(saved.name || "Chat " + nextId).slice(0, 40)
      );

      c.messages = Array.isArray(saved.messages)
        ? saved.messages
            .filter(m =>
              m &&
              typeof m.text === "string" &&
              (m.kind === "mine" || m.kind === "theirs")
            )
            .map(m => ({ text: m.text, kind: m.kind }))
        : [];
    });

    if (!conversations.length) newConversation();

    activeId = conversations[0].id;
    renderActive();
  } catch (error) {
    alert("Could not open chats: " + error.message);
  } finally {
    fileInput.value = "";
  }
});

// Start with one conversation.
const first = newConversation("Chat 1");
activeId = first.id;
renderActive();
first.p2p.createOffer();

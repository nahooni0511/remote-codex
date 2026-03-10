const state = {
  bootstrap: null,
  selectedProjectId: null,
  selectedThreadId: null,
  mode: "loading",
  sidebarOpen: window.innerWidth > 1100,
  projectExpanded: {},
  threadPageSize: {},
  projectDraft: null,
  authFlow: {
    pendingAuthId: null,
    appName: "",
    apiId: "",
    apiHash: "",
    phoneNumber: "",
    requiresPassword: false,
    passwordHint: "",
  },
  threadCache: new Map(),
  flash: null,
  setupError: null,
  setupSuccess: null,
  projectError: null,
  projectSuccess: null,
  messageError: null,
  messageSuccess: null,
};

const appRoot = document.getElementById("app");
const THREAD_PAGE_SIZE = 10;
const MAX_COMPOSER_HEIGHT = 220;
const discoveryRuntime = {
  setup: {
    sessionId: null,
    data: null,
    poller: null,
    selectedChatId: "",
    selectedChatTitle: "",
    verification: null,
    ownerKey: "setup",
  },
  project: {
    sessionId: null,
    data: null,
    poller: null,
    selectedChatId: "",
    selectedChatTitle: "",
    verification: null,
    ownerKey: null,
  },
};

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "요청에 실패했습니다.");
  }

  return payload;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function primeDiscoveryContext(context, ownerKey, defaults = {}) {
  const runtime = discoveryRuntime[context];

  if (runtime.ownerKey === ownerKey) {
    return;
  }

  if (runtime.sessionId) {
    fetch(`/api/telegram/chat-discovery/${runtime.sessionId}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }

  clearDiscoveryPoller(context);
  runtime.sessionId = null;
  runtime.data = null;
  runtime.poller = null;
  runtime.ownerKey = ownerKey;
  runtime.selectedChatId = defaults.telegramChatId || "";
  runtime.selectedChatTitle = defaults.telegramChatTitle || "";
  runtime.verification = defaults.verification || null;
}

function setSelectedDiscoveryChat(context, chatId, chatTitle) {
  const runtime = discoveryRuntime[context];
  runtime.selectedChatId = chatId || "";
  runtime.selectedChatTitle = chatTitle || "";

  const config = getDiscoveryContextConfig(context);
  const chatInput = document.getElementById(config.chatInputId);
  if (chatInput) {
    chatInput.value = runtime.selectedChatId;
  }
}

function getActiveVerification(context, fallbackConnection = null) {
  return discoveryRuntime[context].verification?.verification || fallbackConnection || null;
}

function renderVerificationSummary(context, fallbackConnection = null) {
  const runtime = discoveryRuntime[context];
  const verification = getActiveVerification(context, fallbackConnection);
  const selectedChatId = runtime.selectedChatId || verification?.telegramChatId || "";
  const selectedChatTitle = runtime.selectedChatTitle || verification?.telegramChatTitle || "";
  const statusMessage = verification
    ? `<div class="success-banner">연결 검증이 완료되었습니다.</div>`
      : selectedChatId
      ? `<div class="badge warning">chat id를 찾았습니다! 이제 연결 검증을 눌러주세요.</div>`
      : `<div class="muted">아직 연결된 Telegram supergroup이 없습니다.</div>`;

  return `
    <div class="panel-block">
      <div class="field-row">
        <strong>검증 결과</strong>
        <small>최근 검증: ${verification?.lastVerifiedAt ? formatDate(verification.lastVerifiedAt) : "-"}</small>
      </div>
      ${statusMessage}
      <div class="status-grid">
        ${connectionBadges(verification).join("")}
      </div>
      <div class="stack">
        <div><strong>Telegram 그룹:</strong> ${escapeHtml(selectedChatTitle || "-")}</div>
      </div>
    </div>
  `;
}

function renderTelegramGuide(context, currentChatId = "") {
  const config = getDiscoveryContextConfig(context);
  const guideTitle =
    context === "setup"
      ? "Telegram forum supergroup 준비"
      : "Telegram supergroup 연결 변경";

  return `
    <div class="panel-block">
      <div class="field-row">
        <strong>${guideTitle}</strong>
        <div class="toolbar">
          <button id="${config.startButtonId}" class="secondary-btn" type="button">탐색 시작</button>
          <button id="${config.stopButtonId}" class="ghost-btn" type="button">중지</button>
          <button id="${config.verifyButtonId}" class="secondary-btn" type="button">연결 검증</button>
        </div>
      </div>
      <div class="guide-steps">
        <div class="guide-step">1. Telegram에서 forum supergroup을 직접 만듭니다.</div>
        <div class="guide-step">2. bot을 그룹에 초대하고 admin으로 올립니다.</div>
        <div class="guide-step">3. 관리자 권한에서 <code>Manage Topics</code>를 켜고 Topics/Forum을 활성화합니다.</div>
        <div class="guide-step">4. 준비됐으면 원하는 채팅방에 정확히 <code>Hello World</code>라고 보내고 <code>탐색 시작</code>을 누르세요.</div>
      </div>
      <input id="${config.chatInputId}" name="telegramChatId" type="hidden" value="${escapeHtml(currentChatId)}" />
      <p class="panel-subtitle">목록에서 <code>이 그룹 사용</code>을 누르면 chat ID를 저장하고, 이어서 <code>연결 검증</code>으로 상태를 확인합니다.</p>
      <div id="${config.statusId}" class="stack"></div>
    </div>
  `;
}

function clearDiscoveryPoller(context) {
  const runtime = discoveryRuntime[context];
  if (runtime?.poller) {
    window.clearInterval(runtime.poller);
    runtime.poller = null;
  }
}

function getDiscoveryContextConfig(context) {
  if (context === "setup") {
    return {
      startButtonId: "setup-chat-discovery-start",
      stopButtonId: "setup-chat-discovery-stop",
      verifyButtonId: "setup-telegram-verify-btn",
      statusId: "setup-chat-discovery-status",
      chatInputId: "setup-telegram-chat-id",
      botTokenInputId: "setup-bot-token",
    };
  }

  return {
    startButtonId: "project-chat-discovery-start",
    stopButtonId: "project-chat-discovery-stop",
    verifyButtonId: "project-telegram-verify-btn",
    statusId: "project-chat-discovery-status",
    chatInputId: "telegram-chat-id-input",
    botTokenInputId: null,
  };
}

function getFolderBrowserConfig(context) {
  if (context === "setup") {
    return {
      buttonId: "setup-folder-browser-toggle",
      inputId: "setup-folder-path",
    };
  }

  return {
    buttonId: "project-folder-browser-toggle",
    inputId: "project-folder-path",
  };
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getThreadSessionBadge(thread) {
  return thread.codexSessionId
    ? `<span class="badge success">codex linked</span>`
    : `<span class="badge warning">codex pending</span>`;
}

function syncProjectNavigationState(projects) {
  const activeProjectIds = new Set(projects.map((project) => project.id));

  Object.keys(state.projectExpanded).forEach((key) => {
    if (!activeProjectIds.has(Number(key))) {
      delete state.projectExpanded[key];
    }
  });

  Object.keys(state.threadPageSize).forEach((key) => {
    if (!activeProjectIds.has(Number(key))) {
      delete state.threadPageSize[key];
    }
  });

  projects.forEach((project) => {
    if (state.projectExpanded[project.id] === undefined) {
      state.projectExpanded[project.id] = project.id === state.selectedProjectId;
    }

    if (!state.threadPageSize[project.id]) {
      state.threadPageSize[project.id] = THREAD_PAGE_SIZE;
    }

    const selectedThreadIndex = project.threads.findIndex((thread) => thread.id === state.selectedThreadId);
    if (project.id === state.selectedProjectId || selectedThreadIndex >= 0) {
      state.projectExpanded[project.id] = true;
    }

    if (selectedThreadIndex >= 0) {
      const minimumVisible = (Math.floor(selectedThreadIndex / THREAD_PAGE_SIZE) + 1) * THREAD_PAGE_SIZE;
      state.threadPageSize[project.id] = Math.max(state.threadPageSize[project.id], minimumVisible);
    }
  });
}

function getVisibleThreads(project) {
  return project.threads.slice(0, state.threadPageSize[project.id] || THREAD_PAGE_SIZE);
}

function getConversationTitle(project, thread) {
  if (thread) {
    return `${project.name} / ${thread.title}`;
  }

  if (state.mode === "project-new") {
    return "새 프로젝트";
  }

  if (project) {
    return project.name;
  }

  return state.bootstrap?.settings?.appName || "Codex Telegram Thread Manager";
}

function renderSidebarProject(project) {
  const isExpanded = Boolean(state.projectExpanded[project.id]);
  const isSelectedProject = project.id === state.selectedProjectId && !state.selectedThreadId;
  const visibleThreads = getVisibleThreads(project);
  const hasMoreThreads = visibleThreads.length < project.threads.length;

  return `
    <section class="sidebar-project ${isSelectedProject ? "selected" : ""}">
      <div class="sidebar-project-header">
        <button
          class="accordion-toggle"
          type="button"
          data-project-toggle="${project.id}"
          aria-expanded="${isExpanded ? "true" : "false"}"
        >
          ${isExpanded ? "▾" : "▸"}
        </button>
        <button class="sidebar-project-name project-select" data-project-id="${project.id}" type="button">
          <span>${escapeHtml(project.name)}</span>
        </button>
      </div>
      ${
        isExpanded
          ? `
            <div class="sidebar-project-body">
              <div class="sidebar-thread-list">
                ${
                  visibleThreads.length
                    ? visibleThreads
                        .map(
                          (thread) => `
                            <button
                              class="sidebar-thread-item thread-select ${thread.id === state.selectedThreadId ? "active" : ""}"
                              data-project-id="${project.id}"
                              data-thread-id="${thread.id}"
                              type="button"
                            >
                              <span class="sidebar-thread-title">${escapeHtml(thread.title)}</span>
                            </button>
                          `,
                        )
                        .join("")
                    : `<div class="sidebar-empty">아직 스레드가 없습니다.</div>`
                }
                ${
                  hasMoreThreads
                    ? `
                      <button class="sidebar-more-btn" data-project-more="${project.id}" type="button">
                        더보기
                      </button>
                    `
                    : ""
                }
              </div>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderConversationMessage(message) {
  const sender = escapeHtml(message.senderName || message.role);
  const date = escapeHtml(formatDate(message.createdAt));
  const body = escapeHtml(message.content);

  if (message.role === "system") {
    return `
      <article class="system-entry">
        <div class="system-entry-meta">${sender} · ${date}</div>
        <div class="system-entry-body">${body}</div>
      </article>
    `;
  }

  const isUser = message.role === "user";

  return `
    <article class="chat-row ${isUser ? "user" : "assistant"}">
      <div class="chat-meta-line">
        <span>${sender}</span>
        <span>${date}</span>
      </div>
      <div class="chat-bubble ${isUser ? "user" : "assistant"}">${body}</div>
    </article>
  `;
}

function resizeComposerTextarea(textarea) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  textarea.style.overflowY = textarea.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
}

async function fetchFsEntries(targetPath) {
  const response = await apiFetch(`/api/fs/list?path=${encodeURIComponent(targetPath)}`);
  return response.entries || [];
}

function getTreeRootPath(selectedPath) {
  if (!selectedPath) {
    return "/";
  }

  const windowsMatch = selectedPath.match(/^[a-zA-Z]:[\\/]/);
  if (windowsMatch) {
    return windowsMatch[0].replace("/", "\\");
  }

  return "/";
}

function getPathSegmentsFromRoot(rootPath, targetPath) {
  if (!targetPath || targetPath === rootPath) {
    return [];
  }

  if (rootPath === "/") {
    return targetPath.split("/").filter(Boolean);
  }

  return targetPath
    .replace(rootPath, "")
    .split(/[\\/]/)
    .filter(Boolean);
}

async function renderFolderNode(entry, inputElement, parentListElement, options = {}) {
  const listItem = document.createElement("li");
  listItem.className = "folder-node compact";

  const row = document.createElement("div");
  row.className = "folder-node-row compact";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "folder-node-toggle compact";
  toggleButton.textContent = entry.hasChildren ? "▸" : "·";
  toggleButton.disabled = !entry.hasChildren;

  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "folder-node-select link-button compact";
  selectButton.textContent = options.isRoot ? entry.path : entry.name || entry.path;
  selectButton.title = entry.path;

  const childList = document.createElement("ul");
  childList.className = "folder-node-children compact";
  childList.hidden = true;

  const setExpanded = (expanded) => {
    toggleButton.dataset.expanded = expanded ? "true" : "false";
    toggleButton.textContent = expanded ? "▾" : "▸";
    childList.hidden = !expanded;
  };

  const loadChildren = async () => {
    if (!entry.hasChildren || childList.dataset.loaded === "true") {
      return;
    }

    childList.innerHTML = `<li class="muted">...</li>`;

    try {
      const children = await fetchFsEntries(entry.path);
      childList.innerHTML = "";

      if (!children.length) {
        childList.innerHTML = `<li class="muted">비어 있음</li>`;
      } else {
        for (const childEntry of children) {
          const nextSegments =
            options.expandSegments?.[0] === childEntry.name ? options.expandSegments.slice(1) : [];
          await renderFolderNode(childEntry, inputElement, childList, {
            expandSegments: nextSegments,
          });
        }
      }

      childList.dataset.loaded = "true";
    } catch (error) {
      childList.innerHTML = `<li class="error-banner">${escapeHtml(error.message)}</li>`;
    }
  };

  row.append(toggleButton, selectButton);
  listItem.append(row, childList);
  parentListElement.appendChild(listItem);

  selectButton.addEventListener("click", () => {
    inputElement.value = entry.path;
    closeFolderBrowserModal();
  });

  toggleButton.addEventListener("click", async () => {
    if (!entry.hasChildren) {
      return;
    }

    const isExpanded = toggleButton.dataset.expanded === "true";
    if (isExpanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);
    await loadChildren();
  });

  if (options.expandSegments?.length || options.isRoot) {
    setExpanded(Boolean(options.expandSegments?.length || options.isRoot));
  }

  if (options.expandSegments?.length || options.isRoot) {
    setExpanded(true);
    await loadChildren();
  }
}

function closeFolderBrowserModal() {
  const modal = document.getElementById("folder-browser-modal");
  if (modal) {
    modal.remove();
  }
}

async function openFolderBrowser(context) {
  const config = getFolderBrowserConfig(context);
  const inputElement = document.getElementById(config.inputId);

  if (!inputElement) {
    return;
  }

  closeFolderBrowserModal();

  const modal = document.createElement("div");
  modal.id = "folder-browser-modal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-backdrop" data-close="true"></div>
    <div class="modal-card app-card">
      <div class="row-between">
        <div>
          <h3 class="panel-title">서버 폴더 트리</h3>
          <p class="panel-subtitle">디렉토리를 클릭하면 선택됩니다.</p>
        </div>
        <button id="folder-browser-close" class="ghost-btn" type="button">닫기</button>
      </div>
      <div class="folder-browser-panel compact">
        <ul class="folder-tree-root"></ul>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#folder-browser-close").addEventListener("click", closeFolderBrowserModal);
  modal.querySelector(".modal-backdrop").addEventListener("click", closeFolderBrowserModal);

  const rootList = modal.querySelector(".folder-tree-root");
  rootList.innerHTML = `<li class="muted">불러오는 중...</li>`;

  try {
    rootList.innerHTML = "";
    const selectedPath = inputElement.value.trim();
    const rootPath = getTreeRootPath(selectedPath);
    await renderFolderNode(
      {
        name: rootPath,
        path: rootPath,
        hasChildren: true,
      },
      inputElement,
      rootList,
      {
        isRoot: true,
        expandSegments: getPathSegmentsFromRoot(rootPath, selectedPath),
      },
    );
  } catch (error) {
    rootList.innerHTML = `<li class="error-banner">${escapeHtml(error.message)}</li>`;
  }
}

function renderDiscoveryStatus(context) {
  const runtime = discoveryRuntime[context];
  const config = getDiscoveryContextConfig(context);
  const container = document.getElementById(config.statusId);

  if (!container) {
    return;
  }

  if (!runtime.data) {
    container.innerHTML = runtime.selectedChatId
      ? `
        <div class="stack">
          <div class="success-banner">chat id를 찾았습니다!</div>
          <div class="folder-browser-panel">
            <div><strong>${escapeHtml(runtime.selectedChatTitle || runtime.selectedChatId)}</strong></div>
            <div class="muted">${escapeHtml(runtime.selectedChatId)}</div>
          </div>
        </div>
      `
      : `<div class="muted">준비가 끝났으면 원하는 채팅방에 <code>Hello World</code>를 보내고 탐색 시작을 누르세요.</div>`;
    return;
  }

  const data = runtime.data;
  const matchesHtml = data.matches?.length
    ? data.matches
        .map(
          (match) => `
            <div class="folder-browser-panel">
              <div class="row-between">
                <strong>${escapeHtml(match.telegramChatTitle)}</strong>
                <button class="secondary-btn chat-discovery-select" data-context="${context}" data-chat-id="${escapeHtml(match.telegramChatId)}" data-chat-title="${escapeHtml(match.telegramChatTitle)}" type="button">이 그룹 사용</button>
              </div>
              <div class="status-grid">
                <span class="badge">${escapeHtml(match.telegramChatId)}</span>
                <span class="badge ${match.forumEnabled ? "success" : "warning"}">${match.forumEnabled ? "forum enabled" : "forum 확인 필요"}</span>
                <span class="badge">${escapeHtml(match.chatType)}</span>
              </div>
              <div class="muted">${escapeHtml(formatDate(match.foundAt))}</div>
            </div>
          `,
        )
        .join("")
    : `<div class="muted">아직 Hello World를 찾지 못했습니다.</div>`;

  const statusTone =
    data.status === "error"
      ? "error-banner"
      : data.status === "found"
        ? "success-banner"
        : "muted";

  container.innerHTML = `
    <div class="stack">
      ${
        runtime.selectedChatId
          ? `
            <div class="success-banner">chat id를 찾았습니다!</div>
            <div class="folder-browser-panel">
              <div><strong>${escapeHtml(runtime.selectedChatTitle || runtime.selectedChatId)}</strong></div>
              <div class="muted">${escapeHtml(runtime.selectedChatId)}</div>
            </div>
          `
          : ""
      }
      <div class="${statusTone}">
        상태: ${escapeHtml(data.status)}
        ${data.error ? ` / ${escapeHtml(data.error)}` : ""}
      </div>
      <div class="muted">원하는 채팅방에서 <code>Hello World</code>를 찾으면 아래에 후보가 나타납니다.</div>
      <div class="muted">후보를 선택한 뒤 <code>연결 검증</code> 버튼을 눌러 forum/admin/topic 권한을 확인하세요.</div>
      ${matchesHtml}
    </div>
  `;

  container.querySelectorAll(".chat-discovery-select").forEach((button) => {
    button.addEventListener("click", async () => {
      setSelectedDiscoveryChat(context, button.dataset.chatId || "", button.dataset.chatTitle || "");
      runtime.verification = null;
      runtime.data = null;

      if (runtime.sessionId) {
        await stopDiscovery(context);
      }

      render();
    });
  });
}

async function pollDiscovery(context) {
  const runtime = discoveryRuntime[context];
  if (!runtime.sessionId) {
    return;
  }

  try {
    const data = await apiFetch(`/api/telegram/chat-discovery/${runtime.sessionId}`);
    runtime.data = data;
    renderDiscoveryStatus(context);

    if (data.status === "error" || data.status === "expired" || data.status === "stopped") {
      clearDiscoveryPoller(context);
    }
  } catch (error) {
    runtime.data = {
      status: "error",
      error: error.message,
      matches: [],
    };
    renderDiscoveryStatus(context);
    clearDiscoveryPoller(context);
  }
}

async function startDiscovery(context) {
  const runtime = discoveryRuntime[context];
  const config = getDiscoveryContextConfig(context);
  const payload = {};

  if (config.botTokenInputId) {
    const botTokenInput = document.getElementById(config.botTokenInputId);
    if (!botTokenInput?.value.trim()) {
      window.alert("먼저 Telegram bot token을 입력하세요.");
      return;
    }

    payload.botToken = botTokenInput.value.trim();
  }

  clearDiscoveryPoller(context);
  setSelectedDiscoveryChat(context, "", "");
  runtime.verification = null;

  const data = await apiFetch("/api/telegram/chat-discovery/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  runtime.sessionId = data.id;
  runtime.data = data;
  render();
  runtime.poller = window.setInterval(() => {
    void pollDiscovery(context);
  }, 2000);
}

async function stopDiscovery(context) {
  const runtime = discoveryRuntime[context];
  if (runtime.sessionId) {
    await fetch(`/api/telegram/chat-discovery/${runtime.sessionId}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }

  clearDiscoveryPoller(context);
  runtime.sessionId = null;
}

function bindFolderBrowsers() {
  ["setup", "project"].forEach((context) => {
    const config = getFolderBrowserConfig(context);
    const button = document.getElementById(config.buttonId);

    if (!button || button.dataset.bound === "true") {
      return;
    }

    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      await openFolderBrowser(context);
    });
  });
}

function bindChatDiscoveryControls() {
  ["setup", "project"].forEach((context) => {
    const config = getDiscoveryContextConfig(context);
    const startButton = document.getElementById(config.startButtonId);
    const stopButton = document.getElementById(config.stopButtonId);
    const verifyButton = document.getElementById(config.verifyButtonId);

    if (startButton && startButton.dataset.bound !== "true") {
      startButton.dataset.bound = "true";
      startButton.addEventListener("click", async () => {
        try {
          await startDiscovery(context);
        } catch (error) {
          discoveryRuntime[context].data = {
            status: "error",
            error: error.message,
            matches: [],
          };
          renderDiscoveryStatus(context);
        }
      });
    }

    if (stopButton && stopButton.dataset.bound !== "true") {
      stopButton.dataset.bound = "true";
      stopButton.addEventListener("click", async () => {
        await stopDiscovery(context);
        discoveryRuntime[context].data = null;
        render();
      });
    }

    if (verifyButton && verifyButton.dataset.bound !== "true") {
      verifyButton.dataset.bound = "true";
      verifyButton.dataset.context = context;
      verifyButton.addEventListener("click", handleVerifyConnection);
    }

    renderDiscoveryStatus(context);
  });
}

function bindMessageComposer() {
  const textarea = document.getElementById("message-input");
  if (!textarea || textarea.dataset.bound === "true") {
    if (textarea) {
      resizeComposerTextarea(textarea);
    }
    return;
  }

  textarea.dataset.bound = "true";
  resizeComposerTextarea(textarea);

  textarea.addEventListener("input", () => {
    resizeComposerTextarea(textarea);
  });

  textarea.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      textarea.form?.requestSubmit();
    }
  });
}

function connectionBadges(connection) {
  if (!connection) {
    return [`<span class="badge warning">미연결</span>`];
  }

  return [
    `<span class="badge ${connection.forumEnabled ? "success" : "danger"}">forum</span>`,
    `<span class="badge ${connection.botIsAdmin ? "success" : "danger"}">admin</span>`,
    `<span class="badge ${connection.canManageTopics ? "success" : "danger"}">topics</span>`,
  ];
}

function getSelectedProject() {
  if (!state.bootstrap?.projects?.length) {
    return null;
  }

  return state.bootstrap.projects.find((project) => project.id === state.selectedProjectId) || null;
}

function getSelectedThread() {
  const project = getSelectedProject();
  if (!project) {
    return null;
  }

  return project.threads.find((thread) => thread.id === state.selectedThreadId) || null;
}

function parseRoute(pathname = window.location.pathname) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const segments = normalized.split("/").filter(Boolean);

  if (!segments.length) {
    return { name: "index" };
  }

  if (segments[0] === "setup") {
    return { name: "setup" };
  }

  if (segments[0] === "projects" && segments[1] === "new") {
    return { name: "project-new" };
  }

  if (segments[0] === "projects" && /^\d+$/.test(segments[1] || "")) {
    const projectId = Number(segments[1]);

    if (segments[2] === "threads" && /^\d+$/.test(segments[3] || "")) {
      return {
        name: "thread",
        projectId,
        threadId: Number(segments[3]),
      };
    }

    return {
      name: "project",
      projectId,
    };
  }

  return { name: "unknown" };
}

function buildRoutePath(route) {
  switch (route.name) {
    case "setup":
      return "/setup";
    case "project-new":
      return "/projects/new";
    case "project":
      return `/projects/${route.projectId}`;
    case "thread":
      return `/projects/${route.projectId}/threads/${route.threadId}`;
    default:
      return "/";
  }
}

function getFallbackRoute() {
  if (!state.bootstrap?.setupComplete) {
    return { name: "setup" };
  }

  const projects = state.bootstrap.projects || [];
  if (!projects.length) {
    return { name: "project-new" };
  }

  return {
    name: "project",
    projectId: projects[0].id,
  };
}

function resolveRoute(route) {
  if (!state.bootstrap?.setupComplete) {
    return { name: "setup" };
  }

  const projects = state.bootstrap.projects || [];

  if (route.name === "project-new") {
    return route;
  }

  if (route.name === "project") {
    const project = projects.find((item) => item.id === route.projectId);
    return project ? route : getFallbackRoute();
  }

  if (route.name === "thread") {
    const project = projects.find((item) => item.id === route.projectId);
    const thread = project?.threads.find((item) => item.id === route.threadId);
    return project && thread ? route : getFallbackRoute();
  }

  return getFallbackRoute();
}

function applyRouteState(route) {
  if (route.name === "setup") {
    state.mode = "setup";
    state.selectedProjectId = null;
    state.selectedThreadId = null;
    return;
  }

  if (route.name === "project-new") {
    state.mode = "project-new";
    state.selectedProjectId = null;
    state.selectedThreadId = null;
    state.projectDraft = {
      id: null,
      name: "",
      folderPath: "",
      connection: null,
    };
    return;
  }

  state.mode = "main";
  state.projectDraft = null;
  state.selectedProjectId = route.projectId;
  state.selectedThreadId = route.name === "thread" ? route.threadId : null;

  if (state.selectedProjectId) {
    state.projectExpanded[state.selectedProjectId] = true;
  }
}

async function syncRouteState({ replace = false } = {}) {
  const resolvedRoute = resolveRoute(parseRoute());
  const targetPath = buildRoutePath(resolvedRoute);

  if (window.location.pathname !== targetPath) {
    window.history[replace ? "replaceState" : "pushState"]({}, "", targetPath);
  }

  applyRouteState(resolvedRoute);

  if (resolvedRoute.name === "thread") {
    await loadThreadMessages(resolvedRoute.threadId);
  }

  render();
}

async function navigateToRoute(route, { replace = false } = {}) {
  const targetPath = buildRoutePath(route);
  if (window.location.pathname !== targetPath) {
    window.history[replace ? "replaceState" : "pushState"]({}, "", targetPath);
  }

  await syncRouteState({ replace: true });
}

async function loadBootstrap() {
  const data = await apiFetch("/api/bootstrap");
  state.bootstrap = data;

  if (!data.setupComplete) {
    state.projectExpanded = {};
    state.threadPageSize = {};
    return;
  }

  const projects = data.projects || [];
  if (!projects.length) {
    state.projectExpanded = {};
    state.threadPageSize = {};
    return;
  }

  syncProjectNavigationState(projects);
}

function render() {
  if (!state.bootstrap || state.mode === "loading") {
    appRoot.innerHTML = `
      <main class="app-shell">
        <section class="app-card empty-state">불러오는 중...</section>
      </main>
    `;
    return;
  }

  if (!state.bootstrap.setupComplete || state.mode === "setup") {
    renderSetup();
    return;
  }

  renderMain();
}

function renderSetup() {
  appRoot.innerHTML = `
    <main class="app-shell">
      <section class="setup-layout">
        <article class="setup-hero app-card">
          <div>
            <span class="setup-kicker">Codex x Telegram</span>
            <h1>내 Telegram 계정으로 로그인해 forum supergroup을 직접 만듭니다.</h1>
            <p>이제 Bot API 대신 MTProto 사용자 세션으로 동작합니다. 웹에서 보낸 메시지는 로그인한 Telegram 사용자 이름으로 전송됩니다.</p>
            <div class="checklist">
              <div class="check-item">로그인 완료 후 새 프로젝트를 만들면 forum supergroup이 자동 생성됩니다.</div>
              <div class="check-item">프로젝트 생성에는 그룹 이름과 로컬 폴더 경로만 필요합니다.</div>
              <div class="check-item">웹에서 보내는 메시지는 내 계정으로 topic에 기록됩니다.</div>
            </div>
          </div>
          <p>Telegram API ID와 API Hash는 <code>my.telegram.org</code>에서 발급받아야 합니다.</p>
        </article>
        <section class="setup-form app-card">
          <h2>Telegram 로그인</h2>
          <p>API 키와 전화번호로 로그인 코드를 요청하고, 필요하면 2단계 인증 비밀번호까지 입력합니다.</p>
          ${state.setupError ? `<div class="error-banner">${escapeHtml(state.setupError)}</div>` : ""}
          ${state.setupSuccess ? `<div class="success-banner">${escapeHtml(state.setupSuccess)}</div>` : ""}
          <form id="auth-send-code-form" class="form-grid">
            <label class="form-field">
              <span>앱 이름</span>
              <input name="appName" value="${escapeHtml(state.authFlow.appName)}" placeholder="예: Codex Thread Manager" required />
            </label>
            <label class="form-field">
              <span>Telegram API ID</span>
              <input name="apiId" value="${escapeHtml(state.authFlow.apiId)}" placeholder="123456" required />
            </label>
            <label class="form-field">
              <span>Telegram API Hash</span>
              <input name="apiHash" value="${escapeHtml(state.authFlow.apiHash)}" placeholder="0123456789abcdef..." required />
            </label>
            <label class="form-field">
              <span>전화번호</span>
              <input name="phoneNumber" value="${escapeHtml(state.authFlow.phoneNumber)}" placeholder="+821012345678" required />
            </label>
            <button class="primary-btn" type="submit">
              ${state.authFlow.pendingAuthId ? "코드 다시 보내기" : "로그인 코드 보내기"}
            </button>
          </form>
          ${
            state.authFlow.pendingAuthId
              ? `
                <div class="panel-block">
                  <h3 class="panel-title">코드 확인</h3>
                  <p class="panel-subtitle">${escapeHtml(state.authFlow.phoneNumber)} 로 받은 Telegram 코드를 입력하세요.</p>
                  <form id="auth-verify-code-form" class="form-grid">
                    <label class="form-field">
                      <span>로그인 코드</span>
                      <input name="phoneCode" placeholder="12345" required />
                    </label>
                    <button class="primary-btn" type="submit">코드 확인</button>
                  </form>
                </div>
              `
              : ""
          }
          ${
            state.authFlow.pendingAuthId && state.authFlow.requiresPassword
              ? `
                <div class="panel-block">
                  <h3 class="panel-title">2단계 인증</h3>
                  <p class="panel-subtitle">비밀번호 힌트: ${escapeHtml(state.authFlow.passwordHint || "-")}</p>
                  <form id="auth-verify-password-form" class="form-grid">
                    <label class="form-field">
                      <span>Telegram 2FA 비밀번호</span>
                      <input name="password" type="password" required />
                    </label>
                    <button class="primary-btn" type="submit">로그인 완료</button>
                  </form>
                </div>
              `
              : ""
          }
        </section>
      </section>
    </main>
  `;

  document.getElementById("auth-send-code-form").addEventListener("submit", handleSetupSubmit);
  document.getElementById("auth-verify-code-form")?.addEventListener("submit", handleAuthVerifyCode);
  document
    .getElementById("auth-verify-password-form")
    ?.addEventListener("submit", handleAuthVerifyPassword);
}

function renderMain() {
  const projects = state.bootstrap.projects || [];
  const selectedProject = getSelectedProject();
  const selectedThread = getSelectedThread();
  const conversationTitle = getConversationTitle(selectedProject, selectedThread);

  appRoot.innerHTML = `
    <main class="workspace-shell ${state.sidebarOpen ? "sidebar-open" : "sidebar-closed"}">
      <button id="sidebar-backdrop" class="sidebar-backdrop" type="button" aria-label="사이드바 닫기"></button>
      <section class="workspace-frame">
        <aside class="workspace-sidebar app-card ${state.sidebarOpen ? "open" : "closed"}">
          <div class="workspace-sidebar-header">
            <button id="new-project-btn" class="sidebar-primary-action" type="button">새 프로젝트</button>
          </div>
          <div class="sidebar-divider"></div>
          <div class="workspace-sidebar-scroll">
            <div class="sidebar-section-label">스레드</div>
            <div class="sidebar-projects">
              ${
                projects.length
                  ? projects.map((project) => renderSidebarProject(project)).join("")
                  : `<div class="sidebar-empty">아직 프로젝트가 없습니다.</div>`
              }
            </div>
          </div>
        </aside>
        <section class="workspace-main app-card">
          <div class="workspace-topbar">
            <div class="workspace-leading">
              <button id="sidebar-toggle-btn" class="nav-icon-btn" type="button" aria-label="사이드바 토글">☰</button>
              <div>
                <h2 class="workspace-title">${escapeHtml(conversationTitle)}</h2>
              </div>
            </div>
            <div class="workspace-actions">
              <button id="refresh-btn" class="ghost-btn" type="button">새로고침</button>
            </div>
          </div>
          <div class="workspace-content">
            ${renderContentPanel(selectedProject, selectedThread)}
          </div>
        </section>
      </section>
    </main>
  `;

  document.getElementById("sidebar-toggle-btn").addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    render();
  });

  document.getElementById("sidebar-backdrop").addEventListener("click", () => {
    state.sidebarOpen = false;
    render();
  });

  document.getElementById("refresh-btn").addEventListener("click", async () => {
    await refreshApp();
  });

  document.getElementById("new-project-btn").addEventListener("click", async () => {
    state.projectError = null;
    state.projectSuccess = null;
    state.sidebarOpen = window.innerWidth > 980 ? state.sidebarOpen : false;
    await navigateToRoute({ name: "project-new" });
  });

  document.querySelectorAll(".project-select").forEach((button) => {
    button.addEventListener("click", async () => {
      const projectId = Number(button.dataset.projectId);
      state.projectError = null;
      state.projectSuccess = null;
      state.projectExpanded[projectId] = true;
      if (window.innerWidth <= 980) {
        state.sidebarOpen = false;
      }
      await navigateToRoute({ name: "project", projectId });
    });
  });

  document.querySelectorAll("[data-project-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const projectId = Number(button.dataset.projectToggle);
      state.projectExpanded[projectId] = !state.projectExpanded[projectId];
      render();
    });
  });

  document.querySelectorAll("[data-project-more]").forEach((button) => {
    button.addEventListener("click", () => {
      const projectId = Number(button.dataset.projectMore);
      state.threadPageSize[projectId] = (state.threadPageSize[projectId] || THREAD_PAGE_SIZE) + THREAD_PAGE_SIZE;
      render();
    });
  });

  document.querySelectorAll(".thread-select").forEach((button) => {
    button.addEventListener("click", async () => {
      const projectId = Number(button.dataset.projectId);
      const threadId = Number(button.dataset.threadId);
      state.messageError = null;
      state.messageSuccess = null;
      state.projectExpanded[projectId] = true;
      if (window.innerWidth <= 980) {
        state.sidebarOpen = false;
      }
      await navigateToRoute({ name: "thread", projectId, threadId });
    });
  });

  document.querySelectorAll(".create-thread-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const projectId = Number(button.dataset.projectId);
      const title = window.prompt("새 thread 제목을 입력하세요.");
      if (!title || !title.trim()) {
        return;
      }

      try {
        const thread = await apiFetch(`/api/projects/${projectId}/threads`, {
          method: "POST",
          body: JSON.stringify({ title: title.trim() }),
        });
        state.flash = "새 thread와 Telegram topic을 생성했습니다.";
        await refreshApp();
        await navigateToRoute({
          name: "thread",
          projectId,
          threadId: thread.id,
        });
      } catch (error) {
        state.projectError = error.message;
        render();
      }
    });
  });

  const projectForm = document.getElementById("project-form");
  if (projectForm) {
    projectForm.addEventListener("submit", handleProjectSave);
  }

  const messageForm = document.getElementById("message-form");
  if (messageForm) {
    messageForm.addEventListener("submit", handleMessageSubmit);
  }

  const backButton = document.getElementById("back-to-project-btn");
  if (backButton) {
    backButton.addEventListener("click", async () => {
      state.messageError = null;
      state.messageSuccess = null;
      if (selectedProject) {
        await navigateToRoute({ name: "project", projectId: selectedProject.id });
      }
    });
  }

  const reloadThreadButton = document.getElementById("reload-thread-btn");
  if (reloadThreadButton) {
    reloadThreadButton.addEventListener("click", async () => {
      if (state.selectedThreadId) {
        await loadThreadMessages(state.selectedThreadId);
        render();
      }
    });
  }

  const cancelProjectButton = document.getElementById("cancel-project-btn");
  if (cancelProjectButton) {
    cancelProjectButton.addEventListener("click", async () => {
      state.projectDraft = null;
      await navigateToRoute(getFallbackRoute(), { replace: true });
    });
  }

  bindFolderBrowsers();
  bindMessageComposer();
}

function renderContentPanel(project, thread) {
  if (state.flash) {
    const flash = `<div class="success-banner">${escapeHtml(state.flash)}</div>`;
    state.flash = null;
    return `${flash}${renderContentPanel(project, thread)}`;
  }

  if (thread) {
    return renderThreadPanel(project, thread);
  }

  if (state.mode === "project-new") {
    return renderProjectPanel(state.projectDraft, true);
  }

  if (project) {
    return renderProjectPanel(
      {
        id: project.id,
        name: project.name,
        folderPath: project.folderPath,
        connection: project.connection,
      },
      false,
    );
  }

  return `
    <div class="empty-state">
      좌측에서 project를 선택하거나 새 project를 만드세요.
    </div>
  `;
}

function renderProjectPanel(project, isNew) {
  return `
    <section class="panel">
      <div class="panel-block">
        <h2 class="panel-title">${isNew ? "새 project" : "Project 상세"}</h2>
        <p class="panel-subtitle">${isNew ? "그룹 이름과 폴더 경로만 입력하면 forum supergroup을 자동으로 만들고 연결합니다." : "생성된 Telegram forum supergroup과 연결된 프로젝트입니다."}</p>
        ${state.projectError ? `<div class="error-banner">${escapeHtml(state.projectError)}</div>` : ""}
        ${state.projectSuccess ? `<div class="success-banner">${escapeHtml(state.projectSuccess)}</div>` : ""}
        ${
          !isNew && project?.connection && !project.connection.telegramAccessHash
            ? `<div class="error-banner">이 프로젝트는 이전 Bot API 연결 데이터입니다. 새 프로젝트로 다시 생성하는 편이 안전합니다.</div>`
            : ""
        }
        <form id="project-form" class="form-grid" data-project-id="${project?.id || ""}">
          <label class="form-field">
            <span>그룹 이름</span>
            <input
              name="groupName"
              value="${escapeHtml(project?.name || "")}"
              ${isNew ? `placeholder="예: Remote Codex"` : "readonly"}
              required
            />
          </label>
          <div class="split-grid">
            <label class="form-field">
              <div class="field-row">
                <span>로컬 폴더 경로</span>
                <button id="project-folder-browser-toggle" class="secondary-btn" type="button">폴더 탐색</button>
              </div>
              <input id="project-folder-path" name="folderPath" value="${escapeHtml(project?.folderPath || "")}" placeholder="/absolute/path" required />
            </label>
          </div>
          ${
            !isNew && project?.connection?.telegramChatTitle
              ? `
                <div class="panel-block">
                  <div><strong>Telegram 그룹:</strong> ${escapeHtml(project.connection.telegramChatTitle)}</div>
                </div>
              `
              : ""
          }
          <div class="toolbar">
            <button class="primary-btn" type="submit">${isNew ? "project 생성" : "저장"}</button>
            ${
              isNew
                ? `<button id="cancel-project-btn" class="ghost-btn" type="button">취소</button>`
                : ""
            }
          </div>
        </form>
      </div>
      ${
        !isNew && project?.id
          ? `
            <div class="panel-block">
              <h3 class="panel-title">새 thread 만들기</h3>
              <button class="primary-btn create-thread-btn" data-project-id="${project.id}" type="button">새 thread 생성</button>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderThreadPanel(project, thread) {
  const cache = state.threadCache.get(thread.id);
  const messages = cache?.messages || [];

  return `
    <section class="conversation-shell">
      <div class="conversation-header panel-block">
        <div>
          <h2 class="panel-title">${escapeHtml(thread.title)}</h2>
          <p class="panel-subtitle">${escapeHtml(project.name)}</p>
        </div>
      </div>
      <div class="conversation-feed panel-block">
        ${state.messageError ? `<div class="error-banner">${escapeHtml(state.messageError)}</div>` : ""}
        ${state.messageSuccess ? `<div class="success-banner">${escapeHtml(state.messageSuccess)}</div>` : ""}
        <div class="conversation-stream">
          ${
            messages.length
              ? messages
                  .map((message) => renderConversationMessage(message))
                  .join("")
              : `<div class="empty-state conversation-empty">메시지가 없습니다. Telegram topic이나 아래 입력창에서 첫 메시지를 보내면 Codex 세션이 시작됩니다.</div>`
          }
        </div>
      </div>
      <div class="composer-card panel-block">
        <form id="message-form" class="composer-form" data-thread-id="${thread.id}">
          <textarea
            id="message-input"
            class="composer-input"
            name="content"
            rows="1"
            placeholder="메시지 입력"
            required
          ></textarea>
          <div class="composer-footer">
            <button class="primary-btn composer-send-btn" type="submit">보내기</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

async function handleSetupSubmit(event) {
  event.preventDefault();
  state.setupError = null;
  state.setupSuccess = null;

  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());

  try {
    const result = await apiFetch("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.authFlow = {
      pendingAuthId: result.pendingAuthId,
      appName: String(payload.appName || ""),
      apiId: String(payload.apiId || ""),
      apiHash: String(payload.apiHash || ""),
      phoneNumber: String(payload.phoneNumber || ""),
      requiresPassword: false,
      passwordHint: "",
    };
    state.setupSuccess = "Telegram 로그인 코드를 보냈습니다.";
    render();
  } catch (error) {
    state.setupError = error.message;
    render();
  }
}

async function handleAuthVerifyCode(event) {
  event.preventDefault();
  state.setupError = null;
  state.setupSuccess = null;

  if (!state.authFlow.pendingAuthId) {
    state.setupError = "먼저 로그인 코드를 요청하세요.";
    render();
    return;
  }

  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());

  try {
    const result = await apiFetch("/api/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({
        pendingAuthId: state.authFlow.pendingAuthId,
        appName: state.authFlow.appName,
        phoneCode: payload.phoneCode,
      }),
    });

    if (result.requiresPassword) {
      state.authFlow.requiresPassword = true;
      state.authFlow.passwordHint = result.passwordHint || "";
      state.setupSuccess = "2단계 인증 비밀번호가 필요합니다.";
      render();
      return;
    }

    state.authFlow = {
      pendingAuthId: null,
      appName: "",
      apiId: "",
      apiHash: "",
      phoneNumber: "",
      requiresPassword: false,
      passwordHint: "",
    };
    await refreshApp();
  } catch (error) {
    state.setupError = error.message;
    render();
  }
}

async function handleAuthVerifyPassword(event) {
  event.preventDefault();
  state.setupError = null;
  state.setupSuccess = null;

  if (!state.authFlow.pendingAuthId) {
    state.setupError = "먼저 로그인 코드를 요청하세요.";
    render();
    return;
  }

  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());

  try {
    await apiFetch("/api/auth/verify-password", {
      method: "POST",
      body: JSON.stringify({
        pendingAuthId: state.authFlow.pendingAuthId,
        appName: state.authFlow.appName,
        password: payload.password,
      }),
    });

    state.authFlow = {
      pendingAuthId: null,
      appName: "",
      apiId: "",
      apiHash: "",
      phoneNumber: "",
      requiresPassword: false,
      passwordHint: "",
    };
    await refreshApp();
  } catch (error) {
    state.setupError = error.message;
    render();
  }
}

async function handleProjectSave(event) {
  event.preventDefault();
  state.projectError = null;
  state.projectSuccess = null;

  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const payload = Object.fromEntries(form.entries());
  const projectId = formElement.dataset.projectId;

  try {
    if (projectId) {
      await apiFetch(`/api/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      state.projectSuccess = "project를 저장했습니다.";
      await refreshApp();
      await navigateToRoute({ name: "project", projectId: Number(projectId) }, { replace: true });
    } else {
      const createdProject = await apiFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.projectSuccess = "project를 생성했습니다.";
      await refreshApp();
      await navigateToRoute({ name: "project", projectId: createdProject.id }, { replace: true });
    }
  } catch (error) {
    state.projectError = error.message;
    render();
  }
}

async function handleVerifyConnection() {
  const context = this.dataset.context || "project";
  const config = getDiscoveryContextConfig(context);
  const runtime = discoveryRuntime[context];
  const chatId = document.getElementById(config.chatInputId)?.value.trim() || "";

  if (context === "setup") {
    state.setupError = null;
    state.setupSuccess = null;
  } else {
    state.projectError = null;
    state.projectSuccess = null;
  }

  if (!chatId) {
    if (context === "setup") {
      state.setupError = "먼저 Hello World 탐색으로 Telegram supergroup을 선택하세요.";
    } else {
      state.projectError = "먼저 Hello World 탐색으로 Telegram supergroup을 선택하세요.";
    }
    render();
    return;
  }

  try {
    let result;

    if (context === "setup") {
      const botToken = document.getElementById("setup-bot-token")?.value.trim();
      if (!botToken) {
        state.setupError = "먼저 Telegram bot token을 입력하세요.";
        render();
        return;
      }

      result = await apiFetch("/api/telegram/verify-connection", {
        method: "POST",
        body: JSON.stringify({
          botToken,
          telegramChatId: chatId,
        }),
      });
      runtime.verification = result;
      setSelectedDiscoveryChat(context, result.verification.telegramChatId, result.verification.telegramChatTitle || "");
      state.setupSuccess = `검증 완료: ${result.verification.telegramChatTitle || result.verification.telegramChatId}`;
      render();
      return;
    }

    const projectForm = document.getElementById("project-form");
    const projectId = projectForm.dataset.projectId;

    if (projectId) {
      result = await apiFetch(`/api/projects/${projectId}/telegram/verify`, {
        method: "POST",
        body: JSON.stringify({ telegramChatId: chatId }),
      });
      runtime.verification = result;
      setSelectedDiscoveryChat(context, result.verification.telegramChatId, result.verification.telegramChatTitle || "");
      state.projectSuccess = `검증 완료: ${result.verification.telegramChatTitle || result.verification.telegramChatId}`;
      await refreshApp();
      return;
    }

    result = await apiFetch("/api/telegram/verify-connection", {
      method: "POST",
      body: JSON.stringify({ telegramChatId: chatId }),
    });
    runtime.verification = result;
    setSelectedDiscoveryChat(context, result.verification.telegramChatId, result.verification.telegramChatTitle || "");
    state.projectSuccess = `검증 완료: ${result.verification.telegramChatTitle || result.verification.telegramChatId}`;
    render();
  } catch (error) {
    runtime.verification = null;
    if (context === "setup") {
      state.setupError = error.message;
    } else {
      state.projectError = error.message;
    }
    render();
  }
}

async function loadThreadMessages(threadId) {
  if (!threadId) {
    return;
  }

  const data = await apiFetch(`/api/threads/${threadId}/messages`);
  state.threadCache.set(threadId, data);
}

async function handleMessageSubmit(event) {
  event.preventDefault();
  state.messageError = null;
  state.messageSuccess = null;

  const formElement = event.currentTarget;
  const threadId = Number(formElement.dataset.threadId);
  const form = new FormData(formElement);
  const payload = Object.fromEntries(form.entries());

  try {
    await apiFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.messageSuccess = null;
    formElement.reset();
    resizeComposerTextarea(formElement.querySelector("textarea[name='content']"));
    await loadThreadMessages(threadId);
    await refreshApp();
  } catch (error) {
    if (error.message.includes("Connected Telegram topic was deleted")) {
      state.flash = "Telegram에서 topic이 삭제되어 연결된 thread도 함께 삭제했습니다.";
      state.selectedThreadId = null;
      await refreshApp();
      return;
    }

    state.messageError = error.message;
    render();
  }
}

async function refreshApp() {
  await loadBootstrap();
  await syncRouteState({ replace: true });
}

async function boot() {
  try {
    window.addEventListener("popstate", () => {
      void syncRouteState({ replace: true });
    });

    await refreshApp();
  } catch (error) {
    appRoot.innerHTML = `
      <main class="app-shell">
        <section class="app-card empty-state">
          초기 로딩 실패: ${escapeHtml(error.message)}
        </section>
      </main>
    `;
  }
}

boot();

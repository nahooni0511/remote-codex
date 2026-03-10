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
    apiId: "",
    apiHash: "",
    phoneNumber: "",
    botToken: "",
    botUserName: "",
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
  composerDrafts: {},
};

const appRoot = document.getElementById("app");
const THREAD_PAGE_SIZE = 10;
const MAX_COMPOSER_HEIGHT = 220;
let liveWorkspaceRefreshInFlight = false;
let realtimeSocket = null;
let realtimeReconnectTimer = null;
let pendingWorkspaceSyncTimer = null;
const pendingThreadSyncTimers = new Map();

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

  return "Codex Telegram Thread Manager";
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

function renderMessageAttachment(message) {
  if (!message.attachmentKind) {
    return "";
  }

  const attachmentUrl = `/api/messages/${message.id}/attachment`;
  const filename = escapeHtml(message.attachmentFilename || "attachment");

  if (message.attachmentKind === "image") {
    return `
      <div class="message-attachment">
        <img class="message-attachment-image" src="${attachmentUrl}" alt="${filename}" loading="lazy" />
      </div>
    `;
  }

  return `
    <div class="message-attachment">
      <a class="message-attachment-link" href="${attachmentUrl}" target="_blank" rel="noreferrer">${filename}</a>
    </div>
  `;
}

function renderConversationMessage(message) {
  const sender = escapeHtml(message.senderName || message.role);
  const date = escapeHtml(formatDate(message.createdAt));
  const body = escapeHtml(message.content);
  const attachment = renderMessageAttachment(message);

  if (message.role === "system") {
    return `
      <article class="system-entry">
        <div class="system-entry-meta">${sender} · ${date}</div>
        <div class="system-entry-body">${body}</div>
        ${attachment}
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
      <div class="chat-bubble ${isUser ? "user" : "assistant"}">
        <div class="chat-bubble-body">${body}</div>
        ${attachment}
      </div>
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

function buildRealtimeUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function clearRealtimeReconnectTimer() {
  if (!realtimeReconnectTimer) {
    return;
  }

  window.clearTimeout(realtimeReconnectTimer);
  realtimeReconnectTimer = null;
}

function scheduleWorkspaceSync(delay = 120) {
  if (pendingWorkspaceSyncTimer) {
    window.clearTimeout(pendingWorkspaceSyncTimer);
  }

  pendingWorkspaceSyncTimer = window.setTimeout(async () => {
    pendingWorkspaceSyncTimer = null;
    if (liveWorkspaceRefreshInFlight) {
      return;
    }

    liveWorkspaceRefreshInFlight = true;
    try {
      await refreshApp();
    } catch (error) {
      console.error("Realtime workspace sync failed:", error);
    } finally {
      liveWorkspaceRefreshInFlight = false;
    }
  }, delay);
}

function scheduleThreadSync(threadId, delay = 40) {
  if (!threadId) {
    return;
  }

  const existingTimer = pendingThreadSyncTimers.get(threadId);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(async () => {
    pendingThreadSyncTimers.delete(threadId);

    if (state.selectedThreadId !== threadId) {
      return;
    }

    try {
      await loadThreadMessages(threadId);
      render();
    } catch (error) {
      console.error("Realtime thread sync failed:", error);
    }
  }, delay);

  pendingThreadSyncTimers.set(threadId, timer);
}

function handleRealtimeEvent(event) {
  if (!event || typeof event.type !== "string") {
    return;
  }

  if (event.type === "thread-messages-updated" && Number.isInteger(event.threadId)) {
    scheduleThreadSync(event.threadId);
    scheduleWorkspaceSync();
    return;
  }

  if (event.type === "workspace-updated") {
    scheduleWorkspaceSync();
  }
}

function connectRealtime() {
  if (realtimeSocket && (realtimeSocket.readyState === WebSocket.OPEN || realtimeSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  clearRealtimeReconnectTimer();

  try {
    realtimeSocket = new WebSocket(buildRealtimeUrl());
  } catch (error) {
    console.error("Realtime socket init failed:", error);
    realtimeReconnectTimer = window.setTimeout(connectRealtime, 1500);
    return;
  }

  realtimeSocket.addEventListener("message", (messageEvent) => {
    try {
      handleRealtimeEvent(JSON.parse(messageEvent.data));
    } catch (error) {
      console.error("Realtime message parse failed:", error);
    }
  });

  realtimeSocket.addEventListener("close", () => {
    realtimeSocket = null;
    clearRealtimeReconnectTimer();
    realtimeReconnectTimer = window.setTimeout(connectRealtime, 1500);
  });

  realtimeSocket.addEventListener("error", () => {
    try {
      realtimeSocket?.close();
    } catch {
      realtimeSocket = null;
    }
  });
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
    if (state.selectedThreadId) {
      state.composerDrafts[state.selectedThreadId] = textarea.value;
    }
    resizeComposerTextarea(textarea);
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      textarea.form?.requestSubmit();
    }
  });
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
  updateLiveWorkspaceRefreshLoop();
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
            <p>MTProto 사용자 세션으로 동작합니다. 웹에서 보낸 메시지는 로그인한 Telegram 사용자 이름으로 전송됩니다.</p>
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
            <label class="form-field">
              <span>Telegram bot token</span>
              <input name="botToken" value="${escapeHtml(state.authFlow.botToken)}" placeholder="123456:ABCDEF..." required />
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
                  <p class="panel-subtitle">${escapeHtml(state.authFlow.phoneNumber)} 로 받은 Telegram 코드를 입력하세요. Codex 응답은 @${escapeHtml(state.authFlow.botUserName || "bot")} 이 전송합니다.</p>
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

  const deleteProjectButton = document.getElementById("delete-project-btn");
  if (deleteProjectButton) {
    deleteProjectButton.addEventListener("click", handleProjectDelete);
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
                : `<button id="delete-project-btn" class="ghost-btn" type="button">project 삭제</button>`
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
  const draft = state.composerDrafts[thread.id] || "";

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
          >${escapeHtml(draft)}</textarea>
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
      apiId: String(payload.apiId || ""),
      apiHash: String(payload.apiHash || ""),
      phoneNumber: String(payload.phoneNumber || ""),
      botToken: String(payload.botToken || ""),
      botUserName: String(result.botUserName || ""),
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
        phoneCode: payload.phoneCode,
        botToken: state.authFlow.botToken,
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
      apiId: "",
      apiHash: "",
      phoneNumber: "",
      botToken: "",
      botUserName: "",
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
        password: payload.password,
        botToken: state.authFlow.botToken,
      }),
    });

    state.authFlow = {
      pendingAuthId: null,
      apiId: "",
      apiHash: "",
      phoneNumber: "",
      botToken: "",
      botUserName: "",
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

async function handleProjectDelete() {
  const project = getSelectedProject();
  if (!project) {
    return;
  }

  const confirmed = window.confirm(
    `정말 "${project.name}" project를 삭제할까요?\n로컬 DB의 project, thread, message 기록이 삭제됩니다.\nTelegram supergroup 자체는 삭제하지 않습니다.`,
  );

  if (!confirmed) {
    return;
  }

  state.projectError = null;
  state.projectSuccess = null;

  try {
    await apiFetch(`/api/projects/${project.id}`, {
      method: "DELETE",
    });

    state.flash = "project를 삭제했습니다.";
    state.threadCache.clear();
    await refreshApp();
  } catch (error) {
    state.projectError = error.message;
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
  const submittedContent = String(payload.content || "");
  const textarea = formElement.querySelector("textarea[name='content']");

  state.composerDrafts[threadId] = "";
  formElement.reset();
  if (textarea) {
    textarea.value = "";
    resizeComposerTextarea(textarea);
  }

  try {
    await apiFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.messageSuccess = null;
  } catch (error) {
    if (error.message.includes("Connected Telegram topic was deleted")) {
      state.flash = "Telegram에서 topic이 삭제되어 연결된 thread도 함께 삭제했습니다.";
      state.selectedThreadId = null;
      await refreshApp();
      return;
    }

    state.composerDrafts[threadId] = submittedContent;
    state.messageError = error.message;
    render();
  }
}

async function refreshApp() {
  await loadBootstrap();
  await syncRouteState({ replace: true });
}

async function refreshWorkspaceLive() {
  if (liveWorkspaceRefreshInFlight) {
    return;
  }

  if (state.mode !== "main" || !state.bootstrap?.setupComplete) {
    return;
  }

  if (document.visibilityState === "hidden") {
    return;
  }

  if (state.selectedThreadId && document.activeElement?.id === "message-input") {
    return;
  }

  liveWorkspaceRefreshInFlight = true;

  try {
    await refreshApp();
  } catch (error) {
    console.error("Live workspace refresh failed:", error);
  } finally {
    liveWorkspaceRefreshInFlight = false;
  }
}

function updateLiveWorkspaceRefreshLoop() {
  return;
}

async function boot() {
  try {
    window.addEventListener("popstate", () => {
      void syncRouteState({ replace: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void refreshWorkspaceLive();
      }
    });

    connectRealtime();
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

const DEFAULT_LAYOUT = {
    notes: { x: 0.02, y: 0.05, width: 0.31, height: 0.47, z: 1 },
    tasks: { x: 0.35, y: 0.05, width: 0.28, height: 0.47, z: 2 },
    music: { x: 0.65, y: 0.05, width: 0.33, height: 0.47, z: 3 },
    timer: { x: 0.02, y: 0.57, width: 0.24, height: 0.24, z: 4 },
    sound: { x: 0.28, y: 0.57, width: 0.22, height: 0.18, z: 5 }
};

const PANEL_MIN_WIDTH = 220;
const PANEL_MIN_HEIGHT = 170;

const state = {
    user: null,
    notes: "",
    tasks: [],
    links: [],
    layout: cloneLayout(DEFAULT_LAYOUT),
    activeLinkUrl: ""
};

const body = document.body;
const layoutStage = document.getElementById("layout-stage");
const panels = Array.from(document.querySelectorAll(".panel-card"));
const panelMap = new Map(panels.map((panel) => [panel.dataset.panelId, panel]));

const authScreen = document.getElementById("auth-screen");
const loginForm = document.getElementById("login-form");
const loginUsername = document.getElementById("login-username");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const accountName = document.getElementById("account-name");
const logoutButton = document.getElementById("logout-btn");

const notesArea = document.getElementById("notes-area");
const taskInput = document.getElementById("task-input");
const taskList = document.getElementById("task-list");
const taskEmpty = document.getElementById("task-empty");
const linkTitleInput = document.getElementById("link-title-input");
const linkUrlInput = document.getElementById("link-url-input");
const addLinkButton = document.getElementById("add-link-btn");
const linkList = document.getElementById("link-list");
const linkEmpty = document.getElementById("link-empty");
const playerArea = document.getElementById("player-area");
const saveStatus = document.getElementById("save-status");
const muteButton = document.getElementById("mute-btn");
const minutesInput = document.getElementById("minutes");
const display = document.getElementById("display");
const video = document.getElementById("video-background");

let timer = null;
let remainingSeconds = 0;
let saveTimeout = null;
let suppressLayoutObserver = false;
let activeDrag = null;
let resizeFrame = null;

function cloneLayout(layout) {
    return JSON.parse(JSON.stringify(layout));
}

function setStatus(text) {
    saveStatus.textContent = text;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getNumeric(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function showLoginError(message = "") {
    loginError.textContent = message;
    loginError.hidden = !message;
}

function setAuthenticated(user) {
    state.user = user;
    accountName.textContent = user.username;
    body.classList.remove("app-locked");
    body.classList.add("app-ready");
}

function setLoggedOut() {
    state.user = null;
    accountName.textContent = "Guest";
    body.classList.remove("app-ready");
    body.classList.add("app-locked");
    showLoginError("");
    authScreen.removeAttribute("aria-hidden");
}

function getStageWidth() {
    return Math.max(layoutStage.clientWidth, 1);
}

function getStageHeight() {
    return Math.max(layoutStage.clientHeight, 1);
}

function getMinWidthRatio(stageWidth) {
    return Math.min(0.96, PANEL_MIN_WIDTH / Math.max(stageWidth, 1));
}

function getMinHeightRatio(stageHeight) {
    return Math.min(0.96, PANEL_MIN_HEIGHT / Math.max(stageHeight, 1));
}

function normalizeLayoutEntry(layoutEntry, fallbackEntry, stageWidth, stageHeight) {
    const width = clamp(
        getNumeric(layoutEntry?.width, fallbackEntry.width),
        getMinWidthRatio(stageWidth),
        0.96
    );
    const height = clamp(
        getNumeric(layoutEntry?.height, fallbackEntry.height),
        getMinHeightRatio(stageHeight),
        0.96
    );
    const x = clamp(getNumeric(layoutEntry?.x, fallbackEntry.x), 0, 1 - width);
    const y = clamp(getNumeric(layoutEntry?.y, fallbackEntry.y), 0, 1 - height);
    const z = Math.max(1, Math.round(getNumeric(layoutEntry?.z, fallbackEntry.z)));

    return { x, y, width, height, z };
}

function normalizeLayout(layout) {
    const normalized = {};
    const stageWidth = getStageWidth();
    const stageHeight = getStageHeight();

    Object.keys(DEFAULT_LAYOUT).forEach((panelId) => {
        normalized[panelId] = normalizeLayoutEntry(
            layout?.[panelId],
            DEFAULT_LAYOUT[panelId],
            stageWidth,
            stageHeight
        );
    });

    return normalized;
}

function updateStageSize() {
    const stageHeight = Math.max(window.innerHeight - 10, 1100);
    layoutStage.style.height = `${stageHeight}px`;
}

function applyLayout() {
    updateStageSize();
    const stageWidth = getStageWidth();
    const stageHeight = getStageHeight();

    suppressLayoutObserver = true;
    state.layout = normalizeLayout(state.layout);

    Object.entries(state.layout).forEach(([panelId, layoutEntry]) => {
        const panel = panelMap.get(panelId);
        if (!panel) {
            return;
        }

        panel.style.left = `${Math.round(layoutEntry.x * stageWidth)}px`;
        panel.style.top = `${Math.round(layoutEntry.y * stageHeight)}px`;
        panel.style.width = `${Math.round(layoutEntry.width * stageWidth)}px`;
        panel.style.height = `${Math.round(layoutEntry.height * stageHeight)}px`;
        panel.style.zIndex = String(layoutEntry.z);
    });

    requestAnimationFrame(() => {
        suppressLayoutObserver = false;
    });
}

function bringPanelToFront(panelId) {
    const currentEntry = state.layout[panelId];
    if (!currentEntry) {
        return;
    }

    const highestZ = Math.max(...Object.values(state.layout).map((entry) => entry.z || 1));
    if (currentEntry.z < highestZ) {
        currentEntry.z = highestZ + 1;
        const panel = panelMap.get(panelId);
        if (panel) {
            panel.style.zIndex = String(currentEntry.z);
        }
    }
}

function syncLayoutEntryFromPanel(panelId) {
    const panel = panelMap.get(panelId);
    if (!panel) {
        return;
    }

    const stageWidth = getStageWidth();
    const stageHeight = getStageHeight();
    const currentEntry = state.layout[panelId] || DEFAULT_LAYOUT[panelId];

    state.layout[panelId] = normalizeLayoutEntry(
        {
            x: panel.offsetLeft / stageWidth,
            y: panel.offsetTop / stageHeight,
            width: panel.offsetWidth / stageWidth,
            height: panel.offsetHeight / stageHeight,
            z: currentEntry.z
        },
        DEFAULT_LAYOUT[panelId],
        stageWidth,
        stageHeight
    );
}

function syncAllLayoutEntriesFromPanels() {
    panelMap.forEach((_, panelId) => {
        syncLayoutEntryFromPanel(panelId);
    });
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    if (response.status === 401) {
        setLoggedOut();
        throw new Error("Authentication required");
    }

    if (!response.ok) {
        let message = "Request failed";
        try {
            const errorPayload = await response.json();
            message = errorPayload.detail || message;
        } catch (error) {
            void error;
        }
        throw new Error(message);
    }

    return response.json();
}

async function fetchSession() {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (response.status === 401) {
        return null;
    }
    if (!response.ok) {
        throw new Error("Failed to check session");
    }
    return response.json();
}

async function loadContent() {
    const data = await fetchJson("/api/content");
    state.notes = data.notes || "";
    state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    state.links = Array.isArray(data.links) ? data.links : [];
    state.layout = normalizeLayout(data.layout || cloneLayout(DEFAULT_LAYOUT));
    state.activeLinkUrl = state.links.some((link) => link.url === state.activeLinkUrl)
        ? state.activeLinkUrl
        : (state.links[0]?.url || "");

    notesArea.value = state.notes;
    renderTasks();
    renderLinks();
    updateTimerDisplay();
    applyLayout();
    setStatus("Loaded");
}

async function persistState() {
    if (!state.user) {
        return;
    }

    setStatus("Saving...");
    const saved = await fetchJson("/api/content", {
        method: "POST",
        body: JSON.stringify({
            notes: state.notes,
            tasks: state.tasks,
            layout: state.layout,
            links: state.links
        })
    });

    state.layout = normalizeLayout(saved.layout || state.layout);
    state.links = Array.isArray(saved.links) ? saved.links : state.links;
    setStatus("Saved");
}

function scheduleSave(statusText = "Changes pending...") {
    if (!state.user) {
        return;
    }

    clearTimeout(saveTimeout);
    setStatus(statusText);
    saveTimeout = setTimeout(async () => {
        try {
            await persistState();
        } catch (error) {
            console.error(error);
            setStatus("Save failed");
        }
    }, 350);
}

function renderTasks() {
    taskList.innerHTML = "";
    taskEmpty.classList.toggle("hidden", state.tasks.length > 0);

    state.tasks.forEach((task, index) => {
        const item = document.createElement("li");
        item.className = "task-item";

        const main = document.createElement("div");
        main.className = "task-main";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "task-check";
        checkbox.checked = !!task.done;
        checkbox.addEventListener("change", () => {
            state.tasks[index].done = checkbox.checked;
            renderTasks();
            scheduleSave("Task updated...");
        });

        const label = document.createElement("span");
        label.className = `task-text${task.done ? " done" : ""}`;
        label.textContent = task.text;

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "danger";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => {
            state.tasks.splice(index, 1);
            renderTasks();
            scheduleSave("Task updated...");
        });

        main.appendChild(checkbox);
        main.appendChild(label);
        item.appendChild(main);
        item.appendChild(deleteButton);
        taskList.appendChild(item);
    });
}

function createYoutubeEmbed(link) {
    if (link.includes("youtube.com/watch?v=")) {
        return link.split("v=")[1].split("&")[0];
    }
    if (link.includes("youtu.be/")) {
        return link.split("youtu.be/")[1].split("?")[0];
    }
    return null;
}

function loadMusic(url) {
    state.activeLinkUrl = url || "";
    if (!url) {
        playerArea.innerHTML = '<span class="empty-text">Bir link sec.</span>';
        return;
    }

    const videoId = createYoutubeEmbed(url);
    if (videoId) {
        playerArea.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" title="Music player" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
        return;
    }

    playerArea.innerHTML = `<div style="text-align:center; padding: 18px;"><a href="${url}" target="_blank" rel="noreferrer" style="color: #f0b36d;">Open external link</a></div>`;
}

function renderLinks() {
    linkList.innerHTML = "";
    linkEmpty.classList.toggle("hidden", state.links.length > 0);

    state.links.forEach((link, index) => {
        const item = document.createElement("li");
        item.className = "link-item";

        const label = document.createElement("div");
        label.className = "link-label";
        label.textContent = link.title;

        const actions = document.createElement("div");
        actions.className = "link-actions";

        const playButton = document.createElement("button");
        playButton.type = "button";
        playButton.className = "primary";
        playButton.textContent = state.activeLinkUrl === link.url ? "Playing" : "Play";
        playButton.addEventListener("click", () => {
            loadMusic(link.url);
            renderLinks();
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "danger";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => {
            const wasActive = state.activeLinkUrl === link.url;
            state.links.splice(index, 1);
            if (wasActive) {
                state.activeLinkUrl = state.links[0]?.url || "";
            }
            renderLinks();
            loadMusic(state.activeLinkUrl);
            scheduleSave("Links updated...");
        });

        actions.appendChild(playButton);
        actions.appendChild(deleteButton);
        item.appendChild(label);
        item.appendChild(actions);
        linkList.appendChild(item);
    });

    if (!state.activeLinkUrl && state.links[0]) {
        state.activeLinkUrl = state.links[0].url;
    }
    loadMusic(state.activeLinkUrl);
}

function addTask() {
    const text = taskInput.value.trim();
    if (!text) {
        return;
    }

    state.tasks.unshift({ text, done: false });
    taskInput.value = "";
    renderTasks();
    scheduleSave("Task updated...");
}

function addLink() {
    const url = linkUrlInput.value.trim();
    if (!url) {
        return;
    }

    const title = linkTitleInput.value.trim() || `Link ${state.links.length + 1}`;
    state.links.unshift({ title, url });
    linkTitleInput.value = "";
    linkUrlInput.value = "";
    state.activeLinkUrl = url;
    renderLinks();
    scheduleSave("Links updated...");
}

function updateTimerDisplay() {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    display.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startTimer() {
    clearInterval(timer);
    remainingSeconds = Number(minutesInput.value) * 60;
    if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
        remainingSeconds = 0;
        updateTimerDisplay();
        return;
    }

    updateTimerDisplay();
    timer = setInterval(() => {
        remainingSeconds -= 1;
        updateTimerDisplay();

        if (remainingSeconds <= 0) {
            clearInterval(timer);
            alert("Focus session complete!");
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            oscillator.connect(audioContext.destination);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 1);
        }
    }, 1000);
}

function toggleMute() {
    video.muted = !video.muted;
    muteButton.textContent = video.muted ? "Sound Off" : "Sound On";
}

function startDrag(event) {
    if (event.button !== 0) {
        return;
    }
    if (event.target.closest("[data-no-drag]")) {
        return;
    }

    const panel = event.currentTarget.closest(".panel-card");
    if (!panel) {
        return;
    }

    const panelId = panel.dataset.panelId;
    syncLayoutEntryFromPanel(panelId);
    bringPanelToFront(panelId);
    activeDrag = {
        panelId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: panel.offsetLeft,
        startTop: panel.offsetTop
    };

    body.classList.add("dragging");
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    event.preventDefault();
}

function handleDragMove(event) {
    if (!activeDrag) {
        return;
    }

    const panel = panelMap.get(activeDrag.panelId);
    if (!panel) {
        return;
    }

    const nextLeft = clamp(activeDrag.startLeft + event.clientX - activeDrag.startX, 0, Math.max(0, getStageWidth() - panel.offsetWidth));
    const nextTop = clamp(activeDrag.startTop + event.clientY - activeDrag.startY, 0, Math.max(0, getStageHeight() - panel.offsetHeight));
    panel.style.left = `${Math.round(nextLeft)}px`;
    panel.style.top = `${Math.round(nextTop)}px`;
    syncLayoutEntryFromPanel(activeDrag.panelId);
    setStatus("Layout changed...");
}

function stopDrag() {
    if (!activeDrag) {
        return;
    }

    syncLayoutEntryFromPanel(activeDrag.panelId);
    activeDrag = null;
    body.classList.remove("dragging");
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
    scheduleSave("Layout changed...");
}

const resizeObserver = new ResizeObserver((entries) => {
    if (suppressLayoutObserver) {
        return;
    }

    entries.forEach((entry) => {
        const panelId = entry.target.dataset.panelId;
        if (!panelId) {
            return;
        }
        bringPanelToFront(panelId);
        syncLayoutEntryFromPanel(panelId);
    });

    scheduleSave("Layout changed...");
});

function handleWindowResize() {
    if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = requestAnimationFrame(() => {
        syncAllLayoutEntriesFromPanels();
        applyLayout();
    });
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    showLoginError("");

    try {
        const user = await fetchJson("/api/login", {
            method: "POST",
            body: JSON.stringify({
                username: loginUsername.value,
                password: loginPassword.value
            })
        });

        setAuthenticated(user);
        loginPassword.value = "";
        await loadContent();
    } catch (error) {
        console.error(error);
        showLoginError(error.message || "Sign in failed");
    }
}

async function handleLogout() {
    try {
        await fetchJson("/api/logout", { method: "POST", body: JSON.stringify({}) });
    } catch (error) {
        console.error(error);
    }

    state.notes = "";
    state.tasks = [];
    state.links = [];
    state.layout = cloneLayout(DEFAULT_LAYOUT);
    notesArea.value = "";
    taskInput.value = "";
    linkTitleInput.value = "";
    linkUrlInput.value = "";
    state.activeLinkUrl = "";
    renderTasks();
    renderLinks();
    applyLayout();
    setLoggedOut();
}

async function bootstrap() {
    panels.forEach((panel) => {
        resizeObserver.observe(panel);
        const handle = panel.querySelector(".drag-handle");
        if (handle) {
            handle.addEventListener("pointerdown", startDrag);
        }
    });

    updateStageSize();
    renderTasks();
    renderLinks();
    updateTimerDisplay();
    applyLayout();

    try {
        const user = await fetchSession();
        if (!user) {
            setLoggedOut();
            setStatus("Sign in required");
            return;
        }

        setAuthenticated(user);
        await loadContent();
    } catch (error) {
        console.error(error);
        setLoggedOut();
        setStatus("Server needed");
        showLoginError("Sunucuya baglanilamadi.");
    }
}

notesArea.addEventListener("input", () => {
    state.notes = notesArea.value;
    scheduleSave("Typing...");
});

loginForm.addEventListener("submit", handleLoginSubmit);
logoutButton.addEventListener("click", handleLogout);
document.getElementById("add-task-btn").addEventListener("click", addTask);
taskInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        addTask();
    }
});
addLinkButton.addEventListener("click", addLink);
linkUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        addLink();
    }
});
document.getElementById("start-timer-btn").addEventListener("click", startTimer);
muteButton.addEventListener("click", toggleMute);
window.addEventListener("resize", handleWindowResize);

bootstrap();

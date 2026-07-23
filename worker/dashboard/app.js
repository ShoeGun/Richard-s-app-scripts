const state = {
  snapshot: null,
  ladder: [],
  availableChannels: [],
  operatorLoaded: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const formatNumber = (value) => new Intl.NumberFormat("en-US", { notation: value > 999999 ? "compact" : "standard" }).format(value || 0);
const relativeTime = (value) => {
  if (!value) return "Never";
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000);
  if (Math.abs(seconds) < 60) return `${Math.abs(seconds)}s ago`;
  const minutes = Math.round(Math.abs(seconds) / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = error ? "show error" : "show";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = ""; }, 3200);
}

async function api(url, options) {
  const response = await fetch(url, {
    headers: options?.body ? { "content-type": "application/json" } : {},
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function renderHeader(snapshot) {
  const totals = snapshot.telemetry.summary?.totals || {};
  const modelEntries = Object.entries(snapshot.telemetry.summary?.models || {});
  const localTokens = modelEntries
    .filter(([model]) => !model.startsWith("gpt-"))
    .reduce((sum, [, usage]) => sum + (usage.totalTokens || 0), 0);
  const share = totals.totalTokens ? Math.round((localTokens / totals.totalTokens) * 100) : 100;
  $("#worker-status").textContent = snapshot.worker.status;
  $("#worker-status").style.color = snapshot.worker.status === "running" ? "var(--green)" : "";
  $("#active-task").textContent = snapshot.worker.currentTaskId || "None";
  $("#total-tokens").textContent = formatNumber(totals.totalTokens);
  $("#local-share").textContent = `${share}%`;
  $("#last-sync").textContent = relativeTime(snapshot.paperclip.lastSyncedAt);
}

function renderRouting(snapshot) {
  state.ladder = snapshot.routing.ladder.map((item) => ({ ...item }));
  state.availableChannels = snapshot.routing.availableChannels.map((item) => ({ ...item }));
  $("#routing-flow").innerHTML = state.ladder.map((channel, index) => `
    <div class="route-node ${channel.type === "codex" ? "frontier" : "local"}">
      <span class="tier">${channel.type === "codex" ? "FRONTIER FALLBACK" : `LOCAL TIER ${index + 1}`}</span>
      <strong>${escapeHtml(channel.model || channel.id)}</strong>
      <span>${escapeHtml(channel.id)} · ${channel.autoInvoke ? "automatic" : "manual"}</span>
    </div>
  `).join("");
}

function renderServices(snapshot) {
  $("#service-list").innerHTML = snapshot.services.map((service) => `
    <div class="service ${service.ok ? "ok" : ""}">
      <i></i>
      <strong>${escapeHtml(service.name)}</strong>
      <span>${service.ok ? `${service.latencyMs} ms` : "offline"}</span>
    </div>
  `).join("");
}

function renderPipeline(snapshot) {
  const groups = [
    ["pending", "Queued"],
    ["running", "Executing"],
    ["awaiting_escalation", "Escalating"],
    ["blocked", "Blocked"],
    ["completed", "Completed"]
  ];
  const counts = Object.fromEntries(groups.map(([key]) => [key, snapshot.tasks.filter((task) => task.status === key).length]));
  $("#pipeline-summary").textContent = `${snapshot.tasks.length} tasks · ${counts.completed} completed`;
  $("#pipeline").innerHTML = groups.map(([key, label]) => {
    const current = snapshot.tasks.find((task) => task.status === key);
    return `<div class="pipeline-stage">
      <span class="stage-label">${label.toUpperCase()}</span>
      <strong class="count">${counts[key]}</strong>
      <span class="task-name">${current ? `${escapeHtml(current.id)} · ${escapeHtml(current.title)}` : "No task in this stage"}</span>
    </div>`;
  }).join("");
}

function renderTimeline(snapshot) {
  const events = snapshot.telemetry.events.slice(0, 12);
  $("#timeline").innerHTML = events.length ? events.map((event) => `
    <div class="event">
      <time>${new Date(event.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
      <span class="task">${escapeHtml(event.taskId || "system")}</span>
      <strong class="model">${escapeHtml(event.model)}</strong>
      <span class="phase">${escapeHtml(event.phase)}</span>
      <span class="token-kind ${event.usage.exact ? "" : "estimated"}">${formatNumber(event.usage.totalTokens)}</span>
    </div>
  `).join("") : `<p class="muted" style="padding: 22px 0">Inference telemetry will appear after the next model call.</p>`;
}

function renderTasks(snapshot) {
  $("#task-count").textContent = `${snapshot.tasks.length} total`;
  $("#task-table").innerHTML = snapshot.tasks.map((task) => `
    <tr>
      <td>
        <span class="task-title"><span class="task-id">${escapeHtml(task.id)}</span>${escapeHtml(task.title)}</span>
        <span class="task-objective">${escapeHtml(task.objective)}</span>
      </td>
      <td><span class="badge ${escapeHtml(task.status)}">${escapeHtml(task.status.replaceAll("_", " "))}</span></td>
      <td>${task.dependsOn.length ? task.dependsOn.map(escapeHtml).join(", ") : "—"}</td>
      <td>${task.attempts} <span class="muted">(${task.repairCycles} repair)</span></td>
      <td>${formatNumber(task.tokens.totalTokens)}${task.tokens.estimatedCalls ? " *" : ""}</td>
      <td>${escapeHtml(task.escalationChannel || "—")}</td>
    </tr>
  `).join("");
}

function renderUsageList(selector, entries) {
  const max = Math.max(...entries.map(([, usage]) => usage.totalTokens || 0), 1);
  $(selector).innerHTML = entries.length ? entries
    .sort((a, b) => (b[1].totalTokens || 0) - (a[1].totalTokens || 0))
    .map(([name, usage]) => `
      <div class="usage-row">
        <div class="usage-meta">
          <strong>${escapeHtml(name)}</strong>
          <span>${formatNumber(usage.totalTokens)} tokens · ${usage.calls} calls · ${usage.estimatedCalls || 0} estimated</span>
        </div>
        <div class="bar"><i style="width:${Math.max(2, Math.round((usage.totalTokens / max) * 100))}%"></i></div>
      </div>
    `).join("") : `<p class="muted">No inference data yet.</p>`;
}

function renderTelemetry(snapshot) {
  renderUsageList("#model-usage", Object.entries(snapshot.telemetry.summary?.models || {}));
  renderUsageList("#agent-usage", Object.entries(snapshot.telemetry.summary?.agents || {}));
  renderLadderEditor();
}

function renderLadderEditor() {
  const included = state.ladder.map((channel, index) => `
    <div class="ladder-row">
      <span class="ladder-index">${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(channel.id)}</strong><small>${escapeHtml(channel.model || channel.type)}</small></div>
      <span class="badge ${channel.type === "codex" ? "awaiting_escalation" : "running"}">${escapeHtml(channel.type)}</span>
      <div class="ladder-actions">
        <button data-move="${index}" data-direction="-1" aria-label="Move ${escapeHtml(channel.id)} up">↑</button>
        <button data-move="${index}" data-direction="1" aria-label="Move ${escapeHtml(channel.id)} down">↓</button>
        <button data-remove="${escapeHtml(channel.id)}" aria-label="Remove ${escapeHtml(channel.id)} from ladder">×</button>
      </div>
    </div>
  `).join("");
  const activeIds = new Set(state.ladder.map((channel) => channel.id));
  const available = state.availableChannels.filter((channel) => channel.enabled && !activeIds.has(channel.id));
  const experiments = available.length ? `
    <p class="eyebrow" style="margin-top:18px">AVAILABLE EXPERIMENTS</p>
    ${available.map((channel) => `
      <div class="ladder-row">
        <span class="ladder-index">+</span>
        <div><strong>${escapeHtml(channel.id)}</strong><small>${escapeHtml(channel.model || channel.type)} · ${channel.autoInvoke ? "automatic" : "manual"}</small></div>
        <span class="badge">${escapeHtml(channel.type)}</span>
        <div class="ladder-actions"><button data-add="${escapeHtml(channel.id)}" aria-label="Add ${escapeHtml(channel.id)} to ladder">+</button></div>
      </div>
    `).join("")}
  ` : "";
  $("#ladder-editor").innerHTML = included + experiments;
  $$("[data-move]").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.move);
    const target = index + Number(button.dataset.direction);
    if (target < 0 || target >= state.ladder.length) return;
    [state.ladder[index], state.ladder[target]] = [state.ladder[target], state.ladder[index]];
    renderLadderEditor();
  }));
  $$("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    if (state.ladder.length === 1) return toast("The ladder needs at least one channel.", true);
    state.ladder = state.ladder.filter((channel) => channel.id !== button.dataset.remove);
    renderLadderEditor();
  }));
  $$("[data-add]").forEach((button) => button.addEventListener("click", () => {
    const channel = state.availableChannels.find((item) => item.id === button.dataset.add);
    if (channel) state.ladder.push({ ...channel });
    renderLadderEditor();
  }));
}

function render(snapshot) {
  state.snapshot = snapshot;
  renderHeader(snapshot);
  renderRouting(snapshot);
  renderServices(snapshot);
  renderPipeline(snapshot);
  renderTimeline(snapshot);
  renderTasks(snapshot);
  renderTelemetry(snapshot);
}

async function refresh() {
  try {
    render(await api("/api/status"));
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadOperatorContext() {
  if (state.operatorLoaded) return;
  try {
    const context = await api("/api/operator-context");
    Object.entries(context).forEach(([key, value]) => {
      const editor = document.getElementById(key);
      if (editor) editor.value = value;
    });
    state.operatorLoaded = true;
  } catch (error) {
    toast(error.message, true);
  }
}

$$(".tab").forEach((tab) => tab.addEventListener("click", () => {
  $$(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${tab.dataset.view}`));
  if (tab.dataset.view === "operator") loadOperatorContext();
}));

$$(".editor-tab").forEach((tab) => tab.addEventListener("click", () => {
  $$(".editor-tab").forEach((item) => item.classList.toggle("active", item === tab));
  $$(".context-editor").forEach((editor) => editor.classList.toggle("active", editor.id === tab.dataset.editor));
}));

$$("[data-action]").forEach((button) => button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    await api("/api/control", { method: "POST", body: JSON.stringify({ action: button.dataset.action }) });
    toast(`Worker ${button.dataset.action} requested.`);
    setTimeout(refresh, 900);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}));

$("#sync-button").addEventListener("click", async () => {
  try {
    await api("/api/control", { method: "POST", body: JSON.stringify({ action: "sync" }) });
    toast("Paperclip synchronized.");
    refresh();
  } catch (error) {
    toast(error.message, true);
  }
});

$("#save-ladder").addEventListener("click", async () => {
  try {
    await api("/api/escalation/ladder", {
      method: "POST",
      body: JSON.stringify({ ids: state.ladder.map((channel) => channel.id) })
    });
    toast("Escalation ladder saved.");
    refresh();
  } catch (error) {
    toast(error.message, true);
  }
});

$("#save-context").addEventListener("click", async () => {
  try {
    await api("/api/operator-context", {
      method: "POST",
      body: JSON.stringify({
        activePlan: $("#activePlan").value,
        testPatterns: $("#testPatterns").value,
        guardrails: $("#guardrails").value
      })
    });
    toast("Operator context saved.");
  } catch (error) {
    toast(error.message, true);
  }
});

refresh();
setInterval(refresh, 5000);

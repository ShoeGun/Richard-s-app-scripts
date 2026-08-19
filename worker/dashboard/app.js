const state = {
  snapshot: null,
  ladder: [],
  availableChannels: [],
  operatorLoaded: false
};
const connectionDocs = {
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/settings/keys",
  github: "https://github.com/settings/personal-access-tokens/new",
  copilot: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
  zai: "https://z.ai/subscribe",
  google: "https://aistudio.google.com/app/apikey",
  elevenlabs: "https://elevenlabs.io/app/developers/api-keys",
  resemble: "https://app.resemble.ai/account/api"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const formatNumber = (value) => new Intl.NumberFormat("en-US", { notation: value > 999999 ? "compact" : "standard" }).format(value || 0);
const formatUsd = (value) => value === null || value === undefined
  ? "unavailable"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: value < 0.01 ? 4 : 2, maximumFractionDigits: 4 }).format(value);
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
  const localTokens = (snapshot.policy?.providerBudgets || [])
    .filter((provider) => provider.class === "local")
    .reduce((sum, provider) => sum + (provider.allTimeTokens || 0), 0);
  const share = totals.totalTokens ? Math.round((localTokens / totals.totalTokens) * 100) : 100;
  $("#worker-status").textContent = snapshot.worker.status;
  $("#worker-status").style.color = snapshot.worker.status === "running" ? "var(--green)" : "";
  $("#active-task").textContent = snapshot.worker.currentTaskId || "None";
  $("#total-tokens").textContent = formatNumber(totals.totalTokens);
  $("#local-share").textContent = `${share}%`;
  $("#last-sync").textContent = relativeTime(snapshot.paperclip.lastSyncedAt);
}

function renderGoal(snapshot) {
  const goal = snapshot.goal || {};
  $("#goal-title").textContent = goal.title || "Current loop";
  $("#goal-objective").textContent = goal.objective || "";
  $("#goal-progress").textContent = `${goal.progressPercent || 0}%`;
  $("#goal-completed").textContent = `${goal.completedTasks || 0} / ${goal.totalTasks || 0}`;
  $("#goal-tokens").textContent = formatNumber(goal.totalTokens);
  $("#goal-frontier-tokens").textContent = formatNumber(goal.frontierTokens);
  $("#goal-milestone").textContent = goal.currentMilestone
    ? `${goal.currentMilestone.id} ${goal.currentMilestone.title}`
    : "Complete";
  $("#goal-progress-bar").style.width = `${Math.max(0, Math.min(100, goal.progressPercent || 0))}%`;
}

function renderAttention(snapshot) {
  const attentionTasks = snapshot.tasks.filter((task) =>
    task.status === "blocked" || task.status === "awaiting_escalation"
  );
  const workspaceInvalid = snapshot.worker.status === "workspace_invalid";
  const banner = $("#attention-banner");
  const needsAttention = workspaceInvalid || attentionTasks.length > 0;
  banner.hidden = !needsAttention;
  document.title = needsAttention
    ? `(${Math.max(1, attentionTasks.length)}) EdgeOps attention`
    : "EdgeOps Control Plane";
  if (!needsAttention) return;

  const blocked = attentionTasks.filter((task) => task.status === "blocked").length;
  const awaiting = attentionTasks.length - blocked;
  $("#attention-summary").textContent = workspaceInvalid
    ? "Workspace validation failed before inference"
    : `${blocked} blocked, ${awaiting} awaiting escalation`;
  $("#attention-detail").textContent = workspaceInvalid
    ? snapshot.worker.lastError || "No model call was made."
    : attentionTasks.slice(0, 3).map((task) => `${task.id}: ${task.title}`).join("  |  ");
}

function renderRouting(snapshot) {
  state.ladder = snapshot.routing.ladder.map((item) => ({ ...item }));
  state.availableChannels = snapshot.routing.availableChannels.map((item) => ({ ...item }));
  const roles = snapshot.routing.roles || {};
  const roleNodes = [
    { tier: "LOCAL UTILITY", model: roles.utilityModel, detail: "on-demand compression" },
    { tier: "LOCAL IMPLEMENTER", model: roles.implementerModel, detail: "bounded edits" },
    { tier: "LOCAL REPAIR + REVIEW", model: roles.repairModel, detail: "validation recovery" }
  ].filter((item) => item.model);
  const escalationNodes = state.ladder.map((channel, index) => ({
    tier: channel.type === "codex"
      ? "OPENAI FALLBACK"
      : channel.type === "antigravity"
        ? `ANTIGRAVITY ${index + 1}`
        : channel.type === "hermes"
          ? "HERMES HARNESS"
          : channel.type === "openai-compatible"
            ? `FREE API ${index + 1}`
            : channel.type === "copilot-cli"
              ? "COPILOT CLI"
              : `LOCAL ESCALATION ${index + 1}`,
    model: channel.model || channel.id,
    detail: `${channel.id}  -  ${channel.configured === false ? "setup required" : channel.autoInvoke ? "automatic" : "manual"}`,
    type: channel.type
  }));
  $("#routing-flow").innerHTML = [...roleNodes, ...escalationNodes].map((node) => `
    <div class="route-node ${node.type === "codex" ? "frontier" : ["antigravity", "hermes", "openai-compatible", "copilot-cli"].includes(node.type) ? "harness" : "local"}">
      <span class="tier">${escapeHtml(node.tier)}</span>
      <strong>${escapeHtml(node.model)}</strong>
      <span>${escapeHtml(node.detail)}</span>
    </div>
  `).join("");
}

function renderServices(snapshot) {
  $("#service-list").innerHTML = snapshot.services.map((service) => `
    <div class="service ${service.ok ? "ok" : service.degraded ? "degraded" : ""}">
      <i></i>
      <strong>${escapeHtml(service.name)}</strong>
      <span>${escapeHtml(service.detail || (service.ok ? `${service.latencyMs} ms` : "offline"))}</span>
    </div>
  `).join("");
}

function renderConnections(snapshot) {
  if (document.activeElement?.matches("[data-connection-secret]")) return;
  $("#connection-grid").innerHTML = (snapshot.connections || []).map((connection) => `
    <form class="connection-card" data-connection-form="${escapeHtml(connection.id)}">
      <div class="connection-heading">
        <div>
          <strong>${escapeHtml(connection.label)}</strong>
          <span>${escapeHtml(connection.detail)}</span>
        </div>
        <span class="badge ${connection.configured ? "ready" : "blocked"}">${connection.configured ? "ready" : "setup"}</span>
      </div>
      <p class="muted">${
        connection.configured
          ? `Credential source: ${escapeHtml(connection.source || "configured")}${
              connection.remoteTargets?.length
                ? ` / Mac sync: ${connection.remoteTargets.map(escapeHtml).join(", ")}`
                : ""
            }`
          : "No credential available to the worker."
      }</p>
      <div class="secret-row">
        <input
          type="password"
          autocomplete="new-password"
          data-connection-secret
          aria-label="${escapeHtml(connection.label)} credential"
          placeholder="${connection.configured ? "Replace credential" : "Enter credential"}"
        />
        <button class="control primary compact" type="submit">Save</button>
        ${connection.source === "local-store" ? `<button class="control secondary compact" type="button" data-remove-connection="${escapeHtml(connection.id)}">Remove</button>` : ""}
      </div>
      <a class="quota-source" href="${escapeHtml(connectionDocs[connection.id] || "#")}" target="_blank" rel="noreferrer">Provider setup</a>
    </form>
  `).join("");
  $$("[data-connection-form]").forEach((form) => form.addEventListener("submit", saveConnection));
  $$("[data-remove-connection]").forEach((button) => button.addEventListener("click", removeConnection));
}

function renderVoice(snapshot) {
  $("#voice-grid").innerHTML = (snapshot.voice || []).map((service) => `
    <div class="voice-card">
      <div class="connection-heading">
        <div>
          <span class="service-kind">${escapeHtml(service.kind)}</span>
          <strong>${escapeHtml(service.label)}</strong>
        </div>
        <span class="badge ${["online", "ready", "available"].includes(service.status) ? "ready" : service.status === "setup" ? "blocked" : "harness"}">${escapeHtml(service.status)}</span>
      </div>
      <dl>
        <div><dt>Runtime</dt><dd>${escapeHtml(service.model)}</dd></div>
        <div><dt>Allowance</dt><dd>${escapeHtml(service.allowance)}</dd></div>
      </dl>
      ${service.detail ? `<p class="muted">${escapeHtml(service.detail)}</p>` : ""}
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
  $("#pipeline-summary").textContent = `${snapshot.tasks.length} tasks  -  ${counts.completed} completed`;
  $("#pipeline").innerHTML = groups.map(([key, label]) => {
    const current = snapshot.tasks.find((task) => task.status === key);
    return `<div class="pipeline-stage">
      <span class="stage-label">${label.toUpperCase()}</span>
      <strong class="count">${counts[key]}</strong>
      <span class="task-name">${current ? `${escapeHtml(current.id)}  -  ${escapeHtml(current.title)}` : "No task in this stage"}</span>
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
        ${task.activity ? `<span class="task-objective">${escapeHtml(task.activity.phase)}: ${escapeHtml(task.activity.detail)}</span>` : ""}
      </td>
      <td><span class="badge ${escapeHtml(task.status)}">${escapeHtml(task.status.replaceAll("_", " "))}</span></td>
      <td>${task.dependsOn.length ? task.dependsOn.map(escapeHtml).join(", ") : "-"}</td>
      <td>${task.attempts} <span class="muted">(${task.repairCycles} repair)</span>${task.lastFailureFingerprintCount ? `<span class="task-objective">same failure x${task.lastFailureFingerprintCount}</span>` : ""}</td>
      <td>${formatNumber(task.tokens.totalTokens)}${task.tokens.estimatedCalls ? " *" : ""}</td>
      <td>
        ${escapeHtml(task.escalationChannel || "-")}
        ${task.escalationAutoInvoke ? `<span class="task-objective">automatic guidance</span>` : task.escalationChannel ? `<span class="task-objective">manual: send task packet</span>` : ""}
        ${task.escalationJob ? `<span class="task-objective">${escapeHtml(task.escalationJob.status)}: ${escapeHtml(task.escalationJob.detail)}</span>` : ""}
      </td>
      <td>${renderTaskAction(task)}</td>
    </tr>
  `).join("");
  $$("[data-approve-escalation]").forEach((button) => button.addEventListener("click", approveEscalation));
  $$("[data-retry-local]").forEach((button) => button.addEventListener("click", retryLocal));
  $$("[data-task-trace]").forEach((button) => button.addEventListener("click", showTaskTrace));
}

function renderTaskAction(task) {
  const trace = `<button class="control secondary compact" data-task-trace="${escapeHtml(task.id)}" title="Review model attempts and conclusions">Trace</button>`;
  if (task.activity && task.activity.phase === "context-recovery") return `${trace}<span class="muted">Testing local recovery</span>`;
  if (task.activity && task.activity.phase) return `${trace}<span class="muted">${escapeHtml(task.activity.phase.replaceAll("-", " "))}</span>`;
  const jobMatchesCurrentRoute = task.escalationJob?.channelId === task.escalationChannel;
  if (jobMatchesCurrentRoute && task.escalationJob?.status === "running") return `${trace}<span class="muted">Running</span>`;
  if (jobMatchesCurrentRoute && task.escalationJob?.status === "completed" && task.status === "running") {
    return `${trace}<span class="muted">Applying guidance</span>`;
  }
  if (jobMatchesCurrentRoute && task.escalationJob?.status === "completed" && task.status === "pending") {
    return `${trace}<span class="muted">Queued with guidance</span>`;
  }
  if (task.hasEscalationGuidance && ["awaiting_escalation", "blocked"].includes(task.status)) {
    return `${trace}<button class="control compact" data-retry-local="${escapeHtml(task.id)}" title="Retry the local worker with saved recovery guidance">Retry local with guidance</button>`;
  }
  if (jobMatchesCurrentRoute && task.escalationJob?.status === "completed") return trace;
  if (task.status !== "awaiting_escalation" || task.escalationAutoInvoke || !task.escalationChannel) return trace;
  const channel = state.availableChannels.find((item) => item.id === task.escalationChannel);
  const route = channel?.id || task.escalationChannel;
  return `${trace}<button class="control compact frontier-approve" data-approve-escalation="${escapeHtml(task.id)}" data-channel="${escapeHtml(task.escalationChannel)}" title="Send the task packet to ${escapeHtml(route)} for an unblock attempt">Escalate to ${escapeHtml(route)}</button>`;
}

function traceEventTitle(event) {
  return {
    requested: "Escalation requested",
    answered: "Model returned guidance",
    "auto-answer": "Guidance accepted",
    "post-answer-failed": "Local retry still failed",
    "auto-invoke-failed": "Provider or harness failed",
    "context-recovery": "Local context recovery",
    "context-recovery-failed": "Local context recovery failed",
    "advanced-after-failure": "Advanced to next route",
    "ladder-exhausted": "Escalation ladder exhausted"
  }[event.event] || String(event.event || "Attempt");
}

function traceEventDetail(event) {
  const skipped = event.skippedChannelIds?.length
    ? `<p><strong>Skipped:</strong> ${event.skippedChannelIds.map(escapeHtml).join(", ")} because the provider reported a shared quota or capacity failure.</p>`
    : "";
  const error = event.error
    ? `<pre>${escapeHtml(String(event.error).slice(0, 1800))}</pre>`
    : "";
  const answer = event.answerExcerpt
    ? `<details><summary>Read model conclusion</summary><pre>${escapeHtml(event.answerExcerpt)}</pre></details>`
    : "";
  const route = event.nextChannelId
    ? `<p><strong>Next:</strong> ${escapeHtml(event.nextChannelId)}</p>`
    : "";
  return `${route}${skipped}${error}${answer}`;
}

function showTaskTrace(event) {
  const task = state.snapshot?.tasks.find((item) => item.id === event.currentTarget.dataset.taskTrace);
  if (!task) return;
  $("#task-trace-title").textContent = `${task.id} ${task.title}`;
  const history = [...(task.escalationHistory || [])];
  if (task.escalationJob?.status === "completed" && task.escalationJob.answerExcerpt) {
    history.push({
      at: task.escalationJob.finishedAt,
      event: "answered",
      channelId: task.escalationJob.channelId,
      answerExcerpt: task.escalationJob.answerExcerpt
    });
  }
  $("#task-trace-content").innerHTML = `
    <section class="trace-summary">
      <div><span>Local attempts</span><strong>${task.attempts}</strong></div>
      <div><span>Repair cycles</span><strong>${task.repairCycles}</strong></div>
      <div><span>Tokens observed</span><strong>${formatNumber(task.tokens.totalTokens)}</strong></div>
      <div><span>Current route</span><strong>${escapeHtml(task.escalationChannel || "none")}</strong></div>
      <div><span>Difficulty</span><strong>${escapeHtml(task.difficulty || "unscored")}</strong></div>
      <div><span>Failure class</span><strong>${escapeHtml(task.lastFailureClass || "none")}</strong></div>
      <div><span>Trajectory</span><strong>${task.trajectoryAttempts || 0} attempt(s)</strong></div>
    </section>
    ${task.routingReason ? `<section class="trace-current"><p class="eyebrow">ROUTING BASIS</p><p>${escapeHtml(task.routingReason)}</p></section>` : ""}
    ${task.activity ? `<section class="trace-current"><p class="eyebrow">CURRENT ACTIVITY</p><p><strong>${escapeHtml(task.activity.phase.replaceAll("-", " "))}</strong><br>${escapeHtml(task.activity.detail)}<br><span class="muted">${escapeHtml(task.activity.at ? new Date(task.activity.at).toLocaleString() : "")}</span></p></section>` : ""}
    ${task.lastError ? `<section class="trace-current"><p class="eyebrow">CURRENT BLOCKER</p><pre>${escapeHtml(task.lastError)}</pre></section>` : ""}
    ${task.operatorPlanSource || task.operatorPlanSkippedReason ? `<section class="trace-current"><p class="eyebrow">OPERATOR PLAN</p><p><strong>${escapeHtml(task.operatorPlanSource || "none")}</strong>${task.operatorPlanScope?.length ? ` / ${task.operatorPlanScope.map(escapeHtml).join(", ")}` : ""}</p>${task.operatorPlanSkippedReason ? `<p class="muted">${escapeHtml(task.operatorPlanSkippedReason)}</p>` : ""}</section>` : ""}
    <section class="trace-events">
      ${history.length ? history.map((item) => `
        <article class="trace-event">
          <time>${escapeHtml(item.at ? new Date(item.at).toLocaleString() : "")}</time>
          <div>
            <h3>${escapeHtml(traceEventTitle(item))}</h3>
            <p class="muted">${escapeHtml(item.channelId || item.failedChannelId || item.afterChannelId || "local worker")}</p>
            ${traceEventDetail(item)}
          </div>
        </article>
      `).join("") : `<p class="muted">No escalation events have been recorded for this task.</p>`}
    </section>
  `;
  $("#task-trace-dialog").showModal();
}
function renderUsageList(selector, entries) {
  const max = Math.max(...entries.map(([, usage]) => usage.totalTokens || 0), 1);
  $(selector).innerHTML = entries.length ? entries
    .sort((a, b) => (b[1].totalTokens || 0) - (a[1].totalTokens || 0))
    .map(([name, usage]) => `
      <div class="usage-row">
        <div class="usage-meta">
          <strong>${escapeHtml(name)}</strong>
          <span>${formatNumber(usage.totalTokens)} tokens  -  ${usage.calls} calls  -  ${usage.estimatedCalls || 0} estimated</span>
        </div>
        <div class="bar"><i style="width:${Math.max(2, Math.round((usage.totalTokens / max) * 100))}%"></i></div>
      </div>
    `).join("") : `<p class="muted">No inference data yet.</p>`;
}

function renderProviderBudget(snapshot) {
  const providers = snapshot.policy?.providerBudgets || [];
  $("#provider-budget").innerHTML = providers.length ? providers.map((provider) => {
    const cap = provider.requestsPerDay || provider.dailyCallSoftCap || 0;
    const pressure = cap ? Math.min(100, Math.round(((provider.calls || 0) / cap) * 100)) : 0;
    const minuteCap = provider.requestsPerMinute || 0;
    const minutePressure = minuteCap
      ? Math.min(100, Math.round(((provider.minuteCalls || 0) / minuteCap) * 100))
      : 0;
    const entitlements = [
      provider.subscriptionUsdMonthly ? `${formatUsd(provider.subscriptionUsdMonthly)}/month` : null,
      provider.monthlyAiCredits ? `${formatNumber(provider.monthlyAiCredits)} AI credits/month` : null,
      provider.monthlyCodeCompletions ? `${formatNumber(provider.monthlyCodeCompletions)} code completions/month` : null,
      provider.quotaRefreshHours ? `${formatNumber(provider.quotaRefreshHours)}h quota refresh` : null,
      provider.geminiAppLimitMultiplier ? `${formatNumber(provider.geminiAppLimitMultiplier)}x Gemini app limits` : null,
      provider.contextWindowTokens ? `${formatNumber(provider.contextWindowTokens)} token context` : null,
      provider.requestsPerMinute ? `${formatNumber(provider.requestsPerMinute)} RPM` : null,
      provider.requestsPerDay ? `${formatNumber(provider.requestsPerDay)} requests/day` : null,
      provider.tokensPerMinute ? `${formatNumber(provider.tokensPerMinute)} TPM` : null,
      provider.tokensPerDay ? `${formatNumber(provider.tokensPerDay)} tokens/day` : null,
      provider.concurrentRequests ? `${formatNumber(provider.concurrentRequests)} concurrent` : null,
      provider.upgradedRequestsPerDay
        ? `${formatNumber(provider.upgradedRequestsPerDay)}/day after ${provider.upgradeCondition || "upgrade"}`
        : null,
      provider.apiIncluded === false ? "API billed separately" : null,
      provider.modelAccessLabel || null,
      provider.usageLimitLabel || null
    ].filter(Boolean);
    const quotaTiers = (provider.quotaTiers || []).map((tier) => {
      const values = [
        tier.requestsPerMinute ? `${formatNumber(tier.requestsPerMinute)} RPM` : null,
        tier.requestsPerDay ? `${formatNumber(tier.requestsPerDay)}/day` : null,
        tier.maxInputTokens ? `${formatNumber(tier.maxInputTokens)} in` : null,
        tier.maxOutputTokens ? `${formatNumber(tier.maxOutputTokens)} out` : null,
        tier.concurrentRequests ? `${formatNumber(tier.concurrentRequests)} concurrent` : null
      ].filter(Boolean).join("  -  ");
      return `<span><strong>${escapeHtml(tier.label || "Tier")}</strong>${escapeHtml(values)}</span>`;
    }).join("");
    const topTasks = Object.entries(provider.tasks || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([task, tokens]) => `${task}: ${formatNumber(tokens)}`)
      .join("  -  ");
    const topModels = Object.entries(provider.models || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([model, tokens]) => `${model}: ${formatNumber(tokens)}`)
      .join("  -  ");
    return `
      <div class="budget-card ${escapeHtml(provider.class || "observed")}">
        <div class="budget-topline">
          <div>
            <strong>${escapeHtml(provider.label || provider.provider)}</strong>
            <span>${escapeHtml(provider.provider)}  -  ${
              provider.credentialConfigured === false
                ? "key needed"
                : provider.autoUse
                  ? "automatic"
                  : "manual approval"
            }</span>
          </div>
          <span class="badge ${provider.credentialConfigured === true ? "ready" : provider.credentialConfigured === false ? "blocked" : ""}">${
            provider.credentialConfigured === true
              ? "ready"
              : provider.credentialConfigured === false
                ? "setup"
                : escapeHtml(provider.class || "observed")
          }</span>
        </div>
        <div class="budget-metric">
          <span>${formatNumber(provider.calls)} calls / 24h</span>
          <span>${formatNumber(provider.totalTokens)} tokens / 24h</span>
          <span>${provider.estimatedCalls || 0} estimated</span>
        </div>
        ${entitlements.length ? `<div class="entitlement-grid">${entitlements.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
        ${quotaTiers ? `<div class="quota-tiers">${quotaTiers}</div>` : ""}
        ${minuteCap ? `<div class="budget-pressure minute"><i style="width:${Math.max(2, minutePressure)}%"></i></div><p class="muted">${formatNumber(provider.minuteCalls || 0)} of ${formatNumber(minuteCap)} requests this minute</p>` : ""}
        ${cap ? `<div class="budget-pressure"><i style="width:${Math.max(2, pressure)}%"></i></div><p class="muted">${formatNumber(provider.calls || 0)} of ${formatNumber(cap)} requests in 24h (${pressure}%)</p>` : ""}
        <p class="muted">All time: ${formatNumber(provider.allTimeCalls)} calls  -  ${formatNumber(provider.allTimeTokens)} tokens</p>
        ${topModels ? `<p class="budget-detail">${escapeHtml(topModels)}</p>` : ""}
        ${topTasks ? `<p class="budget-detail">${escapeHtml(topTasks)}</p>` : ""}
        ${provider.notes ? `<p class="muted">${escapeHtml(provider.notes)}</p>` : ""}
        ${provider.quotaSourceUrl ? `<a class="quota-source" href="${escapeHtml(provider.quotaSourceUrl)}" target="_blank" rel="noreferrer">Official quota source</a>` : ""}
      </div>
    `;
  }).join("") : `<p class="muted">Provider budget telemetry will appear after the next model call.</p>`;
}

function renderModelBudget(snapshot) {
  const models = snapshot.policy?.modelBudgets || [];
  $("#model-budget").innerHTML = models.length ? models.map((entry) => {
    const recent = entry.window || {};
    const totals = entry.totals || {};
    const tokenCap = entry.dailyTokenSoftCap || 0;
    const tokenPressure = tokenCap ? Math.min(100, Math.round(((recent.totalTokens || 0) / tokenCap) * 100)) : 0;
    const price = entry.unlimited
      ? "Local / $0"
      : entry.inputUsdPerMillion !== null && entry.outputUsdPerMillion !== null
        ? `${formatUsd(entry.inputUsdPerMillion)}/M in  -  ${formatUsd(entry.outputUsdPerMillion)}/M out`
        : "Not exposed";
    const budget = entry.unlimited
      ? "Unlimited"
      : tokenCap
        ? `${tokenPressure}% of ${formatNumber(tokenCap)} tokens`
        : entry.dailyCostSoftCapUsd
          ? `${formatUsd(recent.estimatedCostUsd || 0)} of ${formatUsd(entry.dailyCostSoftCapUsd)}`
          : "No model cap";
    return `<tr>
      <td>
        <strong class="model-name">${escapeHtml(entry.model)}</strong>
        <span class="task-objective">${escapeHtml(entry.provider)}  -  ${escapeHtml(entry.class)}</span>
      </td>
      <td>
        <strong>${formatNumber(recent.totalTokens)} tokens</strong>
        <span class="task-objective">${formatNumber(recent.promptTokens)} in  -  ${formatNumber(recent.completionTokens)} out  -  ${formatNumber(recent.calls)} calls</span>
      </td>
      <td>
        <strong>${formatNumber(totals.totalTokens)} tokens</strong>
        <span class="task-objective">${formatNumber(totals.calls)} calls  -  ${formatNumber(totals.estimatedCalls)} estimated</span>
      </td>
      <td>${totals.completionTokensPerSecond ? `${totals.completionTokensPerSecond.toFixed(1)} tok/s` : `<span class="muted">not reported</span>`}</td>
      <td>
        ${escapeHtml(price)}
        ${totals.estimatedCostUsd !== null ? `<span class="task-objective">Est. all time ${formatUsd(totals.estimatedCostUsd)}</span>` : ""}
      </td>
      <td>
        ${escapeHtml(budget)}
        ${tokenCap ? `<div class="budget-pressure compact"><i style="width:${Math.max(2, tokenPressure)}%"></i></div>` : ""}
        ${entry.notes ? `<span class="task-objective">${escapeHtml(entry.notes)}</span>` : ""}
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="muted">No model telemetry yet.</td></tr>`;
}

function renderTelemetry(snapshot) {
  const modelUsage = { ...(snapshot.telemetry.summary?.models || {}) };
  for (const model of snapshot.policy?.modelBudgets || []) {
    modelUsage[model.model] ||= { calls: 0, totalTokens: 0, estimatedCalls: 0 };
  }
  renderUsageList("#model-usage", Object.entries(modelUsage));
  renderUsageList("#agent-usage", Object.entries(snapshot.telemetry.summary?.agents || {}));
  renderProviderBudget(snapshot);
  renderModelBudget(snapshot);
  renderLadderEditor();
  const budget = snapshot.policy?.frontierBudget;
  const budgetText = budget
    ? `Frontier budget: ${budget.maxCallsPerTask} call/task, ${budget.maxCallsPerDay} calls/day, ${formatNumber(budget.maxPromptChars)} chars/request.`
    : "Frontier budget disabled.";
  $("#ladder-editor").insertAdjacentHTML("afterbegin", `<p class="muted policy-note">${escapeHtml(budgetText)}</p>`);
}

function renderLadderEditor() {
  const included = state.ladder.map((channel, index) => `
    <div class="ladder-row">
      <span class="ladder-index">${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(channel.id)}</strong><small>${escapeHtml(channel.model || channel.type)}${channel.configured === false ? "  -  setup required" : ""}</small></div>
      <span class="badge ${channel.type === "codex" ? "awaiting_escalation" : ["antigravity", "hermes"].includes(channel.type) ? "harness" : "running"}">${escapeHtml(channel.type)}</span>
      <div class="ladder-actions">
        <button data-move="${index}" data-direction="-1" aria-label="Move ${escapeHtml(channel.id)} up">Up</button>
        <button data-move="${index}" data-direction="1" aria-label="Move ${escapeHtml(channel.id)} down">Down</button>
        <button data-remove="${escapeHtml(channel.id)}" aria-label="Remove ${escapeHtml(channel.id)} from ladder">X</button>
      </div>
    </div>
  `).join("");
  const activeIds = new Set(state.ladder.map((channel) => channel.id));
  const available = state.availableChannels.filter((channel) => !activeIds.has(channel.id));
  const experiments = available.length ? `
    <p class="eyebrow" style="margin-top:18px">AVAILABLE EXPERIMENTS</p>
    ${available.map((channel) => `
      <div class="ladder-row">
        <span class="ladder-index">+</span>
        <div><strong>${escapeHtml(channel.id)}</strong><small>${escapeHtml(channel.model || channel.type)}  -  ${channel.configured === false ? "setup required" : channel.autoInvoke ? "automatic" : "manual"}</small></div>
        <span class="badge ${["antigravity", "hermes"].includes(channel.type) ? "harness" : ""}">${escapeHtml(channel.type)}</span>
        <div class="ladder-actions">${
          channel.enabled && channel.configured !== false
            ? `<button data-add="${escapeHtml(channel.id)}" aria-label="Add ${escapeHtml(channel.id)} to ladder">+</button>`
            : `<span class="muted">${channel.enabled ? "setup" : "disabled"}</span>`
        }</div>
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
  renderGoal(snapshot);
  renderAttention(snapshot);
  renderRouting(snapshot);
  renderServices(snapshot);
  renderConnections(snapshot);
  renderVoice(snapshot);
  renderPipeline(snapshot);
  renderTimeline(snapshot);
  renderTasks(snapshot);
  renderTelemetry(snapshot);
}

$("#review-blockers").addEventListener("click", () => {
  const tasksTab = $('.tab[data-view="tasks"]');
  tasksTab?.click();
});

async function saveConnection(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const secret = form.querySelector("[data-connection-secret]").value;
  if (!secret) return toast("Enter a credential first.", true);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const result = await api("/api/connections", {
      method: "POST",
      body: JSON.stringify({ id: form.dataset.connectionForm, secret })
    });
    form.reset();
    toast(result.refreshWarnings?.length
      ? `${form.dataset.connectionForm} saved; runtime reload needs attention.`
      : `${form.dataset.connectionForm} connection saved.`);
    await refresh();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function removeConnection(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api("/api/connections", {
      method: "DELETE",
      body: JSON.stringify({ id: button.dataset.removeConnection })
    });
    toast(`${button.dataset.removeConnection} local credential removed.`);
    await refresh();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
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

const externalTools = {
  paperclip: "https://desktop-6he0t2k.taile5e8da.ts.net:8443/",
  silverbullet: "https://macbook-pro-4.taile5e8da.ts.net/",
  galaxy: "https://macbook-pro-4.taile5e8da.ts.net/Visuals/second-brain-galaxy.html"
};

function loadExternalTool(view) {
  if (view === "paperclip") {
    $("#paperclip-link").href = externalTools.paperclip;
    if (!$("#paperclip-frame").src) $("#paperclip-frame").src = externalTools.paperclip;
  }
  if (view === "silverbullet") {
    $("#silverbullet-link").href = externalTools.silverbullet;
    $("#galaxy-link").href = externalTools.galaxy;
    if (!$("#silverbullet-frame").src) $("#silverbullet-frame").src = externalTools.galaxy;
  }
}

$$(".tab").forEach((tab) => tab.addEventListener("click", () => {
  $$(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${tab.dataset.view}`));
  if (tab.dataset.view === "operator") loadOperatorContext();
  loadExternalTool(tab.dataset.view);
}));

$$(".editor-tab").forEach((tab) => tab.addEventListener("click", () => {
  $$(".editor-tab").forEach((item) => item.classList.toggle("active", item === tab));
  $$(".context-editor").forEach((editor) => editor.classList.toggle("active", editor.id === tab.dataset.editor));
}));

$$("[data-action]").forEach((button) => button.addEventListener("click", async () => {
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
  button.disabled = true;
  try {
    const result = await api("/api/control", { method: "POST", body: JSON.stringify({ action: button.dataset.action }) });
    let detail = "";
    let outcome = "completed";
    try {
      const lines = String(result.output || "").trim().split(/\r?\n/).filter(Boolean);
      const payload = JSON.parse(lines.at(-1) || "{}");
      if (payload.status === "waiting") {
        outcome = "blocked";
        detail = ` ${payload.message || "The canonical creative manager is still protecting an active resource."}`;
      } else if (payload.status === "running" || payload.status === "already-running") {
        detail = ` ${payload.message || "ComfyUI is online at http://127.0.0.1:8188."}`;
      } else if (payload.status) {
        detail = ` ${payload.status}.`;
      }
    } catch {
      detail = " Check the ComfyUI status card for the latest state.";
    }
    toast(`${button.dataset.action === "yield-gpu-start-comfyui" ? "GPU handoff" : "ComfyUI launch"} ${outcome}.${detail}`, outcome === "blocked");
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

async function approveEscalation(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api("/api/escalation/approve", {
      method: "POST",
      body: JSON.stringify({
        taskId: button.dataset.approveEscalation,
        channelId: button.dataset.channel
      })
    });
    toast(`Sent ${button.dataset.approveEscalation} to ${result.output?.channelId || button.dataset.channel} with its recovery context.`);
    await refresh();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function retryLocal(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api("/api/escalation/retry-local", {
      method: "POST",
      body: JSON.stringify({ taskId: button.dataset.retryLocal })
    });
    toast(`Queued ${button.dataset.retryLocal} for a local retry with its recovered context.`);
    await refresh();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

$("#close-task-trace").addEventListener("click", () => $("#task-trace-dialog").close());

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

async function scheduleRefresh() {
  await refresh();
  setTimeout(scheduleRefresh, 5000);
}

scheduleRefresh();

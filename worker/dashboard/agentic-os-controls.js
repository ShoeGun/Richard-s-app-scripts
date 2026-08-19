const STATUS_ENDPOINT = "/api/agentic-os/status";
const PREEMPTION_ENDPOINT = "/api/agentic-os/preemption-grants";
const RECONCILE_ENDPOINT = "/api/agentic-os/reconcile";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function receiptPayload(value) {
  const outer = asObject(value);
  return { ...outer, ...asObject(outer.receipt) };
}

function desiredMode(value) {
  const payload = receiptPayload(value);
  return payload.desiredMode || payload.currentMode || payload.mode || asObject(payload.state).desiredMode || "unknown";
}

function componentReceipts(value) {
  const payload = receiptPayload(value);
  const candidate = payload.components || payload.componentReceipts || payload.results || payload.steps || [];
  const entries = Array.isArray(candidate)
    ? candidate.map((item, index) => [String(index), item])
    : Object.entries(asObject(candidate));
  return entries.slice(0, 64).map(([key, raw]) => {
    const item = typeof raw === "string" ? { status: raw } : asObject(raw);
    return {
      label: item.label || item.name || item.component || item.componentId || item.id || key,
      status: item.outcome || item.status || (typeof item.state === "string" ? item.state : null)
        || (item.ok === true ? "ready" : item.ok === false ? "degraded" : "reported"),
      detail: item.detail
        || item.message
        || (typeof item.error === "string" ? item.error : asObject(item.error).message)
        || (typeof item.observation === "string" ? item.observation : asObject(item.observation).detail)
        || (Array.isArray(item.actions) && item.actions.length ? `${item.actions.length} action${item.actions.length === 1 ? "" : "s"}` : "")
    };
  });
}

function blockers(value) {
  const payload = receiptPayload(value);
  const candidate = payload.blockers || asObject(payload.degraded).blockers || [];
  const explicit = (Array.isArray(candidate) ? candidate : Object.values(asObject(candidate))).map((raw) => {
    if (typeof raw === "string") return { label: "Blocker", detail: raw };
    const item = asObject(raw);
    return {
      label: item.label || item.component || item.name || item.id || "Blocker",
      detail: item.detail
        || item.message
        || (typeof item.error === "string" ? item.error : asObject(item.error).message)
        || item.reason
        || "Needs operator attention"
    };
  });
  if (explicit.length) return explicit;
  return componentReceipts(payload)
    .filter((item) => ["degraded", "unknown", "blocked", "failed", "error"].includes(String(item.status).toLowerCase()))
    .slice(0, 32)
    .map((item) => ({ label: item.label, detail: item.detail || `Component outcome: ${item.status}` }));
}

async function jsonRequest(fetchImpl, url, options, browserSession = "") {
  const mutation = String(options?.method || "GET").toUpperCase() === "POST";
  if (mutation && !/^[A-Za-z0-9_-]{43}$/u.test(browserSession)) {
    throw new Error("This dashboard is read-only. Open it with the trusted Agentic OS launcher to enable system controls.");
  }
  const response = await fetchImpl(url, {
    ...options,
    headers: options?.body ? {
      "content-type": "application/json",
      ...(mutation ? { "x-edgeops-browser-session": browserSession } : {})
    } : {}
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed: ${response.status}`);
  return body;
}

function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildPanel(documentRef) {
  const panel = element(documentRef, "section", "agentic-os-panel");
  panel.dataset.agenticOsControls = "";
  panel.dataset.agenticPanel = "";
  panel.dataset.state = "connecting";
  panel.setAttribute("aria-labelledby", "agentic-os-heading");

  const identity = element(documentRef, "div", "agentic-os-identity");
  identity.append(element(documentRef, "p", "eyebrow", "SYSTEM RECOVERY + GPU OWNERSHIP"));
  const heading = element(documentRef, "h2", "", "Agentic OS master control");
  heading.id = "agentic-os-heading";
  identity.append(heading);
  const summary = element(documentRef, "p", "agentic-os-summary", "Connecting to the canonical controller…");
  summary.dataset.agenticSummary = "";
  summary.setAttribute("role", "status");
  summary.setAttribute("aria-live", "polite");
  identity.append(summary);

  const actions = element(documentRef, "div", "agentic-os-actions");
  const online = element(documentRef, "button", "control primary agentic-os-online", "Bring Agentic OS Online");
  online.type = "button";
  online.dataset.agenticOnline = "";
  online.title = "Reconcile every registered Agentic OS component into autonomous mode";
  const gpu = element(documentRef, "button", "control agentic-os-gpu", "Pause local AI for GPU");
  gpu.type = "button";
  gpu.dataset.agenticGpu = "";
  gpu.title = "Pause registered local AI workloads and release the GPU";
  actions.append(online, gpu);

  const details = element(documentRef, "div", "agentic-os-details");
  const componentList = element(documentRef, "ul", "agentic-os-components");
  componentList.dataset.agenticComponents = "";
  componentList.setAttribute("aria-label", "Agentic OS component receipts");
  const blockerList = element(documentRef, "ul", "agentic-os-blockers");
  blockerList.dataset.agenticBlockers = "";
  blockerList.setAttribute("aria-label", "Agentic OS degraded blockers");
  blockerList.hidden = true;
  details.append(componentList, blockerList);

  panel.append(identity, actions, details);
  return panel;
}

function ensureStylesheet(documentRef) {
  if (documentRef.querySelector("link[data-agentic-os-styles]")) return;
  const link = documentRef.createElement("link");
  link.rel = "stylesheet";
  link.href = "/agentic-os-controls.css";
  link.dataset.agenticOsStyles = "";
  documentRef.head?.append(link);
}

export function mountAgenticOsControls({
  document: documentRef = globalThis.document,
  fetchImpl = globalThis.fetch,
  pollMs = 10_000,
  confirmImpl = globalThis.confirm
} = {}) {
  if (!documentRef?.querySelector) throw new TypeError("A browser document is required.");
  const main = documentRef.querySelector("main");
  if (!main) throw new Error("Agentic OS controls require a main element.");
  ensureStylesheet(documentRef);
  const browserSession = documentRef.querySelector('meta[name="edgeops-browser-session"]')?.content || "";
  const controlsAuthorized = /^[A-Za-z0-9_-]{43}$/u.test(browserSession);
  const windowRef = documentRef.defaultView;
  if (windowRef?.location?.search && new URL(windowRef.location.href).searchParams.has("bootstrap")) {
    windowRef.history.replaceState(null, "", `${windowRef.location.pathname}${windowRef.location.hash}`);
  }
  const existing = documentRef.querySelector("[data-agentic-os-controls]");
  const panel = existing || buildPanel(documentRef);
  if (!existing) main.prepend(panel);

  const summary = panel.querySelector("[data-agentic-summary]");
  const online = panel.querySelector("[data-agentic-online]");
  const gpu = panel.querySelector("[data-agentic-gpu]");
  const components = panel.querySelector("[data-agentic-components]");
  const blockerList = panel.querySelector("[data-agentic-blockers]");
  let mode = "unknown";
  let busy = false;
  let refreshing = false;
  let requestEpoch = 0;
  let destroyed = false;
  let timer = null;

  const setBusy = (next) => {
    busy = next;
    online.disabled = next || !controlsAuthorized;
    gpu.disabled = next || !controlsAuthorized;
    panel.setAttribute("aria-busy", String(next));
  };
  setBusy(false);

  const render = (value) => {
    const payload = receiptPayload(value);
    mode = desiredMode(payload);
    gpu.textContent = mode === "gpu-focus" ? "Resume Agentic AI" : "Pause local AI for GPU";
    gpu.setAttribute("aria-pressed", String(mode === "gpu-focus"));
    const receiptOutcome = String(payload.outcome || (payload.ok === false ? "degraded" : "healthy"));
    const receiptStatus = String(payload.status || payload.phase || "reported");
    const receiptBlockers = blockers(payload);
    const degraded = receiptBlockers.length > 0
      || ["degraded", "unknown"].includes(receiptOutcome.toLowerCase())
      || ["blocked", "failed", "error"].includes(receiptStatus.toLowerCase());
    panel.dataset.state = degraded ? "degraded" : mode === "gpu-focus" ? "gpu-focus" : "ready";
    summary.textContent = `Agentic OS: ${mode === "gpu-focus" ? "GPU focus" : mode === "autonomous" ? "autonomous" : "mode unknown"} · ${receiptOutcome} · ${receiptStatus}`;

    components.replaceChildren();
    const rows = componentReceipts(payload);
    if (!rows.length) components.append(element(documentRef, "li", "agentic-os-empty", "No component receipts reported yet."));
    for (const item of rows) {
      const row = element(documentRef, "li", "agentic-os-component");
      row.dataset.status = String(item.status).toLowerCase();
      row.append(element(documentRef, "strong", "", item.label));
      row.append(element(documentRef, "span", "agentic-os-component-status", item.status));
      if (item.detail) row.append(element(documentRef, "small", "", item.detail));
      components.append(row);
    }

    blockerList.replaceChildren();
    blockerList.hidden = receiptBlockers.length === 0;
    for (const blocker of receiptBlockers) {
      const row = element(documentRef, "li", "agentic-os-blocker");
      row.append(element(documentRef, "strong", "", blocker.label));
      row.append(element(documentRef, "span", "", blocker.detail));
      blockerList.append(row);
    }
  };

  const renderError = (error) => {
    panel.dataset.state = "degraded";
    summary.textContent = `Agentic OS degraded: ${error.message}`;
    blockerList.hidden = false;
    blockerList.replaceChildren();
    const row = element(documentRef, "li", "agentic-os-blocker");
    row.append(element(documentRef, "strong", "", "Controller request failed"));
    row.append(element(documentRef, "span", "", error.message));
    blockerList.append(row);
  };

  const refresh = async () => {
    if (busy || refreshing || destroyed) return;
    refreshing = true;
    const epoch = ++requestEpoch;
    try {
      const result = await jsonRequest(fetchImpl, STATUS_ENDPOINT);
      if (!destroyed && epoch === requestEpoch) render(result);
    } catch (error) {
      if (!destroyed && epoch === requestEpoch) renderError(error);
    } finally {
      refreshing = false;
    }
  };

  const reconcile = async (nextMode) => {
    if (busy) return;
    let grant;
    try {
      grant = await jsonRequest(fetchImpl, PREEMPTION_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ desiredMode: nextMode })
      }, browserSession);
      if (!/^[A-Za-z0-9_-]{43}$/u.test(grant.grantId || "")
          || !Number.isSafeInteger(grant.systemRevision) || grant.systemRevision < 0
          || typeof grant.confirmation !== "string" || !grant.confirmation.trim()) {
        throw new Error("The controller returned an invalid preemption grant.");
      }
      if (typeof confirmImpl !== "function" || !confirmImpl(grant.confirmation || "Continue with this exact registered system transition?")) return;
    } catch (error) {
      renderError(error);
      return;
    }
    setBusy(true);
    const epoch = ++requestEpoch;
    summary.textContent = nextMode === "gpu-focus"
      ? "Releasing registered local AI workloads for GPU focus…"
      : "Reconciling all registered Agentic OS components…";
    try {
      const request = {
        desiredMode: nextMode,
        expectedRevision: grant.systemRevision,
        preemptionGrantId: grant.grantId
      };
      const result = await jsonRequest(fetchImpl, RECONCILE_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(request)
      }, browserSession);
      if (!destroyed && epoch === requestEpoch) render({ desiredMode: nextMode, ...result });
    } catch (error) {
      if (!destroyed && epoch === requestEpoch) renderError(error);
    } finally {
      setBusy(false);
    }
  };

  const onlineListener = () => reconcile("autonomous");
  const gpuListener = () => reconcile(mode === "gpu-focus" ? "autonomous" : "gpu-focus");
  online.addEventListener("click", onlineListener);
  gpu.addEventListener("click", gpuListener);
  const ready = refresh();
  if (Number.isFinite(pollMs) && pollMs > 0) timer = setInterval(refresh, Math.max(5_000, pollMs));

  return {
    ready,
    refresh,
    destroy() {
      destroyed = true;
      requestEpoch += 1;
      if (timer) clearInterval(timer);
      online.removeEventListener("click", onlineListener);
      gpu.removeEventListener("click", gpuListener);
    }
  };
}

if (typeof document !== "undefined") {
  const start = () => {
    if (!document.querySelector("[data-agentic-os-controls]")) mountAgenticOsControls();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

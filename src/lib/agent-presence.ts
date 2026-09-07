const PRESENCE_STYLE_ID = 'shoegun-agent-presence-style';
const PRESENCE_OVERLAY_ID = 'shoegun-agent-presence';
const HIGHLIGHT_CLASS = 'shoegun-tour-highlight';
const CHAT_EVENT = 'shoegun-agent-chat';
const CHAT_STATUS_EVENT = 'shoegun-agent-chat-status';
const CHAT_RESPONSE_EVENT = 'shoegun-agent-chat-response';
const TOUR_CONTEXT_EVENT = 'shoegun-agent-tour-context';
const GUIDANCE_EVENT = 'shoegun-agent-guidance';
const SHEET_FOCUS_MESSAGE = 'shoegun-focus-sheet';

type TourStep = {
  selector: string;
  title: string;
  message: string;
};

export type AgentPresenceContext = {
  diagnostics?: string[];
  trace?: string[];
  environment?: string[];
};

type PresenceOptions = {
  context?: AgentPresenceContext;
};

const TOUR_STEPS: TourStep[] = [
  {
    selector: '.hero-section',
    title: 'Choose your next step',
    message: 'I am Dom, Richard\'s browser-based hype man. I can point you to the projects, help connect a public Google Sheet, or explain how to use the bundled example data. I will wait for your direction.'
  },
  {
    selector: '#projects',
    title: 'Start with the projects',
    message: 'The fun starts here: Sheets, mapping, and altitude-aware route planning are all real examples to poke at.'
  },
  {
    selector: '#analytics',
    title: 'Watch the data move',
    message: 'These charts are a small preview of the analytics work. Ask me to explain a chart or suggest a better way to visualize it.'
  },
  {
    selector: '#contact',
    title: 'Turn curiosity into a conversation',
    message: 'When the work looks useful, Richard can help turn the idea into a practical analytics, AI, or web project.'
  }
];

const PRESENCE_STYLE = `
@keyframes shoegun-agent-scan {
  from { transform: translateY(-12%); opacity: .08; }
  50% { opacity: .22; }
  to { transform: translateY(112%); opacity: .08; }
}
@keyframes shoegun-agent-pulse {
  from { transform: scale(.96); opacity: .32; }
  to { transform: scale(1.04); opacity: .72; }
}
@keyframes shoegun-agent-drift {
  from { transform: translateX(-8px) rotate(-1deg); }
  to { transform: translateX(8px) rotate(1deg); }
}
@keyframes shoegun-agent-nudge {
  0%, 100% { transform: translateX(0) scale(1); }
  25% { transform: translateX(-7px) scale(1.02); }
  75% { transform: translateX(7px) scale(1.02); }
}
#${PRESENCE_OVERLAY_ID} {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2001;
  width: min(370px, calc(100vw - 32px));
  color: #e9ffff;
  pointer-events: none;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}
#${PRESENCE_OVERLAY_ID} .shoegun-agent-signal {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 108px;
  height: 108px;
  border: 1px solid rgba(89, 226, 220, .54);
  border-radius: 50%;
  box-shadow: 0 0 0 8px rgba(89, 226, 220, .08), 0 0 34px rgba(89, 226, 220, .32);
  animation: shoegun-agent-pulse 2.2s ease-in-out infinite alternate;
}
#${PRESENCE_OVERLAY_ID} .shoegun-agent-pet {
  position: absolute;
  right: 24px;
  bottom: 18px;
  width: 44px;
  height: 54px;
  border: 2px solid #ffb3a7;
  border-radius: 48% 48% 42% 42%;
  background: #e4372f;
  box-shadow: 0 8px 20px rgba(0, 0, 0, .28), 0 0 18px rgba(255, 83, 72, .42);
  animation: shoegun-agent-pet-bob 2.8s ease-in-out infinite;
}
#${PRESENCE_OVERLAY_ID} .shoegun-agent-pet::before,
#${PRESENCE_OVERLAY_ID} .shoegun-agent-pet::after {
  content: '';
  position: absolute;
  top: -9px;
  width: 11px;
  height: 18px;
  border: 2px solid #ffb3a7;
  border-radius: 65% 35% 60% 40%;
  background: #e4372f;
}
#${PRESENCE_OVERLAY_ID} .shoegun-agent-pet::before { left: 4px; transform: rotate(-18deg); }
#${PRESENCE_OVERLAY_ID} .shoegun-agent-pet::after { right: 4px; transform: rotate(18deg); }
@keyframes shoegun-agent-pet-bob {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50% { transform: translateY(-5px) rotate(2deg); }
}
#${PRESENCE_OVERLAY_ID} .shoegun-agent-signal::before,
#${PRESENCE_OVERLAY_ID} .shoegun-agent-signal::after {
  content: '';
  position: absolute;
  inset: 19px;
  border: 1px solid rgba(89, 226, 220, .52);
  border-radius: 50% 42% 58% 46%;
  transform: rotate(28deg);
}
#${PRESENCE_OVERLAY_ID} .shoegun-agent-signal::after {
  inset: 34px 12px;
  transform: rotate(-32deg);
}
#${PRESENCE_OVERLAY_ID} .shoegun-agent-tour {
  position: relative;
  margin-right: 48px;
  border: 1px solid rgba(89, 226, 220, .55);
  border-radius: 10px;
  padding: 14px 15px;
  background: rgba(8, 30, 40, .94);
  box-shadow: 0 14px 40px rgba(2, 12, 18, .35), inset 0 0 20px rgba(89, 226, 220, .08);
  pointer-events: auto;
  backdrop-filter: blur(12px);
}
#${PRESENCE_OVERLAY_ID} .shoegun-agent-tour::before {
  content: 'DOM // LOCAL SIGNAL';
  display: block;
  margin-bottom: 8px;
  color: #59e2dc;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .15em;
}
#${PRESENCE_OVERLAY_ID} .shoegun-tour-title {
  margin: 0 0 5px;
  color: #ffffff;
  font-size: 1rem;
}
#${PRESENCE_OVERLAY_ID} .shoegun-tour-message {
  margin: 0;
  color: rgba(233, 255, 255, .78);
  font-size: .84rem;
  line-height: 1.5;
}
#${PRESENCE_OVERLAY_ID} .shoegun-chat-log {
  display: grid;
  gap: 6px;
  max-height: 130px;
  margin-top: 10px;
  overflow: auto;
  font-size: .78rem;
}
#${PRESENCE_OVERLAY_ID} .shoegun-chat-line {
  border-left: 2px solid rgba(89, 226, 220, .58);
  padding-left: 8px;
  color: rgba(233, 255, 255, .82);
  line-height: 1.4;
}
#${PRESENCE_OVERLAY_ID} .shoegun-chat-line.user {
  border-left-color: rgba(243, 181, 98, .8);
  color: #fff4de;
}
#${PRESENCE_OVERLAY_ID} .shoegun-chat-form {
  display: flex;
  gap: 6px;
  margin-top: 11px;
}
#${PRESENCE_OVERLAY_ID} .shoegun-chat-form input {
  min-width: 0;
  width: 100%;
  border: 1px solid rgba(89, 226, 220, .42);
  border-radius: 4px;
  padding: 7px 8px;
  color: #e9ffff;
  background: rgba(0, 0, 0, .24);
  font: inherit;
  font-size: .78rem;
}
#${PRESENCE_OVERLAY_ID} .shoegun-tour-controls {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
#${PRESENCE_OVERLAY_ID} button {
  border: 1px solid rgba(89, 226, 220, .6);
  border-radius: 4px;
  padding: 7px 10px;
  color: #e9ffff;
  background: rgba(89, 226, 220, .12);
  cursor: pointer;
  font: inherit;
  font-size: .76rem;
  font-weight: 750;
}
#${PRESENCE_OVERLAY_ID} button:hover,
#${PRESENCE_OVERLAY_ID} button:focus-visible {
  background: rgba(89, 226, 220, .24);
}
#${PRESENCE_OVERLAY_ID}.shoegun-nudge .shoegun-agent-tour {
  animation: shoegun-agent-nudge .5s ease-in-out 3;
}
body .${HIGHLIGHT_CLASS} {
  position: relative;
  z-index: 2;
  outline: 2px solid rgba(89, 226, 220, .82);
  outline-offset: 8px;
  box-shadow: 0 0 0 10px rgba(89, 226, 220, .08), 0 0 34px rgba(89, 226, 220, .2);
  transition: outline 180ms ease, box-shadow 180ms ease;
}
@media (max-width: 560px) {
  #${PRESENCE_OVERLAY_ID} { right: 16px; bottom: 16px; }
  #${PRESENCE_OVERLAY_ID} .shoegun-agent-tour { margin-right: 18px; }
  #${PRESENCE_OVERLAY_ID} .shoegun-agent-signal { right: -2px; bottom: 3px; width: 72px; height: 72px; }
  #${PRESENCE_OVERLAY_ID} .shoegun-agent-signal::before { inset: 13px; }
  #${PRESENCE_OVERLAY_ID} .shoegun-agent-signal::after { inset: 23px 8px; }
}
`;

function getTargetDocument() {
  try {
    return window.parent.document;
  } catch {
    return document;
  }
}

function removeHighlight(targetDocument: Document) {
  targetDocument.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((element) => element.classList.remove(HIGHLIGHT_CLASS));
}

function contextWelcome() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${greeting}. I am Dom. I can explain Richard's work, help connect a public sheet, or suggest a chart. Take the tour if you are not sure where to start. If you have a sheet, paste it into the Public or published Google Sheet field below and connect it.`;
}

export function setAgentPresence(options: PresenceOptions = {}) {
  void options;
  const targetDocument = getTargetDocument();
  const targetWindow = targetDocument.defaultView ?? window;
  targetDocument.getElementById(PRESENCE_OVERLAY_ID)?.remove();
  targetDocument.getElementById(PRESENCE_STYLE_ID)?.remove();

  const style = targetDocument.createElement('style');
  style.id = PRESENCE_STYLE_ID;
  style.textContent = PRESENCE_STYLE;
  targetDocument.head.appendChild(style);

  const overlay = targetDocument.createElement('div');
  overlay.id = PRESENCE_OVERLAY_ID;
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="shoegun-agent-signal" aria-hidden="true"></div>
    <div class="shoegun-agent-pet" aria-label="Noid-inspired local pet" title="Noid-inspired local pet"></div>
    <div class="shoegun-agent-tour">
      <h2 class="shoegun-tour-title">Dom is online</h2>
      <p class="shoegun-tour-message"></p>
      <div class="shoegun-chat-log" aria-live="polite"></div>
      <form class="shoegun-chat-form">
        <input aria-label="Chat with Dom" placeholder="Ask Dom about this page..." autocomplete="off" />
        <button type="submit">Send</button>
      </form>
      <div class="shoegun-tour-controls">
        <button type="button" data-tour-action="previous" aria-label="Previous tour stop" title="Previous tour stop">&#8592;</button>
        <button type="button" data-tour-action="next" aria-label="Start or advance the tour" title="Start or advance the tour">&#8594;</button>
      </div>
    </div>
  `;
  targetDocument.body.appendChild(overlay);

  const title = overlay.querySelector<HTMLElement>('.shoegun-tour-title');
  const message = overlay.querySelector<HTMLElement>('.shoegun-tour-message');
  const chatLog = overlay.querySelector<HTMLElement>('.shoegun-chat-log');
  const chatForm = overlay.querySelector<HTMLFormElement>('.shoegun-chat-form');
  const chatInput = overlay.querySelector<HTMLInputElement>('.shoegun-chat-form input');
  const nextButton = overlay.querySelector<HTMLButtonElement>('[data-tour-action="next"]');
  const previousButton = overlay.querySelector<HTMLButtonElement>('[data-tour-action="previous"]');
  let stepIndex = -1;
  let tourTimer: number | null = null;
  let busy = false;
  let disposed = false;

  const addChatLine = (role: 'user' | 'agent', text: string) => {
    if (!chatLog || !text.trim()) return;
    const line = targetDocument.createElement('div');
    line.className = `shoegun-chat-line ${role}`;
    line.textContent = `${role === 'user' ? 'You' : 'Dom'}: ${text.trim().slice(0, 900)}`;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const renderStep = (direction = 1) => {
    stepIndex = (stepIndex + direction + TOUR_STEPS.length) % TOUR_STEPS.length;
    const step = TOUR_STEPS[stepIndex];
    removeHighlight(targetDocument);
    const target = targetDocument.querySelector<HTMLElement>(step.selector);
    target?.classList.add(HIGHLIGHT_CLASS);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (title) title.textContent = step.title;
    if (message) message.textContent = step.message;
    window.dispatchEvent(new CustomEvent(TOUR_CONTEXT_EVENT, { detail: { title: step.title, message: step.message } }));
  };

  const stopTourTimer = () => {
    if (tourTimer !== null) targetWindow.clearInterval(tourTimer);
    tourTimer = null;
    removeHighlight(targetDocument);
  };

  const startTourTimer = () => {
    stopTourTimer();
    tourTimer = targetWindow.setInterval(renderStep, 5600);
  };

  const focusSheetFromChat = (text: string) => {
    const sheetUrl = text.match(/https:\/\/docs\.google\.com\/spreadsheets\/[^\s<]+/i)?.[0]?.replace(/[),.;]+$/, '');
    if (!sheetUrl) return;
    const agentFrame = targetDocument.querySelector<HTMLIFrameElement>('#browser-agent iframe');
    agentFrame?.contentWindow?.postMessage({ type: SHEET_FOCUS_MESSAGE, url: sheetUrl }, '*');
    window.dispatchEvent(new CustomEvent(GUIDANCE_EVENT, { detail: { message: 'I put that public Sheet URL in the field. Review it, then connect the sheet.' } }));
  };

  const handleOutsideInteraction = (event: Event) => {
    if (tourTimer === null || overlay.contains(event.target as Node)) return;
    stopTourTimer();
    if (message) message.textContent = 'Tour paused. Ask me about the page or choose a tour stop when you are ready.';
  };

  const handleChatStatus = (event: Event) => {
    const detail = (event as CustomEvent<{ busy?: boolean; message?: string }>).detail;
    busy = detail?.busy ?? false;
    if (detail?.message && message) message.textContent = detail.message;
  };
  const handleChatResponse = (event: Event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    if (detail?.message) addChatLine('agent', detail.message);
    busy = false;
    if (message) message.textContent = 'I can keep exploring with you. What should we look at next?';
  };
  window.addEventListener(CHAT_STATUS_EVENT, handleChatStatus);
  window.addEventListener(CHAT_RESPONSE_EVENT, handleChatResponse);
  const handleGuidance = (event: Event) => {
    const detail = (event as CustomEvent<{ message?: unknown }>).detail;
    if (typeof detail?.message === 'string' && message) message.textContent = detail.message;
  };
  window.addEventListener(GUIDANCE_EVENT, handleGuidance);

  chatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = chatInput?.value.trim() ?? '';
    if (!text) return;
    if (busy) {
      if (message) message.textContent = 'Dom is still finishing the previous answer. Give him a moment, then try again.';
      return;
    }
    stopTourTimer();
    focusSheetFromChat(text);
    addChatLine('user', text);
    if (chatInput) chatInput.value = '';
    busy = true;
    if (message) message.textContent = 'Dom is thinking locally...';
    window.dispatchEvent(new CustomEvent(CHAT_EVENT, { detail: { text } }));
  });

  nextButton?.addEventListener('click', () => {
    if (busy) return;
    renderStep();
    startTourTimer();
  });

  previousButton?.addEventListener('click', () => {
    if (busy) return;
    renderStep(-1);
    startTourTimer();
  });

  targetDocument.addEventListener('click', handleOutsideInteraction, true);

  const initialTimer = targetWindow.setTimeout(() => {
    if (!disposed) {
      if (message) message.textContent = contextWelcome();
    }
  }, 700);

  function teardown() {
    if (disposed) return;
    disposed = true;
    targetWindow.clearTimeout(initialTimer);
    stopTourTimer();
    removeHighlight(targetDocument);
    window.removeEventListener(CHAT_STATUS_EVENT, handleChatStatus);
    window.removeEventListener(CHAT_RESPONSE_EVENT, handleChatResponse);
    window.removeEventListener(GUIDANCE_EVENT, handleGuidance);
    targetDocument.removeEventListener('click', handleOutsideInteraction, true);
    overlay.remove();
    targetDocument.getElementById(PRESENCE_STYLE_ID)?.remove();
  }

  return teardown;
}

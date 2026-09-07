const PLAY_STYLE_ID = 'shoegun-play-mode-style';

const PLAY_STYLE = `
@keyframes shoegun-bob { from { transform: translateY(-2px) rotate(-1deg); } to { transform: translateY(4px) rotate(1deg); } }
@keyframes shoegun-wiggle { 0%, 100% { transform: rotate(-2deg) scale(1); } 50% { transform: rotate(2deg) scale(1.03); } }
body.shoegun-play-mode .navbar-brand { animation: shoegun-bob .62s ease-in-out infinite alternate; }
body.shoegun-play-mode .hero-section h1 { animation: shoegun-wiggle 1.8s ease-in-out infinite; }
body.shoegun-play-mode .project-card { animation: shoegun-wiggle 3.2s ease-in-out infinite; }
body.shoegun-play-mode .project-card:nth-child(2) { animation-delay: .25s; }
body.shoegun-play-mode .project-card:nth-child(3) { animation-delay: .5s; }
body.shoegun-play-mode footer::after { content: "\\1F463  \\1F463  \\1F463"; display: block; margin-top: 8px; color: #f3b562; font-size: 1.8rem; letter-spacing: .25em; }
`;

export function setPlayMode(enabled: boolean) {
  const document = window.parent.document;
  let style = document.getElementById(PLAY_STYLE_ID);
  if (enabled) {
    if (!style) {
      style = document.createElement('style');
      style.id = PLAY_STYLE_ID;
      style.textContent = PLAY_STYLE;
      document.head.appendChild(style);
    }
    document.body.classList.add('shoegun-play-mode');
  } else {
    document.body.classList.remove('shoegun-play-mode');
    style?.remove();
  }
}

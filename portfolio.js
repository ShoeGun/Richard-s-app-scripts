/* global document, window */
(() => {
  'use strict';
  document.querySelectorAll('[data-dom-project]').forEach((card) => {
    const link = card.querySelector('a.btn-primary');
    if (!link) return;
    const preview = document.createElement('div');
    preview.className = 'project-live-preview';
    const frame = document.createElement('iframe');
    frame.title = card.querySelector('.card-title').textContent.trim() + ' live site preview';
    frame.loading = 'lazy';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = link.href;
    const open = document.createElement('a');
    open.href = link.href;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.setAttribute('aria-label', 'Open ' + card.querySelector('.card-title').textContent.trim());
    const label = document.createElement('span');
    label.textContent = 'Live site / Open project';
    open.append(label);
    preview.append(frame, open);
    card.prepend(preview);
  });
  const projectHeading = document.querySelector('#projects h2');
  if (projectHeading) {
    const intro = document.createElement('p');
    intro.className = 'preview-help';
    intro.textContent = 'A live look at each project. Select a preview to explore the full app. Some Google apps may need to open in their own tab.';
    projectHeading.after(intro);
  }
  const timeline = document.querySelector('.timeline-frame');
  const timelineContainer = document.querySelector('#timeline > .container');
  if (timeline && timelineContainer) {
    const resizeToken = crypto.randomUUID();
    const embedUrl = new URL(timeline.src);
    embedUrl.searchParams.set('portfolioResizeToken', resizeToken);
    timeline.src = embedUrl.toString();
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!/^https:\/\/([a-z0-9-]+\.)?googleusercontent\.com$/.test(event.origin)) return;
      if (data?.type !== 'portfolio-timeline-height' || data.token !== resizeToken) return;
      const height = Number(data.height);
      if (!Number.isFinite(height) || height < 100 || height > 30000) return;
      const viewportHeight = Number(data.viewportHeight);
      const wrapperHeight = Number.isFinite(viewportHeight) && viewportHeight > 0
        ? Math.max(0, Math.min(120, timeline.clientHeight - viewportHeight)) : 0;
      timeline.style.minHeight = '0';
      timeline.style.height = `${Math.ceil(height + wrapperHeight)}px`;
    });
    const heading = document.createElement('div');
    heading.className = 'timeline-heading';
    const title = document.createElement('h2');
    title.textContent = 'Experience, in perspective.';
    const link = document.createElement('a');
    link.href = timeline.src;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open full timeline';
    heading.append(title, link);
    timelineContainer.prepend(heading);
  }
  document.querySelectorAll('a[target="_blank"]').forEach((link) => {
    link.rel = 'noopener noreferrer';
  });
})();

/* global document, window */
(() => {
  'use strict';
  const covers = {
    henrys: ['Sheets + automation', 'Service, simplified.', '#875044'],
    kepler: ['Geospatial analytics', 'A different perspective.', '#294951'],
    altitude: ['Route planning', 'Explore the elevation.', '#53604a']
  };
  const previews = [];
  document.querySelectorAll('[data-dom-project]').forEach((card) => {
    const coverData = covers[card.dataset.domProject];
    const link = card.querySelector('a.btn-primary');
    if (!coverData || !link) return;
    const cover = document.createElement('div');
    cover.className = 'project-cover';
    cover.style.setProperty('--cover-bg', coverData[2]);
    const label = document.createElement('span');
    label.textContent = coverData[0];
    const headline = document.createElement('strong');
    headline.textContent = coverData[1];
    cover.append(label, headline);
    card.prepend(cover);
    const preview = document.createElement('details');
    preview.className = 'project-preview';
    const summary = document.createElement('summary');
    summary.textContent = 'Explore live preview';
    const help = document.createElement('p');
    help.textContent = 'If the app requires sign-in or cannot be embedded, use View Project above.';
    preview.append(summary);
    let frame;
    preview.addEventListener('toggle', () => {
      if (preview.open) {
        previews.forEach((other) => { if (other !== preview) other.open = false; });
        if (!frame) {
          frame = document.createElement('iframe');
          frame.title = `${card.querySelector('.card-title').textContent.trim()} live preview`;
          frame.referrerPolicy = 'strict-origin-when-cross-origin';
          frame.src = link.href;
          preview.append(frame, help);
        }
      } else if (frame) {
        frame.remove();
        help.remove();
        frame = undefined;
      }
    });
    previews.push(preview);
    card.append(preview);
  });
  const projectHeading = document.querySelector('#projects h2');
  if (projectHeading) {
    const intro = document.createElement('p');
    intro.className = 'preview-help';
    intro.textContent = 'Working ideas, built to explore. Open a live preview or visit each project in its own window.';
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
      timeline.style.minHeight = '0';
      timeline.style.height = `${Math.ceil(height)}px`;
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

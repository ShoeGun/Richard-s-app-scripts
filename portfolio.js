/* global document, window */
(() => {
  'use strict';
  document.querySelectorAll('[data-dom-project]').forEach((card) => {
    const link = card.querySelector('a.btn-primary');
    if (!link) return;
    const screenshot = { kepler: 'kepler.png', altitude: 'altitude.png' }[card.dataset.domProject];
    if (screenshot) {
      const preview = document.createElement('a');
      preview.className = 'project-screenshot';
      preview.href = link.href;
      preview.target = '_blank';
      preview.rel = 'noopener noreferrer';
      const img = document.createElement('img');
      img.src = '/project-previews/' + screenshot;
      img.alt = card.dataset.domProject === 'kepler'
        ? 'Kepler map displaying spreadsheet locations around Phoenix, Arizona'
        : 'Altitude Directions route along the San Francisco Peninsula with elevation information';
      img.loading = 'lazy';
      img.decoding = 'async';
      const label = document.createElement('span');
      label.textContent = 'Project screenshot / Open live app';
      preview.append(img, label);
      card.prepend(preview);
      if (card.dataset.domProject === 'kepler') {
        const button = document.createElement('button');
        button.className = 'btn btn-outline-secondary mt-2';
        button.type = 'button';
        button.textContent = 'Map + spreadsheet live view';
        button.addEventListener('click', () => {
          const workspace = document.getElementById('kepler-live-workspace');
          if (workspace) { workspace.open = true; workspace.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
        });
        card.querySelector('.card-footer').append(button);
      }
      return;
    }
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
    intro.textContent = 'Explore the projects behind these previews. Open a live app, or see Kepler alongside its spreadsheet below.';
    projectHeading.after(intro);
  }
  const keplerLink = document.querySelector('[data-dom-project="kepler"] a.btn-primary');
  if (keplerLink) {
    const workspace = document.createElement('details');
    workspace.id = 'kepler-live-workspace';
    workspace.className = 'kepler-workspace';
    workspace.innerHTML = `<summary>Explore Kepler: live map + spreadsheet</summary>
      <div class="kepler-workspace-body"><p>The map runs here, next to its data. Use <strong>Load Sheet Data</strong> inside the map to reload the app's configured spreadsheet.</p>
      <form class="kepler-sheet-form"><label for="kepler-sheet-url">Public Google Sheet URL</label><div><input id="kepler-sheet-url" type="url" placeholder="https://docs.google.com/spreadsheets/d/..." required><button class="btn btn-primary" type="submit">Show spreadsheet</button><button class="btn btn-outline-secondary" type="button" data-refresh-map>Reload map</button></div></form>
      <p class="small" role="status" data-sheet-status>No spreadsheet is connected to this view yet. Adding a URL here displays it alongside the map; it does not change the Kepler app's configured data source.</p>
      <div class="kepler-split"><section><h3>Live Kepler map</h3><iframe title="Live Kepler mapping application" loading="lazy"></iframe><a data-open-map target="_blank" rel="noopener noreferrer">Open map in its own tab</a></section><section><h3>Source spreadsheet</h3><div class="kepler-sheet-placeholder">Add the map's public spreadsheet URL above to show it here. Sharing permissions stay unchanged.</div><iframe title="Kepler source spreadsheet" loading="lazy" hidden></iframe><a data-open-sheet target="_blank" rel="noopener noreferrer" hidden>Open spreadsheet in its own tab</a></section></div></div>`;
    const map = workspace.querySelector('iframe[title="Live Kepler mapping application"]');
    const sheet = workspace.querySelector('iframe[title="Kepler source spreadsheet"]');
    const input = workspace.querySelector('input');
    const message = workspace.querySelector('[data-sheet-status]');
    const openSheet = workspace.querySelector('[data-open-sheet]');
    workspace.querySelector('[data-open-map]').href = keplerLink.href;
    workspace.addEventListener('toggle', () => { if (workspace.open && !map.getAttribute('src')) map.src = keplerLink.href; });
    workspace.querySelector('[data-refresh-map]').addEventListener('click', () => { map.src = keplerLink.href; });
    workspace.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const url = new URL(input.value.trim());
        if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !/^\/spreadsheets\/d\/(?:e\/)?[\w-]+(?:\/|$)/.test(url.pathname)) throw new Error('Use a Google Sheets sharing or published-view URL.');
        if (!url.pathname.includes('/pubhtml')) {
          const id = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
          if (!id || id === 'e') throw new Error('For a published sheet, use its pubhtml link.');
          const gid = new URLSearchParams(url.hash.slice(1)).get('gid') || url.searchParams.get('gid') || '0';
          url.pathname = '/spreadsheets/d/' + id + '/preview';
          url.search = '?gid=' + encodeURIComponent(gid);
          url.hash = '';
        }
        sheet.src = url.href;
        sheet.hidden = false;
        workspace.querySelector('.kepler-sheet-placeholder').hidden = true;
        openSheet.href = input.value.trim();
        openSheet.hidden = false;
        message.textContent = 'Spreadsheet view requested. If Google blocks embedding or requires access, open it in its own tab. This does not change the map data source.';
      } catch (error) { message.textContent = error.message; }
    });
    document.querySelector('#projects > .container').append(workspace);
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

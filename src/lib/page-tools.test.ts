import { afterEach, describe, expect, it } from 'vitest';

import { applyPageAction, inferExplicitPageAction, parsePageAction } from './page-tools';

describe('page tools', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.querySelector('#shoegun-live-edit-style')?.remove();
    document.head.querySelector('#shoegun-live-text-style')?.remove();
    document.head.querySelector('#shoegun-jiggle-style')?.remove();
    document.head.querySelector('#shoegun-text-jiggle-style')?.remove();
    document.getElementById('shoegun-live-html')?.remove();
  });

  it('turns an explicit black-page request into a CSS action', () => {
    const action = inferExplicitPageAction('make everything black so I can see it');
    expect(action?.kind).toBe('css');
    expect(action?.code).toContain('background-color: #000');
  });

  it('handles white, jiggle, and short reset commands without model interpretation', () => {
    expect(inferExplicitPageAction('make everything white please')?.code).toContain('background-color: #fff');
    expect(inferExplicitPageAction('make everything jiggle')?.code).toContain('@keyframes shoegun-jiggle');
    expect(inferExplicitPageAction('make all page elements stop jiggling please')?.code).toContain("shoegun-jiggle-style");
    expect(inferExplicitPageAction('reset it')?.kind).toBe('reset');
  });

  it('supports description-based div inspection, targeted jiggle, and named colors', () => {
    const inspect = inferExplicitPageAction('find the divs containing the text Featured Projects');
    expect(inspect).toMatchObject({ kind: 'inspect', selector: 'div', text: 'Featured Projects' });
    expect(inferExplicitPageAction('make the div labeled Meet Dom jiggle')?.code).toContain('shoegun-jiggle-target');
    expect(inferExplicitPageAction('make everything red')?.code).toContain('background-color: red');
    expect(inferExplicitPageAction('make the div with "Richard Jones" in it jiggle')?.code).toContain('richard jones');
    expect(inferExplicitPageAction('make the div with Richard Jones in it jiggle')?.code).toContain('richard jones');
    expect(inferExplicitPageAction('make the background of all divs grey')?.code).toContain('background-color: gray');
    expect(inferExplicitPageAction('make all the text red')?.code).toContain('color: red');
    expect(inferExplicitPageAction('make the first div black and all others white')?.code).toContain('first-child');
    expect(inferExplicitPageAction('make only text jiggle')?.code).toContain('shoegun-text-jiggle');
    expect(inferExplicitPageAction('make your face look sleepy')?.code).toContain("setMood('sleepy')");
    expect(inferExplicitPageAction('sleepier!')?.code).toContain("setMood('sleepy')");
    expect(inferExplicitPageAction('set mood to celibrate')?.code).toContain("setMood('celebrate')");
    expect(inferExplicitPageAction('make yourself the sleepiest thing in existence')?.code).toContain("setMood('sleepy')");
  });

  it('handles live HTML insertion and consultation-panel console requests without model output', () => {
    const insert = inferExplicitPageAction('Insert a div under the hero that says Ready for a consultation.');
    expect(insert).toMatchObject({ kind: 'html', code: expect.stringContaining('portfolio-live-message') });
    expect(insert?.code).toContain('Ready for a consultation');
    const consoleAction = inferExplicitPageAction('Use the page console to add a class to the consultation panel.');
    expect(consoleAction).toMatchObject({ kind: 'javascript' });
    expect(consoleAction?.code).toContain("classList.add('is-highlighted')");
  });

  it('keeps project-card restoration separate from a full page reset', () => {
    expect(inferExplicitPageAction('restore the project cards')?.code).toContain('window.__shoegunPresentation?.reset()');
  });

  it('parses the model action marker with nested JavaScript', () => {
    const action = parsePageAction('PAGE_ACTION_JSON: {"kind":"javascript","label":"Glow","code":"document.body.dataset.mode = \'glow\';"}');
    expect(action).toEqual({ kind: 'javascript', label: 'Glow', code: "document.body.dataset.mode = 'glow';" });
  });

  it('creates explicit timeline roll-up and expansion actions', () => {
    const collapse = inferExplicitPageAction('roll up the work history timeline');
    expect(collapse?.kind).toBe('javascript');
    expect(collapse?.code).toContain("toggleAttribute('open', false)");

    const expand = inferExplicitPageAction('expand the timeline');
    expect(expand?.kind).toBe('javascript');
    expect(expand?.code).toContain("toggleAttribute('open', true)");
  });

  it('creates explicit presentation actions for project cards', () => {
    expect(inferExplicitPageAction('present the Kepler project')?.code)
      .toBe("window.__shoegunPresentation?.showProject('kepler');");
    expect(inferExplicitPageAction('stack the project cards')?.code)
      .toBe("window.__shoegunPresentation?.stack();");
  });

  it('creates an explicit split presentation workspace action', () => {
    expect(inferExplicitPageAction('show Kepler and the Sheet side by side')?.code)
      .toBe("window.__shoegunPresentation?.openWorkspace('kepler');");
  });

  it('creates explicit chart-face actions', () => {
    expect(inferExplicitPageAction('animate Dom\'s face')?.code)
      .toBe("window.__shoegunDomFace?.animate();");
    expect(inferExplicitPageAction('make Dom\'s face happy')?.code)
      .toBe("window.__shoegunDomFace?.setMood('happy');");
    expect(inferExplicitPageAction('make Dom celebrate with fireworks')?.code)
      .toContain('window.__shoegunDomEffects?.fireworks()');
    expect(inferExplicitPageAction('make it rain hotdogs')?.code)
      .toContain('window.__shoegunDomEffects?.hotdogRain()');
    expect(inferExplicitPageAction('stop the hotdog rain')?.code)
      .toContain('stopHotdogRain');
    expect(inferExplicitPageAction('make Dom look surprised')?.code)
      .toBe("window.__shoegunDomFace?.setMood('surprised');");
  });

  it('focuses the embedded sheet field for an explicit spreadsheet request', () => {
    const action = inferExplicitPageAction('I want to connect my spreadsheet');
    expect(action?.label).toBe('Focus the public Google Sheet field');
    expect(action?.code).toContain("shoegun-focus-sheet");
    expect(action?.code).toContain("shoegun-agent-guidance");
  });

  it('passes a pasted public sheet URL to the embedded field', () => {
    const action = inferExplicitPageAction('connect this sheet https://docs.google.com/spreadsheets/d/example/edit');
    expect(action?.code).toContain('url: "https://docs.google.com/spreadsheets/d/example/edit"');
  });

  it('opens consultation options only for an explicit booking request', () => {
    const action = inferExplicitPageAction('book a free 20-minute consultation');
    expect(action).toEqual({
      kind: 'javascript',
      label: 'Open consultation and interview options',
      code: "document.querySelector('#consultation-booking')?.toggleAttribute('open', true);"
    });
  });

  it('applies CSS, HTML, and JavaScript to the live page and can reset them', () => {
    const cssReceipt = applyPageAction({ kind: 'css', label: 'Black', code: 'body { background: #000; }' }, window);
    expect(cssReceipt.detail).toContain('CSS');
    expect(document.getElementById('shoegun-live-edit-style')?.textContent).toContain('#000');

    applyPageAction({ kind: 'html', label: 'Badge', code: '<p>Live badge</p>' }, window);
    expect(document.getElementById('shoegun-live-html')?.textContent).toContain('Live badge');

    applyPageAction({ kind: 'javascript', label: 'Mark', code: "document.body.dataset.edited = 'yes';" }, window);
    expect(document.body.dataset.edited).toBe('yes');

    applyPageAction({ kind: 'reset', label: 'Reset' }, window);
    expect(document.getElementById('shoegun-live-edit-style')).toBeNull();
    expect(document.getElementById('shoegun-live-html')).toBeNull();
  });

  it('keeps image color when applying a black page and removes jiggle without removing other CSS', () => {
    const black = inferExplicitPageAction('make the background of all divs black');
    expect(black?.code).not.toContain('grayscale');
    applyPageAction(black!, window);
    applyPageAction(inferExplicitPageAction('make everything jiggle')!, window);
    expect(document.getElementById('shoegun-live-edit-style')).not.toBeNull();
    expect(document.getElementById('shoegun-jiggle-style')).not.toBeNull();
    applyPageAction(inferExplicitPageAction('stop the jiggle')!, window);
    expect(document.getElementById('shoegun-jiggle-style')).toBeNull();
    expect(document.getElementById('shoegun-live-edit-style')?.textContent).toContain('background-color: #000');
  });

  it('stops text jiggle without leaving the text animation behind', () => {
    applyPageAction(inferExplicitPageAction('make only text jiggle')!, window);
    expect(document.getElementById('shoegun-text-jiggle-style')).not.toBeNull();
    applyPageAction(inferExplicitPageAction('stop text jiggle')!, window);
    expect(document.getElementById('shoegun-text-jiggle-style')).toBeNull();
  });

  it('keeps a text color edit when the page background was already changed', () => {
    applyPageAction(inferExplicitPageAction('make the background of all divs black')!, window);
    applyPageAction(inferExplicitPageAction('make all text red')!, window);
    expect(document.getElementById('shoegun-live-edit-style')?.textContent).toContain('background-color: #000');
    expect(document.getElementById('shoegun-live-text-style')?.textContent).toContain('color: red');
  });

  it('filters bounded inspection results by visible text', () => {
    document.body.innerHTML = '<div>Featured Projects</div><div>Other content</div>';
    const receipt = applyPageAction({ kind: 'inspect', label: 'Find featured projects', selector: 'div', text: 'Featured Projects' }, window);
    expect(receipt.detail).toContain('Observed 1 element(s)');
  });

  it('jiggles the most specific matching div instead of every ancestor', () => {
    document.body.innerHTML = '<div class="outer"><div class="inner">Richard Jones</div></div>';
    const action = inferExplicitPageAction('make the div with Richard Jones in it jiggle');
    applyPageAction(action!, window);
    expect(document.querySelector('.inner')?.classList.contains('shoegun-jiggle-target')).toBe(true);
    expect(document.querySelector('.outer')?.classList.contains('shoegun-jiggle-target')).toBe(false);
  });

  it('recognizes the explicit browser-action contract without model generation', () => {
    const cases = [
      ['Find the divs containing the text Featured Projects.', 'inspect'],
      ['Find the div labeled About Me.', 'inspect'],
      ['Make the div labeled About Me jiggle.', 'shoegun-jiggle-target'],
      ['Make all page elements jiggle.', 'shoegun-jiggle'],
      ['Stop all the page elements from jiggling.', 'shoegun-jiggle-style'],
      ['Make all div backgrounds black and keep the pictures in full color.', 'background-color: #000'],
      ['Make the background of all divs purple.', 'background-color: purple'],
      ['Make the background of all divs grey.', 'background-color: gray'],
      ['Make all the text red in every div.', 'color: red'],
      ['Make the background of the first div black and all others white.', 'first-child'],
      ['Make only text jiggle.', 'shoegun-text-jiggle'],
      ['Reset all the page edits.', 'reset'],
      ['Insert a div under the hero that says Ready for a consultation.', 'portfolio-live-message'],
      ['Use the page console to add a class to the consultation panel.', 'classList.add'],
      ['Remove the temporary div with id portfolio-live-message.', 'remove'],
      ['Set off fireworks on the page.', 'fireworks'],
      ['Make it rain hotdogs over the portfolio.', 'hotdogRain'],
      ['Stop the hotdog rain.', 'stopHotdogRain'],
      ['Make yourself the sleepiest thing in existence.', "setMood('sleepy')"],
      ['Set mood to celibrate.', "setMood('celebrate')"],
      ['Present the Henry project.', "showProject('henrys')"]
    ] as const;
    const passed = cases.filter(([prompt, expected]) => {
      const action = inferExplicitPageAction(prompt);
      return action?.kind === expected || action?.code?.includes(expected) || action?.kind === expected;
    });
    expect(passed).toHaveLength(cases.length);
    expect(passed.length / cases.length).toBeGreaterThanOrEqual(0.9);
  });
});

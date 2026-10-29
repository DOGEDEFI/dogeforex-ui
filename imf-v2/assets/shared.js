(() => {
  'use strict';
  const config = window.IMF_SITE;
  if (!config?.origins) throw new Error('Missing generated IMF site configuration');

  function url(surface, suffix = '') {
    const origin = config.origins[surface];
    if (!origin) throw new Error(`Unknown surface ${surface}`);
    return new URL(suffix.replace(/^\//, ''), origin).href;
  }

  function guide(id) {
    return url('docs', `guides/${encodeURIComponent(id)}/`);
  }

  function assets(path = '') {
    return `/assets/${path.replace(/^\//, '')}`;
  }

  function resolveContent(html) {
    return html
      .replaceAll('{{website}}', config.origins.website)
      .replaceAll('{{docs}}', config.origins.docs)
      .replaceAll('{{app}}', config.origins.app)
      .replaceAll('../assets/', assets())
      .replace(/href="#([a-z0-9-]+)"/g, (_, id) => `href="${guide(id)}"`);
  }

  function resolveLinks(scope = document) {
    for (const link of scope.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      let match;
      if ((match = href.match(/^(?:\.\.\/)?docs\/#([a-z0-9-]+)$/))) link.href = guide(match[1]);
      else if ((match = href.match(/^(?:\.\.\/)?docs\/(.*)$/))) link.href = url('docs', match[1]);
      else if ((match = href.match(/^(?:\.\.\/)?app\/(.*)$/))) link.href = url('app', match[1]);
      else if ((match = href.match(/^(?:\.\.\/)?index\.html(#.*)$/))) link.href = url('website', match[1]);
      else if (/^(?:\.\.\/?|\.\/?)$/.test(href)) link.href = url('website');
    }
  }

  window.IMF_LINKS = { url, guide, assets, resolveContent, resolveLinks, review: config.review };
  document.body.dataset.surface = config.surface;
  resolveLinks();

  const menu = document.querySelector('.menu');
  const navigation = document.querySelector('.navlinks');
  function closeMenu(restoreFocus = false) {
    menu?.setAttribute('aria-expanded', 'false');
    navigation?.classList.remove('open');
    if (restoreFocus) menu?.focus();
  }
  menu?.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    navigation?.classList.toggle('open', open);
  });
  navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => closeMenu()));
  const sidebarToggle = document.querySelector('.sidebar-toggle');
  const sidebarContent = document.querySelector('.sidebar-content');
  const mobileSidebar = window.matchMedia('(max-width: 700px)');
  function setSidebar(open) {
    if (!sidebarToggle || !sidebarContent) return;
    sidebarToggle.setAttribute('aria-expanded', String(open));
    sidebarContent.hidden = mobileSidebar.matches && !open;
  }
  function synchronizeSidebar() {
    if (!sidebarContent) return;
    if (mobileSidebar.matches) setSidebar(false);
    else {
      sidebarContent.hidden = false;
      sidebarToggle?.setAttribute('aria-expanded', 'true');
    }
  }
  sidebarToggle?.addEventListener('click', () => setSidebar(sidebarToggle.getAttribute('aria-expanded') !== 'true'));
  sidebarContent?.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    if (mobileSidebar.matches) setSidebar(false);
  }));
  mobileSidebar.addEventListener('change', synchronizeSidebar);
  synchronizeSidebar();

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (menu?.getAttribute('aria-expanded') === 'true') closeMenu(true);
    if (mobileSidebar.matches && sidebarToggle?.getAttribute('aria-expanded') === 'true') {
      setSidebar(false);
      sidebarToggle.focus();
    }
  });

  document.querySelectorAll('.skip').forEach((link) => link.addEventListener('click', (event) => {
    const main = document.querySelector('#main');
    if (!main) return;
    event.preventDefault();
    main.setAttribute('tabindex', '-1');
    main.focus();
    main.scrollIntoView({ block: 'start' });
  }));

  // Shared glossary: progressively upgrades native <details class="info"> disclosures with
  // canonical guide links. Without JavaScript the static explanation and link still work.
  const infoReady = fetch(window.IMF_LINKS.assets('glossary.json'))
    .then((response) => {
      if (!response.ok) throw new Error(`Glossary request failed (${response.status})`);
      return response.json();
    })
    .then((glossary) => {
      if (!Array.isArray(glossary) || glossary.some((entry) => !entry.term || !entry.guide || !entry.plain)) throw new Error('Invalid glossary');
      const terms = new Map(glossary.map((entry) => [entry.term, entry]));
      for (const box of document.querySelectorAll('details.info[data-term]')) {
        const entry = terms.get(box.dataset.term);
        if (!entry) continue;
        const link = box.querySelector('a[data-guide-link]');
        if (link) {
          link.href = window.IMF_LINKS.guide(entry.guide);
          link.textContent = entry.link;
        }
        box.dataset.glossary = 'ready';
      }
      return terms;
    })
    .catch(() => new Map());
  window.IMF_INFO = { ready: infoReady };
})();

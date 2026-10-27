(() => {
  'use strict';
  const links = document.querySelector('#doc-links');
  const search = document.querySelector('#doc-search');
  const status = document.querySelector('#search-status');
  const article = document.querySelector('#article');
  const navigation = [...links.querySelectorAll('a[data-guide]')];
  let guides = new Map();

  function legacyShortcut() {
    const id = location.hash.slice(1);
    document.querySelector('#legacy-shortcut-error')?.remove();
    if (!id) return;
    const target = navigation.find((link) => link.dataset.guide === id);
    if (target) {
      location.replace(target.href);
      return;
    }
    const notice = document.createElement('p');
    notice.id = 'legacy-shortcut-error';
    notice.className = 'callout';
    notice.setAttribute('role', 'alert');
    notice.textContent = 'Guide not found. Choose an available guide from the documentation navigation.';
    article.prepend(notice);
  }

  function navigationFilter() {
    const term = search.value.trim().toLowerCase();
    let count = 0;
    for (const link of navigation) {
      const guide = guides.get(link.dataset.guide);
      const haystack = guide ? `${guide.label} ${guide.title} ${guide.intro} ${guide.html}` : link.textContent;
      const visible = !term || haystack.toLowerCase().includes(term);
      link.hidden = !visible;
      if (visible) count += 1;
    }
    status.textContent = term ? `${count} guide${count === 1 ? '' : 's'} found` : '';
  }

  legacyShortcut();
  window.addEventListener('hashchange', legacyShortcut);
  search.addEventListener('input', navigationFilter);
  fetch(window.IMF_LINKS.assets('articles.json'))
    .then((response) => {
      if (!response.ok) throw new Error(`Guide index request failed (${response.status})`);
      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data) || data.some((guide) => !guide.id || !guide.title || !guide.html)) throw new Error('Invalid guide index');
      guides = new Map(data.map((guide) => [guide.id, guide]));
      search.dataset.ready = 'true';
      navigationFilter();
    })
    .catch(() => {
      search.disabled = true;
      search.setAttribute('aria-describedby', 'search-status');
      status.textContent = 'Search is unavailable. All guide links and full guide pages remain available.';
    });
})();

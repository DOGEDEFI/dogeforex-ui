(() => {
  'use strict';
  const views = ['dashboard', 'create', 'manage', 'arena', 'ecosystem', 'connection', 'offline', 'review', 'drafts', 'lifecycle'];
  const titles = {
    dashboard: 'Dashboard',
    create: 'Create & mint',
    manage: 'Manage & close',
    arena: 'Challenges & auctions',
    ecosystem: 'Bridge, savings & equity',
    connection: 'Wallet, registry & network',
    offline: 'Teaching & legacy plans',
    review: 'Review teaching plan',
    drafts: 'Saved drafts',
    lifecycle: 'Operating workflow',
  };
  let view = 'create';
  let agentMode = new URLSearchParams(location.search).get('mode') === 'agent';
  let store;
  let v2;
  let dashboard;

  function notify(message) {
    const status = document.querySelector('#feedback');
    status.hidden = !message;
    status.textContent = message;
  }

  function activePlan() {
    if (view === 'create') return v2.getPlan();
    if (view === 'offline' || view === 'review') return window.IMF_OFFLINE.getPlan();
    throw new Error('Choose a V2 or teaching planner before exporting');
  }

  function updateAgent() {
    const visible = agentMode && ['create', 'offline', 'review'].includes(view);
    document.querySelector('#agent-panel').hidden = !visible;
    if (!visible) return;
    try {
      document.querySelector('#agent-json').textContent = JSON.stringify(activePlan(), null, 2);
    } catch (cause) {
      document.querySelector('#agent-json').textContent = JSON.stringify({ status: 'editing', executionEnabled: false, message: cause.message }, null, 2);
    }
  }

  function setMode(agent) {
    agentMode = agent;
    for (const [selector, active] of [['#human-mode', !agent], ['#agent-mode', agent]]) {
      document.querySelector(selector).classList.toggle('active', active);
      document.querySelector(selector).setAttribute('aria-pressed', String(active));
    }
    updateAgent();
  }

  function showView(next, focus = true) {
    if (!views.includes(next)) throw new Error(`Unknown workspace view ${next}`);
    view = next;
    notify('');
    for (const name of views) document.querySelector(`#${name}-view`).hidden = name !== next;
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === next || (next === 'review' && button.dataset.view === 'offline');
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelector('#view-title').textContent = titles[next];
    document.querySelector('.mode-switch').hidden = !['create', 'offline', 'review'].includes(next);
    if (next === 'drafts') renderDrafts();
    if (next === 'ecosystem') {
      document.querySelector('#ecosystem-currency').value = document.querySelector('#v2-currency').value;
      currencies();
    }
    if (next === 'dashboard') dashboard?.activate();
    updateAgent();
    if (focus) {
      document.querySelector('#view-title').setAttribute('tabindex', '-1');
      document.querySelector('#view-title').focus();
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function renderDrafts() {
    const list = document.querySelector('#draft-list');
    list.replaceChildren();
    let drafts;
    try {
      drafts = store.list();
    } catch (cause) {
      list.textContent = `Draft storage is unavailable or invalid: ${cause.message}. You can still export a reviewed plan.`;
      return;
    }
    if (!drafts.length) {
      const message = document.createElement('p');
      message.textContent = 'No saved drafts on this app origin. Create a read-only V2 plan or a teaching plan first.';
      const button = document.createElement('button');
      button.className = 'btn mint';
      button.textContent = 'Open V2 planner';
      button.addEventListener('click', () => showView('create'));
      list.append(message, button);
      return;
    }
    for (const plan of drafts) {
      const row = document.createElement('div');
      row.className = 'saved-row';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = plan.project;
      const detail = document.createElement('small');
      detail.textContent = `${plan.schema} · K9${plan.currency} · ${plan.savedAt} · No execution authority`;
      info.append(title, detail);
      const actions = document.createElement('div');
      actions.className = 'actions';
      const load = document.createElement('button');
      load.className = 'btn light small';
      load.textContent = 'Load draft';
      load.addEventListener('click', () => {
        if (plan.schema === 'imf.position-plan.v1') window.IMF_OFFLINE.load(plan);
        else v2.loadPlan(plan);
      });
      const remove = document.createElement('button');
      remove.className = 'btn light small';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete draft for ${plan.project}`);
      remove.addEventListener('click', () => {
        try {
          store.remove(plan.id);
          renderDrafts();
          notify('Draft deleted from this app origin.');
        } catch (cause) {
          notify(cause.message);
        }
      });
      actions.append(load, remove);
      row.append(info, actions);
      list.append(row);
    }
  }

  function currencies() {
    const verified = (code) => v2?.state?.verified?.get(code) === true;
    const readCount = window.IMF_CURRENCIES.filter(({ code }) => verified(code)).length;
    for (const id of ['#v2-currency', '#offline-currency', '#ecosystem-currency']) {
      const select = document.querySelector(id);
      const previous = select.value;
      select.replaceChildren(...window.IMF_CURRENCIES.map(({ code, name, symbol }) => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = `${symbol} — ${name}${id !== '#offline-currency' && !verified(code) ? ' · read unavailable' : ''}`;
        if (id === '#ecosystem-currency') option.disabled = !verified(code);
        return option;
      }));
      if (window.IMF_CURRENCIES.some(({ code }) => code === previous)) select.value = previous;
      if (id === '#ecosystem-currency') {
        select.disabled = readCount === 0;
        if (select.selectedOptions[0]?.disabled || !select.value) select.value = [...select.options].find((option) => !option.disabled)?.value || '';
      }
    }
    const availability = document.querySelector('#ecosystem-availability');
    availability.textContent = v2?.state?.fixture
      ? `${readCount} synthetic read model${readCount === 1 ? '' : 's'} available. No deployment is implied.`
      : readCount
        ? `${readCount} of ${window.IMF_CURRENCIES.length} currency systems are verified for read-only access. Planning codes do not imply deployment.`
        : 'No currency system is verified for reads. The 11 codes remain planning identifiers; configure a V2 registry under Registry & network.';
    document.querySelector('#ecosystem-load-form button[type="submit"]').disabled = readCount === 0;
    const query = new URLSearchParams(location.search);
    if (window.IMF_PLANNING.codes.includes(query.get('currency'))) {
      document.querySelector('#v2-currency').value = query.get('currency');
      document.querySelector('#offline-currency').value = query.get('currency');
    }
    if (window.IMF_PLANNING.decimal.test(query.get('gross') || '') && Number(query.get('gross')) <= 1e12 && Number(query.get('gross')) > 0) {
      document.querySelector('#position-form').elements.namedItem('gross').value = query.get('gross');
    }
  }

  function init() {
    currencies();
    let storage;
    try {
      storage = window.localStorage;
    } catch {
      storage = { getItem() { throw new Error('Browser storage is disabled'); }, setItem() { throw new Error('Browser storage is disabled'); } };
    }
    store = new window.IMF_PLANNING.DraftStore(storage);
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
    document.querySelector('#human-mode').addEventListener('click', () => setMode(false));
    document.querySelector('#agent-mode').addEventListener('click', () => setMode(true));
    document.querySelector('#export-agent-plan').addEventListener('click', () => {
      try {
        const plan = activePlan();
        window.IMF_PLANNING.download(plan, `imf-${plan.currency.toLowerCase()}-${plan.schema === 'imf.position-plan.v1' ? 'position-plan' : `${plan.action}-read-plan`}.json`);
        notify('Planning JSON exported. No transaction or signing authority was created.');
      } catch (cause) {
        notify(cause.message);
      }
    });
    document.querySelector('#export-drafts').addEventListener('click', () => {
      try {
        window.IMF_PLANNING.download(store.backup(), 'imf-draft-backup.json');
      } catch (cause) {
        notify(cause.message);
      }
    });
    const backupFile = document.querySelector('#draft-backup-file');
    document.querySelector('#import-drafts').addEventListener('click', () => backupFile.click());
    backupFile.addEventListener('change', async () => {
      try {
        const file = backupFile.files[0];
        if (!file || file.size > 1000000) throw new Error('Choose a draft backup smaller than 1 MB');
        const count = store.restore(JSON.parse(await file.text()));
        renderDrafts();
        notify(`${count} new local drafts imported. No on-chain state or authority was imported.`);
      } catch (cause) {
        notify(cause.message);
      } finally {
        backupFile.value = '';
      }
    });
    window.IMF_OFFLINE.init({ store, onView: showView, onPlan: updateAgent, notify });
    dashboard = window.IMF_DASHBOARD.init({ getV2: () => v2, notify });
    v2 = window.IMF_V2_APP.init({ store, onView: showView, onPlan: updateAgent, onRegistry: () => { currencies(); window.IMF_ACTIONS?.refreshPolicy(); dashboard?.refresh(); }, notify });
    window.IMF_ACTIONS.init(v2, { onView: showView, notify });
    setMode(agentMode);
    window.addEventListener('hashchange', () => {
      const panel = dashboard?.panelFromHash?.();
      if (panel) showView('dashboard', false);
    });
    showView(dashboard?.panelFromHash?.() ? 'dashboard' : 'create', false);
  }

  init();
})();

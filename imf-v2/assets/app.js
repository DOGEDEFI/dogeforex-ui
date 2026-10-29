(() => {
  'use strict';
  const views = ['start', 'dashboard', 'create', 'manage', 'arena', 'ecosystem', 'connection', 'offline', 'review', 'drafts', 'lifecycle'];
  const titles = {
    start: 'Start here',
    dashboard: 'Dashboard',
    create: 'Borrow',
    manage: 'My positions',
    arena: 'Challenges & auctions',
    ecosystem: 'Earn',
    connection: 'Registry & network',
    offline: 'Teaching & legacy plans',
    review: 'Review teaching plan',
    drafts: 'Saved drafts',
    lifecycle: 'Operating workflow',
  };
  const ECOSYSTEM_COPY = {
    savings: {
      title: 'Earn', heading: 'Earn with K9 savings.',
      description: 'Deposit the selected currency into its savings module. Interest depends on the current leadrate and available system equity.',
      steps: [['Deposit K9 currency', 'Choose an amount and review the current savings state.'], ['Track the current rate', 'The governed leadrate and available equity determine interest.'], ['Withdraw with a fresh review', 'New deposits have a weighted lock of up to three days.']],
    },
    equity: {
      title: 'Invest', heading: 'Invest in one K9 currency system.',
      description: 'Pool shares participate in the gains, losses, and governance of the selected independent system. They are not the currency itself.',
      steps: [['Invest K9 currency', 'Read the current nonlinear quote and minimum share output.'], ['Hold pool shares', 'Share value can rise or fall with the system equity and share supply.'], ['Participate or redeem', 'Review voting rights, holding periods, and current redemption terms.']],
    },
    bridge: {
      title: 'Source bridge', heading: 'Move between source tokens and K9 currency.',
      description: 'The bridge locks or releases a source token and accounts for the local currency. This is nominal unit conversion, not an FX trade.',
      steps: [['Check bridge capacity', 'Read source decimals, local limits, locked tokens, and current availability.'], ['Deposit or redeem', 'Review exact source and local amounts, recipients, and any remainder.'], ['Reconcile the receipt', 'Immediate redemption and unpaid source credits follow different steps.']],
    },
    governance: {
      title: 'Governance', heading: 'Participate with time-weighted votes.',
      description: 'Qualified participants administer proposals and vetoes for each independent currency system. Token balances alone do not qualify.',
      steps: [['Check qualification', 'Read time-weighted votes, delegators, and strictly sorted helper addresses.'], ['Review the window', 'Proposal, denial, initialization, and rate-change clocks have different rules.'], ['Confirm the exact action', 'Vetoes and irreversible expert operations require a separate explicit review.']],
    },
  };
  const baseTitle = document.title;
  let view = 'start';
  let ecosystemFocus = 'savings';
  let routeFocus = null;
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

  function renderEcosystemFocus() {
    const copy = ECOSYSTEM_COPY[ecosystemFocus];
    titles.ecosystem = copy.title;
    document.querySelector('#ecosystem-heading').textContent = copy.heading;
    document.querySelector('#ecosystem-description').textContent = copy.description;
    const steps = document.querySelector('#ecosystem-steps');
    steps.setAttribute('aria-label', `How ${copy.title.toLowerCase()} works`);
    steps.replaceChildren(...copy.steps.map(([title, description], index) => {
      const item = document.createElement('li');
      const number = document.createElement('span');
      number.textContent = String(index + 1);
      const body = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = title;
      const paragraph = document.createElement('p');
      paragraph.textContent = description;
      body.append(strong, paragraph);
      item.append(number, body);
      return item;
    }));
    const panels = {
      bridge: document.querySelector('#bridge-state').closest('.panel'),
      savings: document.querySelector('#savings-state').closest('.panel'),
      equity: document.querySelector('#equity-state').closest('.panel'),
      governance: document.querySelector('#minter-state').closest('.panel'),
    };
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== ecosystemFocus;
    panels.bridge.closest('.app-grid').hidden = !['bridge', 'savings'].includes(ecosystemFocus);
  }

  function showView(next, focus = true, requestedFocus = null) {
    if (!views.includes(next)) throw new Error(`Unknown workspace view ${next}`);
    view = next;
    if (next === 'ecosystem' && requestedFocus && ECOSYSTEM_COPY[requestedFocus]) ecosystemFocus = requestedFocus;
    notify('');
    for (const name of views) document.querySelector(`#${name}-view`).hidden = name !== next;
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = (button.dataset.view === next || (next === 'review' && button.dataset.view === 'offline'))
        && (next !== 'ecosystem' || !button.dataset.ecosystemFocus || button.dataset.ecosystemFocus === ecosystemFocus);
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (next === 'ecosystem') renderEcosystemFocus();
    if (next === 'dashboard') {
      document.title = baseTitle;
    } else {
      document.querySelector('#view-title').textContent = titles[next];
      document.title = `${titles[next]} · IMF project workspace`;
      if (next !== 'review') {
        const hash = next === 'ecosystem' ? { savings: 'earn', equity: 'invest', bridge: 'bridge', governance: 'governance' }[ecosystemFocus] : next;
        history.replaceState(null, '', `#${hash}`);
      }
    }
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
    for (const id of ['#v2-currency', '#offline-currency', '#ecosystem-currency', '#workspace-currency']) {
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
        : 'No currency system is verified for reads. The 12 codes remain planning identifiers; configure a V2 registry under Registry & network.';
    document.querySelector('#ecosystem-load-form button[type="submit"]').disabled = readCount === 0;
    const query = new URLSearchParams(location.search);
    if (window.IMF_PLANNING.codes.includes(query.get('currency'))) {
      document.querySelector('#v2-currency').value = query.get('currency');
      document.querySelector('#offline-currency').value = query.get('currency');
    }
    document.querySelector('#workspace-currency').value = document.querySelector('#v2-currency').value;
    if (window.IMF_PLANNING.decimal.test(query.get('gross') || '') && Number(query.get('gross')) <= 1e12 && Number(query.get('gross')) > 0) {
      document.querySelector('#position-form').elements.namedItem('gross').value = query.get('gross');
    }
  }

  let borrowPositions = [];

  function renderBorrowPositions() {
    const target = document.querySelector('#borrow-position-list');
    const query = document.querySelector('#borrow-position-search').value.trim().toLowerCase();
    const positions = borrowPositions.filter((position) => !query || [position.address, position.owner, position.collateral?.symbol].some((value) => String(value ?? '').toLowerCase().includes(query)));
    target.replaceChildren();
    if (!positions.length) {
      const message = document.createElement('p');
      message.className = 'smalltext';
      message.textContent = borrowPositions.length ? 'No discovered positions match this search.' : 'No positions were discovered in the completed read coverage.';
      target.append(message);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap borrow-table-wrap';
    wrap.tabIndex = 0;
    const table = document.createElement('table');
    table.className = 'borrow-table';
    table.innerHTML = '<thead><tr><th>Position / collateral</th><th>Gross debt</th><th>Minting capacity</th><th>Risk premium</th><th>Maturity</th><th>Action</th></tr></thead>';
    const body = document.createElement('tbody');
    const code = document.querySelector('#v2-currency').value;
    for (const position of positions) {
      const row = document.createElement('tr');
      const identity = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = position.collateral?.symbol ?? 'Unknown collateral';
      const address = document.createElement('small');
      address.textContent = `${position.address.slice(0, 10)}…${position.address.slice(-4)}`;
      identity.append(strong, address);
      const amount = (value, decimals = 18) => {
        try { return `${window.IMF_V2.formatDecimal(BigInt(value ?? 0), decimals)} K9${code}`; }
        catch { return 'Unavailable'; }
      };
      const debt = document.createElement('td');
      debt.textContent = amount(position.minted);
      const capacity = document.createElement('td');
      capacity.textContent = amount(position.availableForMinting);
      const premium = document.createElement('td');
      try { premium.textContent = `${window.IMF_V2.formatPPM(BigInt(position.riskPremiumPPM ?? 0))}%`; }
      catch { premium.textContent = 'Unavailable'; }
      const maturity = document.createElement('td');
      try { maturity.textContent = new Date(Number(position.expiration) * 1000).toISOString().slice(0, 10); }
      catch { maturity.textContent = 'Unavailable'; }
      const action = document.createElement('td');
      const clone = document.createElement('button');
      clone.type = 'button';
      clone.className = 'btn light small';
      clone.textContent = 'Clone terms';
      clone.setAttribute('aria-label', `Clone terms from ${position.address}`);
      clone.addEventListener('click', () => {
        const radio = document.querySelector('#v2-position-form [name="action"][value="clone"]');
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#v2-position-form [name="parent"]').value = position.address;
        document.querySelector('#v2-position-form').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        notify(`Parent ${position.address} loaded. Read the accepted terms and current quote before reviewing a transaction.`);
      });
      action.append(clone);
      row.append(identity, debt, capacity, premium, maturity, action);
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    target.append(wrap);
  }

  async function findBorrowPositions() {
    const button = document.querySelector('#borrow-find-positions');
    const target = document.querySelector('#borrow-position-list');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    target.textContent = 'Discovering events and verifying current position state…';
    try {
      const code = document.querySelector('#v2-currency').value;
      const client = await v2.clientFor(code, { fresh: true });
      const discovered = await window.IMF_DISCOVERY.discover(v2.state, client, null, { resume: false });
      borrowPositions = discovered.positions ?? [];
      renderBorrowPositions();
      notify(`${borrowPositions.length} positions discovered for K9${code}. No transaction was prepared.`);
    } catch (cause) {
      borrowPositions = [];
      target.textContent = `Position discovery unavailable: ${cause.message}`;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  function routeFromLocation() {
    routeFocus = null;
    if (dashboard?.panelFromHash?.()) return 'dashboard';
    const clean = location.hash.replace(/^#\/?/, '');
    if (!clean) return 'start';
    if (clean.startsWith('dashboard')) return null;
    const name = clean.split('/')[0];
    if (name === 'review') return 'offline';
    const aliases = { earn: 'savings', invest: 'equity', bridge: 'bridge', governance: 'governance' };
    if (aliases[name]) {
      routeFocus = aliases[name];
      return 'ecosystem';
    }
    return views.includes(name) ? name : null;
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
    document.querySelectorAll('[data-view], [data-start-target]').forEach((button) => button.addEventListener('click', () => {
      button.closest('details.workspace-more')?.removeAttribute('open');
      showView(button.dataset.view ?? button.dataset.startTarget, true, button.dataset.ecosystemFocus ?? null);
    }));
    document.querySelector('#workspace-currency').addEventListener('change', (event) => {
      document.querySelector('#v2-currency').value = event.target.value;
      document.querySelector('#v2-currency').dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.querySelector('#v2-currency').addEventListener('change', (event) => {
      document.querySelector('#workspace-currency').value = event.target.value;
      document.querySelector('#ecosystem-currency').value = event.target.value;
      borrowPositions = [];
      renderBorrowPositions();
    });
    document.querySelector('#ecosystem-currency').addEventListener('change', (event) => {
      document.querySelector('#v2-currency').value = event.target.value;
      document.querySelector('#v2-currency').dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.querySelector('#borrow-find-positions').addEventListener('click', findBorrowPositions);
    document.querySelector('#borrow-position-search').addEventListener('input', renderBorrowPositions);
    document.querySelectorAll('[data-task-tab]').forEach((button) => {
      const activate = () => {
        const tabs = [...button.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
        for (const tab of tabs) {
          const selected = tab === button;
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
          document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
        }
      };
      button.addEventListener('click', activate);
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...button.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
        const index = tabs.indexOf(button);
        const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.click();
        next.focus();
      });
    });
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
      const routed = routeFromLocation();
      if (routed) showView(routed, false, routeFocus);
    });
    showView(routeFromLocation() ?? 'start', false, routeFocus);
  }

  init();
})();

(() => {
  'use strict';
  const form = document.querySelector('#position-form');
  const fields = ['project', 'token', 'currency', 'collateral', 'gross', 'reserve', 'fee'];
  const format = (value) => new Intl.NumberFormat('en', { maximumFractionDigits: 4 }).format(value);
  let currentPlan = null;
  let hooks;

  function values() {
    return Object.fromEntries(fields.map((name) => [name, form.elements.namedItem(name).value]));
  }

  function getPlan() {
    return window.IMF_PLANNING.legacyPlan(values());
  }

  function update() {
    currentPlan = null;
    const inputs = values();
    const result = window.IMF_PLANNING.estimate(inputs);
    const unit = ` K9${inputs.currency}`;
    const valid = Number.isFinite(result.net) && result.net >= 0 && Number(inputs.reserve) >= 0 && Number(inputs.fee) >= 0;
    document.querySelector('#net').textContent = valid ? format(result.net) + unit : 'Check inputs';
    for (const name of ['gross', 'reserve', 'fee']) document.querySelector(`#${name}-out`).textContent = Number.isFinite(result[name]) ? format(result[name]) + unit : '—';
    const percentages = [100 - Number(inputs.reserve) - Number(inputs.fee), Number(inputs.reserve), Number(inputs.fee)];
    for (const [index, name] of ['net', 'reserve', 'fee'].entries()) document.querySelector(`#app-${name}-fill`).style.width = valid ? `${percentages[index]}%` : '0%';
    document.querySelector('#app-allocation').setAttribute('aria-label', valid ? `${percentages[0]} percent spendable, ${percentages[1]} percent reserve, ${percentages[2]} percent fee` : 'Invalid teaching reserve and fee');
    document.querySelector('#app-chart-note').textContent = valid ? 'Illustrative allocation of the gross mint; not a V2 quote.' : 'Teaching reserve and fee must be nonnegative and total less than 100%.';
    hooks.onPlan();
  }

  function error(message = '') {
    const target = document.querySelector('#form-error');
    target.textContent = message;
    target.hidden = !message;
    if (message) target.focus();
  }

  function review(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    try {
      currentPlan = getPlan();
      error();
    } catch (cause) {
      error(cause.message);
      return;
    }
    const summary = document.querySelector('#review-summary');
    summary.replaceChildren();
    const rows = [
      ['Project', currentPlan.project],
      ['Collateral token', currentPlan.collateral.tokenAddress],
      ['Collateral quantity', currentPlan.collateral.amount],
      ['Currency', `K9${currentPlan.currency}`],
      ['Gross minted debt', `${currentPlan.illustrativeResult.gross} K9${currentPlan.currency}`],
      ['Illustrative net proceeds', `${currentPlan.illustrativeResult.net} K9${currentPlan.currency}`],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'metric';
      const name = document.createElement('span');
      name.textContent = label;
      const content = document.createElement('strong');
      content.textContent = value;
      row.append(name, content);
      summary.append(row);
    }
    document.querySelector('#acknowledge').checked = false;
    document.querySelector('#save-plan').disabled = true;
    document.querySelector('#export-plan').disabled = true;
    hooks.onView('review');
  }

  function load(plan) {
    const clean = window.IMF_PLANNING.validateLegacyPlan(plan);
    const restored = {
      project: clean.project,
      token: clean.collateral.tokenAddress,
      collateral: clean.collateral.amount,
      currency: clean.currency,
      gross: clean.assumptions.grossMint,
      reserve: clean.assumptions.reservePercent,
      fee: clean.assumptions.upfrontFeePercent,
    };
    for (const name of fields) form.elements.namedItem(name).value = restored[name];
    update();
    hooks.onView('offline');
    hooks.notify('Teaching draft loaded. Verify every input again; no V2 state was imported.');
  }

  function init(options) {
    hooks = options;
    form.addEventListener('input', update);
    form.addEventListener('submit', review);
    document.querySelector('#acknowledge').addEventListener('change', (event) => {
      document.querySelector('#save-plan').disabled = !event.target.checked;
      document.querySelector('#export-plan').disabled = !event.target.checked;
    });
    document.querySelector('#save-plan').addEventListener('click', () => {
      if (!currentPlan || document.querySelector('#acknowledge').checked !== true) return;
      try {
        hooks.store.save(currentPlan);
        document.querySelector('#save-plan').disabled = true;
        hooks.notify('Teaching draft saved on this app origin. No transaction was submitted.');
      } catch (cause) {
        hooks.notify(cause.message);
      }
    });
    document.querySelector('#export-plan').addEventListener('click', () => {
      if (!currentPlan || document.querySelector('#acknowledge').checked !== true) return;
      window.IMF_PLANNING.download(currentPlan, `imf-${currentPlan.currency.toLowerCase()}-position-plan.json`);
      hooks.notify('Legacy teaching plan exported. It contains no transaction authorization.');
    });
    document.querySelector('#edit-plan').addEventListener('click', () => hooks.onView('offline'));
    const file = document.querySelector('#legacy-plan-file');
    document.querySelector('#import-legacy-plan').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      try {
        const selected = file.files[0];
        if (!selected || selected.size > 1000000) throw new Error('Choose a JSON plan smaller than 1 MB');
        load(JSON.parse(await selected.text()));
      } catch (cause) {
        error(`Plan could not be imported: ${cause.message}`);
      } finally {
        file.value = '';
      }
    });
    update();
  }

  window.IMF_OFFLINE = { init, update, getPlan, load };
})();

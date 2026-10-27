(() => {
  'use strict';
  const currencies = window.IMF_CURRENCIES || [];
  const storySteps = [
    { tag: 'Step 1 · Collateral position', title: 'Collateral stays in the position.', copy: 'Your project proposes new terms or clones accepted terms where capacity and timing allow. Tokens deposited into the position secure its currency debt. They are not sold by the act of depositing.', guide: 'collateral', link: 'Explore collateral proposals', flow: '<span>Project treasury<small>Token allocation</small></span><b aria-hidden="true">→</b><span class="flow-lock">Collateral position<small>Locked tokens</small></span>' },
    { tag: 'Step 2 · Currency mint', title: 'Currency arrives. A debt is recorded.', copy: 'Mint within the position’s terms. Retained reserves and applicable fees mean spendable currency is lower than gross debt. The locked collateral remains in the position.', guide: 'borrowing-costs', link: 'Understand debt, reserve and fees', flow: '<span class="flow-lock">Collateral position<small>Tokens remain locked</small></span><b aria-hidden="true">→</b><span class="flow-currency">Project wallet<small>Net minted currency</small></span>' },
    { tag: 'Step 3 · DEX liquidity', title: 'Two assets meet in a separate pool.', copy: 'Pair currency from your wallet with a separate allocation of project tokens on a DEX such as Barkswap. The DEX liquidity position and the collateral position are distinct. Creating a pair does not repay the debt.', guide: 'liquidity', link: 'Follow the DEX liquidity workflow', flow: '<span>Additional tokens<small>Separate treasury allocation</small></span><b aria-hidden="true">+</b><span class="flow-currency">Minted currency<small>From your wallet</small></span><b aria-hidden="true">→</b><span class="flow-lock">DEX pair<small>LP position</small></span>' },
  ];

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function hydrateCurrencies() {
    const select = document.querySelector('#learn-currency');
    select.replaceChildren(...currencies.map(({ code, name, symbol }) => {
      const option = element('option', `${symbol} — ${name}`);
      option.value = code;
      return option;
    }));
    const strip = document.querySelector('.currency-list');
    strip.replaceChildren(...currencies.map(({ code, symbol }) => {
      const item = element('span', symbol);
      item.append(element('small', code));
      return item;
    }));
    const picker = document.querySelector('.currency-picker');
    picker.replaceChildren(...currencies.map(({ code, symbol }, index) => {
      const button = element('button', undefined, `currency-orb${index === 0 ? ' active' : ''}`);
      button.dataset.system = code;
      button.setAttribute('aria-pressed', String(index === 0));
      button.append(element('span', code), element('small', symbol));
      return button;
    }));
  }

  hydrateCurrencies();
  document.querySelectorAll('[data-story]').forEach((button) => button.addEventListener('click', () => {
    const step = storySteps[Number(button.dataset.story)];
    document.querySelectorAll('[data-story]').forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-pressed', String(active));
    });
    for (const key of ['tag', 'title', 'copy']) document.querySelector(`#story-${key}`).textContent = step[key];
    const link = document.querySelector('#story-link');
    link.href = window.IMF_LINKS.guide(step.guide);
    link.textContent = step.link;
    document.querySelector('#story-flow').innerHTML = step.flow;
  }));

  const number = (value) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
  function updateLearningModel() {
    const percent = Number(document.querySelector('#learn-debt').value);
    const currency = document.querySelector('#learn-currency').value;
    const gross = 100000 * percent / 100;
    const reserve = gross * 0.2;
    const fee = gross * 0.01;
    const net = gross - reserve - fee;
    const unit = ` K9${currency}`;
    document.querySelector('#learn-percent').textContent = `${percent}% of assumed value`;
    document.querySelector('#learn-collateral').textContent = `100,000 ${currency}`;
    document.querySelector('#chart-collateral').textContent = `100,000 ${currency}`;
    document.querySelector('#learn-ratio').textContent = `${number(100000 / gross * 100)}% illustrative collateral ratio`;
    document.querySelector('#chart-debt').textContent = number(gross) + unit;
    document.querySelector('#debt-fill').style.width = `${percent}%`;
    for (const [key, value] of Object.entries({ net, reserve, fee })) document.querySelector(`#learn-${key}`).textContent = number(value) + unit;
    document.querySelector('#learn-explanation').textContent = `A ${number(gross)} gross mint gives this example treasury ${number(net)} spendable currency units. The full gross mint is not the wallet balance.`;
    document.querySelector('#learn-plan').href = `${window.IMF_LINKS.url('app')}?currency=${currency}&gross=${gross}`;
  }
  document.querySelector('#learn-debt').addEventListener('input', updateLearningModel);
  document.querySelector('#learn-currency').addEventListener('change', updateLearningModel);

  document.querySelectorAll('[data-system]').forEach((button) => button.addEventListener('click', () => {
    const code = button.dataset.system;
    document.querySelectorAll('[data-system]').forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-pressed', String(active));
    });
    document.querySelector('#system-unit').textContent = `${code} system`;
    document.querySelector('#system-coin').textContent = `K9${code}`;
    document.querySelector('#system-savings').textContent = `K9${code} savings`;
    document.querySelector('#system-note').textContent = `${code} positions owe K9${code}. Selecting another currency explores another independent system; it does not convert debt or balances.`;
  }));
  updateLearningModel();
})();

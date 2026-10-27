const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');

class Element {
  constructor() {
    this.textContent = '';
    this.value = '';
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.classList = { toggle() {} };
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}
const elements = {};
const get = (selector) => elements[selector] ??= new Element();
get('#learn-debt').value = '50';
get('#learn-currency').value = 'USD';
const stories = [0, 1, 2].map((n) => {
  const element = new Element();
  element.dataset.story = String(n);
  return element;
});
const currencies = JSON.parse(fs.readFileSync('assets/currencies.json', 'utf8')).map(([code, name]) => ({ code, name, symbol: `K9${code}` }));
const origins = { website: 'http://website.local/', docs: 'http://docs.local/', app: 'http://app.local/' };
const context = {
  document: {
    querySelector: get,
    querySelectorAll: (selector) => selector === '[data-story]' ? stories : selector === '[data-system]' ? get('.currency-picker').children : [],
    createElement: () => new Element(),
  },
  window: {
    IMF_CURRENCIES: currencies,
    IMF_LINKS: {
      url: (surface, suffix = '') => new URL(suffix.replace(/^\//, ''), origins[surface]).href,
      guide: (id) => new URL(`guides/${encodeURIComponent(id)}/`, origins.docs).href,
    },
  },
  Intl,
  Number,
  Object,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('assets/explore.js', 'utf8'), context);
assert.equal(get('#learn-net').textContent, '39,500 K9USD');
assert.equal(get('#learn-ratio').textContent, '200% illustrative collateral ratio');
assert.equal(get('.currency-picker').children.length, 11);
assert.equal(get('.currency-list').children.length, 11);
for (const [percent, gross, net, ratio] of [[15, 15000, 11850, '666.7%'], [65, 65000, 51350, '153.8%']]) {
  get('#learn-debt').value = String(percent);
  get('#learn-debt').listeners.input();
  assert.equal(get('#chart-debt').textContent, new Intl.NumberFormat('en').format(gross) + ' K9USD');
  assert.equal(get('#learn-net').textContent, new Intl.NumberFormat('en').format(net) + ' K9USD');
  assert(get('#learn-ratio').textContent.startsWith(ratio));
  assert.equal(get('#debt-fill').style.width, `${percent}%`);
}
get('#learn-currency').value = 'JPY';
get('#learn-currency').listeners.change();
assert.equal(get('#learn-collateral').textContent, '100,000 JPY');
assert.equal(get('#learn-net').textContent, '51,350 K9JPY');
assert.equal(get('#learn-plan').href, 'http://app.local/?currency=JPY&gross=65000');
stories[2].listeners.click();
assert.equal(get('#story-title').textContent, 'Two assets meet in a separate pool.');
assert(get('#story-flow').innerHTML.includes('Separate treasury allocation'));
assert.equal(stories[2].attrs['aria-pressed'], 'true');
assert.equal(stories[0].attrs['aria-pressed'], 'false');
assert.equal(get('#story-link').href, 'http://docs.local/guides/liquidity/');
for (const system of get('.currency-picker').children) {
  system.listeners.click();
  assert.equal(get('#system-coin').textContent, `K9${system.dataset.system}`);
  assert.equal(system.attrs['aria-pressed'], 'true');
}
console.log('PASS: teaching-model bounds, exact example outputs, centralized currencies, app handoff, story and architecture interactions');

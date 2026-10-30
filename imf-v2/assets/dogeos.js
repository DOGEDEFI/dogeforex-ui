(() => {
  'use strict';
  const button = document.querySelector('#wallet-dogeos');
  const config = window.IMF_DOGEOS_CONFIG;
  if (!button || !config?.clientId) return;
  button.hidden = false;
  let loading = null;

  function loadWallet() {
    if (loading) return loading;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Loading wallet…';
    loading = new Promise((resolve, reject) => {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = window.IMF_LINKS.assets('dogeos-wallet.css');
      document.head.append(stylesheet);
      const script = document.createElement('script');
      script.src = window.IMF_LINKS.assets('dogeos-wallet.js');
      script.async = true;
      script.onload = () => {
        try {
          if (!window.IMF_DOGEOS_WALLET?.mount) throw new Error('DogeOS wallet island did not initialize.');
          window.IMF_DOGEOS_WALLET.mount();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      script.onerror = () => reject(new Error('DogeOS wallet could not be loaded. Try MetaMask directly or reload.'));
      document.body.append(script);
    }).catch((error) => {
      loading = null;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Connect wallet';
      const feedback = document.querySelector('#feedback');
      if (feedback) {
        feedback.textContent = error.message;
        feedback.hidden = false;
      }
    });
    return loading;
  }

  button.addEventListener('click', loadWallet);
})();

(() => {
  const TOAST_MS = 2000;

  function createToast({ log = () => {} } = {}) {
    let element = null;
    let hideTimer = null;

    function ensureElement() {
      if (element && element.isConnected) return element;
      element = document.createElement('div');
      element.setAttribute('data-ll-autoresume-toast', '');
      Object.assign(element.style, {
        position: 'fixed',
        bottom: '96px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        padding: '10px 16px',
        borderRadius: '8px',
        font: '500 14px/1.4 system-ui, -apple-system, sans-serif',
        color: '#fff',
        background: 'rgba(17, 17, 17, 0.92)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity 160ms ease',
      });
      document.body.appendChild(element);
      return element;
    }

    return {
      show(message, variant = 'info') {
        try {
          const node = ensureElement();
          node.textContent = message;
          node.style.background =
            variant === 'warn' ? 'rgba(140, 32, 32, 0.94)' : 'rgba(17, 17, 17, 0.92)';
          node.style.opacity = '1';
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            node.style.opacity = '0';
          }, TOAST_MS);
        } catch (error) {
          log('toast failed:', error && error.message);
        }
      },
    };
  }

  window.__llAutoResume = window.__llAutoResume || {};
  window.__llAutoResume.createToast = createToast;
  window.__llAutoResume.TOAST_MS = TOAST_MS;
})();

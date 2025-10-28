(function () {
  const qs = new URLSearchParams(location.search);
  const state = qs.get('state') || (qs.has('go') ? 'go' : (qs.has('success') ? 'success' : 'idle'));
  const wrap = document.getElementById('frameWrap');
  const fallback = document.getElementById('fallback');
  const msg = document.getElementById('statusMsg');
  const btnOpen = document.getElementById('fallbackBtn');
  const btnDone = document.getElementById('doneBtn');

  async function getConfig() {
    try {
      const r = await fetch('/api/public-config', { credentials: 'omit' });
      const j = await r.json();
      return j?.bookingUrl || '';
    } catch { return ''; }
  }

  function showFallback({ text, showOpen, showDone, openUrl }) {
    if (wrap) wrap.style.display = 'none';
    if (fallback) fallback.style.display = 'block';
    if (msg) msg.textContent = text || '';
    if (btnOpen) {
      btnOpen.style.display = showOpen ? 'inline-flex' : 'none';
      btnOpen.onclick = () => window.open(openUrl, '_blank', 'noopener,noreferrer');
    }
    if (btnDone) {
      btnDone.style.display = showDone ? 'inline-flex' : 'none';
      btnDone.onclick = () => location.assign('/agendar?success=1');
    }
  }

  (async function init() {
    const bookingUrl = await getConfig();

    if (!bookingUrl) {
      showFallback({
        text: 'No pudimos cargar la agenda. Inténtalo más tarde.',
        showOpen: false, showDone: false
      });
      return;
    }

    if (state === 'go') {
      showFallback({
        text: 'Abre la agenda en una pestaña nueva, programa tu cita y regresa aquí.',
        showOpen: true, showDone: true, openUrl: bookingUrl
      });
      try { window.open(bookingUrl, '_blank', 'noopener,noreferrer'); } catch {}
      return;
    }

    if (state === 'success') {
      showFallback({
        text: '✅ Tu cita quedó agendada. Te enviamos la confirmación por correo.',
        showOpen: false, showDone: false
      });
      return;
    }

    // Idle
    showFallback({
      text: 'Abre la agenda para programar tu cita.',
      showOpen: true, showDone: false, openUrl: bookingUrl
    });
  })();
})();

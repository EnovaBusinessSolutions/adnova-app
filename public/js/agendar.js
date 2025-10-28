(function () {
  // Leemos el BOOKING_URL desde una <meta> (evita inline script + respeta CSP)
  const meta = document.querySelector('meta[name="booking-url"]');
  const url = (meta && meta.content || '').trim();

  const frameWrap = document.getElementById('frameWrap');
  const fallback = document.getElementById('fallback');
  const fallbackBtn = document.getElementById('fallbackBtn');
  const frame = document.getElementById('bookingFrame');

  // Si no hay URL, muestra fallback y regresa a /bookcall
  if (!url) {
    frameWrap.style.display = 'none';
    fallback.style.display = 'block';
    if (fallbackBtn) fallbackBtn.onclick = () => (window.location.href = '/bookcall');
    console.warn('BOOKING_URL no configurado');
    return;
  }

  // Intento de embeber (Google lo suele bloquear por X-Frame-Options)
  frame.src = url;

  let loaded = false;
  const t = setTimeout(() => {
    if (!loaded) {
      frameWrap.style.display = 'none';
      fallback.style.display = 'block';
      if (fallbackBtn) fallbackBtn.onclick = () => (window.location.href = url); // abrir en la misma pestaña
    }
  }, 1500);

  frame.addEventListener('load', () => {
    loaded = true;
    clearTimeout(t);
  });
})();

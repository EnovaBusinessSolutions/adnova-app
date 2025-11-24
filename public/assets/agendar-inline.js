// public/assets/agendar-inline.js
// Escucha el evento de Calendly cuando se agenda la cita
// y muestra el mensaje de éxito en lugar del calendario.

(function () {
  /**
   * Muestra la tarjeta de éxito y oculta el calendario
   */
  function showSuccessCard() {
    var shell = document.querySelector('.frameShell');
    var ok = document.getElementById('agendado-ok');

    if (shell) shell.style.display = 'none';
    if (ok) ok.style.display = 'block';
  }

  /**
   * Si la URL ya viene con ?success=1 (por ejemplo al recargar),
   * mostramos directamente el mensaje de éxito.
   */
  try {
    var currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get('success') === '1') {
      showSuccessCard();
    }
  } catch (e) {
    // silencio: si falla URL no rompemos nada
  }

  /**
   * Escucha el mensaje que envía Calendly cuando se programa un evento.
   * https://developer.calendly.com/docs/webhooks-and-events
   */
  window.addEventListener('message', function (e) {
    if (!e || !e.data || e.data.event !== 'calendly.event_scheduled') {
      return;
    }

    // Cambia a la vista de "Cita agendada"
    showSuccessCard();

    // Limpia/actualiza la URL para que quede ?success=1
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('success', '1');
      window.history.replaceState({}, '', u);
    } catch (err) {
      // no pasa nada si falla, sólo es "cosmético"
    }
  });
})();

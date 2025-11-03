// public/assets/agendar-inline.js
(function () {
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.event === 'calendly.event_scheduled') {
      var shell = document.querySelector('.frameShell');
      var ok = document.getElementById('agendado-ok');
      if (shell) shell.style.display = 'none';
      if (ok) ok.style.display = 'block';
      // opcional: marcar success en la URL
      try {
        var u = new URL(location.href);
        u.searchParams.set('success', '1');
        history.replaceState({}, '', u);
      } catch (_) {}
    }
  });
})();

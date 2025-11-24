// public/assets/agendar-inline.js
(function () {
  // === 1) URL del evento (Agustín) + colores de marca (tema oscuro) ===
  const WIDGET_URL =
    "https://calendly.com/agustincorrea-adnova/adnova-ai" +
    "?utm_source=app&utm_campaign=adnova-ai" +
    "&background_color=0a0a0f&text_color=eaeaf0&primary_color=7c3aed";

  // Helpers
  const $ = (sel) => document.querySelector(sel);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  // Muestra/oculta estados
  function showSuccess() {
    const success = $("#agendado-ok");
    const shell = $(".frameShell");
    if (shell) shell.style.display = "none";
    if (success) success.style.display = "block";

    // Limpia/ajusta la URL (añade success=1 para persistir tras refresh)
    try {
      const u = new URL(location.href);
      u.searchParams.set("success", "1");
      history.replaceState({}, "", u);
    } catch {}
  }

  function showWidget() {
    const success = $("#agendado-ok");
    const shell = $(".frameShell");
    if (success) success.style.display = "none";
    if (shell) shell.style.display = "";
  }

  // Inicializa Calendly de forma determinística (evita data-url autoinit)
  function initCalendly() {
    const host = $(".calendly-inline-widget");
    if (!host || typeof window.Calendly === "undefined") return false;

    // Evita el autoinit basado en data-url y fuerza nuestra URL con colores
    host.removeAttribute("data-url");

    try {
      window.Calendly.initInlineWidget({
        url: WIDGET_URL,
        parentElement: host,
        prefill: {},
        utm: {}
      });
      return true;
    } catch {
      return false;
    }
  }

  // Escucha mensaje de Calendly cuando se agenda
  function listenCalendlyEvents() {
    on(window, "message", (e) => {
      // Acepta calendly.com (widget) y assets.calendly.com (algunos iframes)
      const okOrigin =
        e.origin === "https://calendly.com" ||
        e.origin === "https://assets.calendly.com";
      if (!okOrigin) return;

      let data = e.data;
      try {
        if (typeof data === "string") data = JSON.parse(data);
      } catch {
        // no-op
      }
      if (data && data.event === "calendly.event_scheduled") {
        showSuccess();
      }
    });
  }

  // Reintenta suave hasta que cargue widget.js (async) y renderiza
  function bootCalendlyWithRetry() {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (typeof window.Calendly !== "undefined") {
        clearInterval(t);
        initCalendly();
      } else if (tries > 50) {
        // ~5s, detén reintentos
        clearInterval(t);
      }
    }, 100);
  }

  // Si ya venía ?success=1 en la URL, muestra el estado de éxito
  function applySuccessFromURL() {
    try {
      const sp = new URL(location.href).searchParams;
      if (sp.get("success") === "1") {
        showSuccess();
        return true;
      }
    } catch {}
    return false;
  }

  // ==== Arranque ====
  on(document, "DOMContentLoaded", () => {
    const hasSuccess = applySuccessFromURL();
    if (!hasSuccess) {
      showWidget();
      bootCalendlyWithRetry();
    }
    listenCalendlyEvents();
  });
})();

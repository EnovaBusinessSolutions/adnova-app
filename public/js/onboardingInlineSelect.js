// public/js/onboardingInlineSelect.js

// --- helpers fetch JSON / POST
async function _json(u) {
  const r = await fetch(u, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function _post(u, b) {
  const r = await fetch(u, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b || {}),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// === hard limit por plataforma ===
const MAX_SELECT = 1;

// --- state
const ASM = {
  needs: {
    meta: false,
    googleAds: false,
    googleGa: false,
  },
  data: {
    meta: [],
    googleAds: [],
    googleGa: [],
  },
  sel: {
    meta: new Set(),
    googleAds: new Set(),
    googleGa: new Set(),
  },
  visible: {
    meta: false,
    google: false, // indica si se debe mostrar la parte de Google (Ads/GA)
  },
};

// --- UI utils
const _el = (id) => document.getElementById(id);
const _show = (el) => {
  if (el) {
    el.classList.remove("hidden");
    el.style.display = "";
  }
};
const _hide = (el) => {
  if (el) {
    el.classList.add("hidden");
    el.style.display = "none";
  }
};

// mapping por tipo
const KIND_CONFIG = {
  meta: {
    listId: "asm-meta-list",
    countId: "asm-meta-count",
  },
  googleAds: {
    listId: "asm-google-ads-list",
    countId: "asm-google-ads-count",
  },
  googleGa: {
    listId: "asm-google-ga-list",
    countId: "asm-google-ga-count",
  },
};

function _ensureHintNode() {
  let hint = _el("asm-hint");
  if (!hint) {
    const panel = _el("account-select-modal")?.querySelector(".asm-panel");
    if (panel) {
      hint = document.createElement("div");
      hint.id = "asm-hint";
      hint.style.margin = "8px 0 0";
      hint.style.fontSize = ".9rem";
      hint.style.opacity = "0.85";
      panel.insertBefore(hint, panel.querySelector(".asm-footer"));
    }
  }
  return hint;
}
function _hint(text, type = "info") {
  const box = _ensureHintNode();
  if (!box) return;
  box.textContent = text || "";
  box.style.color =
    type === "warn"
      ? "#f59e0b"
      : type === "error"
      ? "#ef4444"
      : "#a1a1aa";
  text ? _show(box) : _hide(box);
}

function _enableSave(enabled) {
  const btn = _el("asm-save");
  if (!btn) return;
  btn.disabled = !enabled;
  btn.classList.toggle("asm-btn-primary--disabled", !enabled);
}

function _canSave() {
  const needsM = ASM.visible.meta && ASM.needs.meta;
  const needsAds = ASM.visible.google && ASM.needs.googleAds;
  const needsGa = ASM.visible.google && ASM.needs.googleGa;

  if (needsM && ASM.sel.meta.size === 0) return false;
  if (needsAds && ASM.sel.googleAds.size === 0) return false;
  if (needsGa && ASM.sel.googleGa.size === 0) return false;
  return true;
}

function _updateCount(kind) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) return;
  const span = _el(cfg.countId);
  if (span) span.textContent = `${ASM.sel[kind].size}/${MAX_SELECT}`;
}

function _updateLimitUI(kind) {
  const set = ASM.sel[kind];
  const reached = set.size >= MAX_SELECT;

  const cfg = KIND_CONFIG[kind];
  if (!cfg) return;
  const list = _el(cfg.listId);
  if (!list) return;

  list.querySelectorAll('input[type="checkbox"]').forEach((ch) => {
    if (set.has(ch.value)) ch.disabled = false;
    else ch.disabled = reached;
  });

  _updateCount(kind);

  if (reached) {
    _hint(
      `Límite alcanzado: solo puedes seleccionar ${MAX_SELECT} cuenta.`,
      "warn"
    );
  } else {
    _hint("Selecciona hasta 1 cuenta por plataforma.", "info");
  }

  _enableSave(_canSave());
}

function _chip(label, value, kind, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "asm-chip";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.value = value;

  cb.addEventListener("change", () => onChange(!!cb.checked, value, kind, cb));

  wrap.appendChild(cb);
  wrap.appendChild(document.createTextNode(" " + label));
  return wrap;
}

/** Notificar selección de cuentas de Google Ads al script principal (onboarding.js) */
function _notifyGoogleAdsSelection(ids) {
  try {
    window.dispatchEvent(
      new CustomEvent("googleAccountsSelected", {
        detail: { accountIds: ids },
      })
    );
  } catch (e) {
    console.error("Error dispatching googleAccountsSelected", e);
  }
}

function _renderLists() {
  const err = _el("asm-error");
  if (err) {
    err.textContent = "";
    _hide(err);
  }
  _hint("Selecciona hasta 1 cuenta por plataforma.", "info");

  // META
  const metaTitle = _el("asm-meta-title");
  const metaList = _el("asm-meta-list");

  if (ASM.visible.meta && ASM.needs.meta && ASM.data.meta.length > 0) {
    _show(metaTitle);
    _show(metaList);
    metaList.innerHTML = "";
    ASM.data.meta.forEach((a) => {
      const id = String(a.id || a.account_id || "").replace(/^act_/, "");
      const label = a.name || a.account_name || id;
      const chip = _chip(label, id, "meta", (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) {
            cbEl.checked = false;
            return _hint(
              `Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`,
              "warn"
            );
          }
          set.add(val);
        } else set.delete(val);
        _updateLimitUI(kind);
      });
      metaList.appendChild(chip);
    });
    _updateLimitUI("meta");
  } else {
    _hide(metaTitle);
    _hide(metaList);
  }

  // GOOGLE ADS
  const gAdsTitle = _el("asm-google-ads-title");
  const gAdsList = _el("asm-google-ads-list");

  if (ASM.visible.google && ASM.data.googleAds.length > 0) {
    _show(gAdsTitle);
    _show(gAdsList);
    gAdsList.innerHTML = "";
    ASM.data.googleAds.forEach((a) => {
      const id = String(a.id || "").replace(/-/g, "").trim();
      const label =
        a.name || a.descriptiveName || a.descriptive_name || `Cuenta ${id}`;
      const chip = _chip(label, id, "googleAds", (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) {
            cbEl.checked = false;
            return _hint(
              `Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`,
              "warn"
            );
          }
          set.add(val);
        } else set.delete(val);
        _updateLimitUI(kind);
      });
      gAdsList.appendChild(chip);
    });
    _updateLimitUI("googleAds");
  } else {
    _hide(gAdsTitle);
    _hide(gAdsList);
  }

  // GOOGLE ANALYTICS (GA4)
  const gGaTitle = _el("asm-google-ga-title");
  const gGaList = _el("asm-google-ga-list");

  if (ASM.visible.google && ASM.data.googleGa.length > 0) {
    _show(gGaTitle);
    _show(gGaList);
    gGaList.innerHTML = "";
    ASM.data.googleGa.forEach((p) => {
      const id = String(p.id || p.propertyId || p.property_id || "").trim();
      const label = p.name || p.displayName || p.display_name || id;
      const chip = _chip(label, id, "googleGa", (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) {
            cbEl.checked = false;
            return _hint(
              `Solo puedes seleccionar hasta ${MAX_SELECT} propiedad.`,
              "warn"
            );
          }
          set.add(val);
        } else set.delete(val);
        _updateLimitUI(kind);
      });
      gGaList.appendChild(chip);
    });
    _updateLimitUI("googleGa");
  } else {
    _hide(gGaTitle);
    _hide(gGaList);
  }

  _enableSave(_canSave());
}

async function _openModal() {
  _renderLists();
  _show(_el("account-select-modal"));

  const saveBtn = _el("asm-save");
  saveBtn.textContent = "Guardar y continuar";
  saveBtn.disabled = !_canSave();

  saveBtn.onclick = async () => {
    if (!_canSave()) return;
    saveBtn.textContent = "Guardando…";
    saveBtn.disabled = true;

    try {
      const tasks = [];

      // META: se sigue guardando aquí
      if (ASM.visible.meta && ASM.needs.meta) {
        const ids = Array.from(ASM.sel.meta).slice(0, MAX_SELECT);
        tasks.push(_post("/api/meta/accounts/selection", { accountIds: ids }));
      }

      // GOOGLE ADS: notificar a onboarding.js (ahí se hace el selftest y la marca de conectado)
      if (ASM.visible.google && ASM.needs.googleAds) {
        const idsAds = Array.from(ASM.sel.googleAds).slice(0, MAX_SELECT);
        if (idsAds.length) {
          _notifyGoogleAdsSelection(idsAds);
        }
      }

      // GOOGLE GA4: guardar propiedad por defecto
      if (ASM.visible.google && ASM.needs.googleGa) {
        const idsGa = Array.from(ASM.sel.googleGa).slice(0, MAX_SELECT);
        if (idsGa.length) {
          tasks.push(
            _post("/auth/google/default-property", {
              propertyId: idsGa[0],
            })
          );
        }
      }

      await Promise.all(tasks);

      if (ASM.visible.meta) {
        sessionStorage.setItem("metaConnected", "true");
      }
      // googleConnected se marca dentro de onboarding.js (markGoogleConnected)

      _hide(_el("account-select-modal"));
      window.dispatchEvent(new CustomEvent("adnova:accounts-selection-saved"));
    } catch (e) {
      console.error("save selection error", e);
      const box = _el("asm-error");
      if (box) {
        box.textContent =
          "Ocurrió un error guardando tu selección. Intenta de nuevo.";
        _show(box);
      }
      _hint("", "info");
      saveBtn.textContent = "Guardar y continuar";
      _enableSave(true);
    }
  };
}

async function _maybeOpenSelectionModal() {
  // ¿Desde qué OAuth venimos?
  const url = new URL(location.href);
  const fromMeta = url.searchParams.has("meta");
  const fromGoogle = url.searchParams.has("google");

  const metaAlready = sessionStorage.getItem("metaConnected") === "true";
  const googAlready = sessionStorage.getItem("googleConnected") === "true";

  ASM.visible.meta = fromMeta && !metaAlready;
  ASM.visible.google = fromGoogle && !googAlready;

  if (!ASM.visible.meta && !ASM.visible.google) return;

  const promises = [];

  // META
  if (ASM.visible.meta) {
    promises.push(
      _json("/api/meta/accounts").then((v) => {
        ASM.data.meta = (v.accounts || v.ad_accounts || []).map((a) => ({
          ...a,
          id: String(a.id || a.account_id || "").replace(/^act_/, ""),
          name: a.name || a.account_name || null,
        }));
        ASM.needs.meta = ASM.data.meta.length > 1;
        if (!ASM.needs.meta && ASM.data.meta.length) {
          const ids = ASM.data.meta.map((a) => a.id).slice(0, MAX_SELECT);
          return _post("/api/meta/accounts/selection", { accountIds: ids })
            .then(() => sessionStorage.setItem("metaConnected", "true"))
            .catch(() => {});
        }
      })
    );
  }

  // GOOGLE (Ads + GA4)
  if (ASM.visible.google) {
    promises.push(
      Promise.all([
        _json("/api/google/ads/insights/accounts"),
        _json("/auth/google/status"),
      ]).then(([adsRes, status]) => {
        // Ads
        ASM.data.googleAds = (adsRes.accounts || []).map((a) => ({
          ...a,
          id: String(a.id || "").replace(/-/g, "").trim(),
          name:
            a.name || a.descriptiveName || a.descriptive_name || a.id || null,
        }));

        // GA4
        const gaProps = Array.isArray(status.gaProperties)
          ? status.gaProperties
          : [];
        ASM.data.googleGa = gaProps.map((p) => ({
          id: String(
            p.propertyId || p.property_id || p.name || ""
          ).trim(),
          name:
            p.displayName ||
            p.display_name ||
            p.propertyId ||
            p.name ||
            "",
        }));

        const adsCount = ASM.data.googleAds.length;
        const gaCount = ASM.data.googleGa.length;

        ASM.needs.googleAds = adsCount > 1;
        ASM.needs.googleGa = gaCount > 1;

        // Autoselección si solo hay 1 Ads
        if (!ASM.needs.googleAds && adsCount === 1) {
          const id = ASM.data.googleAds[0].id;
          ASM.sel.googleAds.add(id);
          _notifyGoogleAdsSelection([id]);
        }

        // Autoselección si solo hay 1 GA property
        if (!ASM.needs.googleGa && gaCount === 1) {
          const pid = ASM.data.googleGa[0].id;
          ASM.sel.googleGa.add(pid);
          _post("/auth/google/default-property", { propertyId: pid }).catch(
            () => {}
          );
        }
      })
    );
  }

  await Promise.allSettled(promises);

  const needModalMeta = ASM.visible.meta && ASM.needs.meta;
  const needModalGoogle =
    ASM.visible.google && (ASM.needs.googleAds || ASM.needs.googleGa);

  if (needModalMeta || needModalGoogle) {
    await _openModal();
  }
}

// Hook: cuando volvemos del OAuth (query ?meta=ok u ?google=ok)
document.addEventListener("DOMContentLoaded", () => {
  const url = new URL(location.href);
  const cameFromMeta = url.searchParams.has("meta");
  const cameFromGoogle = url.searchParams.has("google");
  if (cameFromMeta || cameFromGoogle) {
    _maybeOpenSelectionModal().catch(console.error);
  }
});

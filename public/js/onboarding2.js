// public/js/onboarding2.js
// Si necesitas apiFetch aquí, puedes importarlo como en tu otro archivo:
// import { apiFetch } from './apiFetch.saas.js';

function showEl(el) {
  if (!el) return;
  el.classList.remove('hidden');
  el.removeAttribute('aria-hidden');
  el.style.display = el.classList.contains('content-panel') ? 'flex' : 'block';
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  if (!el.style.position) el.style.position = 'relative';
  el.style.zIndex = '3';
}
function hideEl(el) {
  if (!el) return;
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
  el.style.display = 'none';
  el.style.visibility = 'hidden';
  el.style.opacity = '0';
  el.style.zIndex = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const $root = document.getElementById('onboarding') || document;

  const s1 = document.getElementById('step1-content');
  const s2 = document.getElementById('step2-content');

  const backBtn2 = document.getElementById('back-btn-2');
  const continueBtn2 = document.getElementById('continue-btn-2');

  // Sidebar: ilumina el paso 2
  $root.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  $root.querySelector('.step[data-step="2"]')?.classList.add('active');

  // Mostrar paso 2 y ocultar paso 1
  showEl(s2);
  hideEl(s1);

  // Navegación
  backBtn2?.addEventListener('click', () => {
    // Vuelve al onboarding original en paso 1 (ajusta la ruta si es distinta)
    window.location.href = '/onboarding.html#step=1';
  });

  continueBtn2?.addEventListener('click', () => {
    // Avanza al siguiente paso/página
    window.location.href = '/onboarding3.html';
  });

  // (Opcional) Si alguien entra con hash, respétalo, pero por defecto nos quedamos en 2
  if (location.hash && /step=1/.test(location.hash)) {
    // Si quieres permitir ver el paso 1 dentro de esta misma página:
    $root.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    $root.querySelector('.step[data-step="1"]')?.classList.add('active');
    showEl(s1); hideEl(s2);
  } else {
    // Fuerza hash consistente
    if (location.hash !== '#step=2') location.hash = '#step=2';
  }
});

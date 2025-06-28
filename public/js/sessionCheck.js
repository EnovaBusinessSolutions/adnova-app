// public/js/sessionCheck.js

document.addEventListener('DOMContentLoaded', async function () {
  if (document.body.dataset.page !== 'dashboard') return;

  try {
    const res = await fetch('/api/session');
    if (!res.ok) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/';
    }
  } catch {
    window.location.href = '/';
  }
});

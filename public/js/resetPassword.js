/* public/js/resetPassword.js
   ————————————————————————————————
   • Valida token de la URL
   • Envía el cambio de contraseña
   • Maneja los botones “ojo” para mostrar/ocultar cada input
*/

document.addEventListener('DOMContentLoaded', () => {
  /* -------- 1.  Comprobamos que venga el token -------- */
  const url   = new URL(location.href);
  const token = url.searchParams.get('token');            // ?token=123…
  if (!token) {
    alert('Enlace inválido o incompleto');
    location.href = '/login';
    return;
  }

  /* -------- 2.  Referencias útiles -------- */
  const form = document.querySelector('#resetForm');
  const pwd1 = document.querySelector('#new-password');
  const pwd2 = document.querySelector('#confirm-password');

  /* -------- 3.  OJOS: toggle password -------- */
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const inputId = btn.getAttribute('data-input');     // new-password | confirm-password
      const input   = document.getElementById(inputId);
      if (!input) return;

      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';            // cambia tipo
      btn.classList.toggle('show', show);                 // cambia icono (CSS)
    });
  });

  /* -------- 4.  Enviar formulario -------- */
  form.addEventListener('submit', async e => {
    e.preventDefault();

    if (pwd1.value !== pwd2.value) {
      alert('Las contraseñas no coinciden');
      return;
    }

    try {
      const res  = await fetch('/api/reset-password', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ token, password: pwd1.value })
      });
      const json = await res.json();

      if (json.success) {
        alert('Contraseña actualizada. Inicia sesión con tu nueva contraseña.');
        location.href = '/login';
      } else {
        alert(json.message || 'El enlace ya expiró o es inválido');
      }
    } catch (err) {
      console.error(err);
      alert('Error de red. Intenta más tarde.');
    }
  });
});
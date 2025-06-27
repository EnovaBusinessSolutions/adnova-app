// public/js/apiFetch.interface.js
export async function apiFetch(path, options = {}) {
  // 1️⃣  lee el JWT que interface.js dejó en sessionStorage
  const token = sessionStorage.getItem('sessionToken');

  // 2️⃣  cabeceras por defecto
  options.headers = {
    ...(options.headers || {}),
    'Content-Type': 'application/json',
  };
  if (token) options.headers.Authorization = `Bearer ${token}`;

  // 3️⃣  llamada con la cookie de 1ª parte
  const res  = await fetch(path, {
    credentials: 'include',   // ⬅ importa para que mande la connect.sid
    ...options,
  });

  // 4️⃣  intenta parsear JSON; si no, devuelve texto plano
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { ok:false, status:res.status, raw:text }; }
}

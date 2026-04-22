Instrucciones para los otros 2 developers

  Crean un archivo setup-dev.md mental con esto (o pegáselos por Slack). Asumen Windows + bash/git bash o macOS.

  1. Clonar y ramear

  git clone git@github.com:<org>/adnova-app.git
  cd adnova-app
  git checkout german/dev

  2. Pedirte el .env

  .env está en gitignore. Compartíselo por un canal seguro (1Password, Bitwarden, Vault) con estos campos ajustados para localhost — no  
  les mandes el .env de staging tal cual:

  APP_URL=http://localhost:3000
  PORT=3000
  NODE_ENV=development

  # OAuth callbacks apuntando a localhost
  GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/login/callback
  GOOGLE_LOGIN_CALLBACK_URL=http://localhost:3000/auth/google/login/callback
  GOOGLE_CONNECT_CALLBACK_URL=http://localhost:3000/auth/google/connect/callback
  GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/connect/callback
  FACEBOOK_REDIRECT_URI=http://localhost:3000/auth/meta/callback
  META_REDIRECT_URI=http://localhost:3000/auth/meta/callback
  SHOPIFY_REDIRECT_URI=http://localhost:3000/connector/auth/callback
  SHOPIFY_SAAS_REDIRECT_URI=http://localhost:3000/api/shopify/callback

  # Evita que el worker mate el backend si no hay Redis local
  RECORDING_WORKER_INLINE=false

  # ⚠️ ENCRYPTION_KEY: cada dev debe generar la suya y mantenerla estable
  # Generá una con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ENCRYPTION_KEY=<32-byte hex por dev>

  El resto del .env (DATABASE_URL de Neon, MONGO_URI, API keys de Stripe/OpenAI/Resend/Facturapi, secrets de Shopify/Meta/Google) se     
  comparte tal cual.

  ▎ Si quieren ambiente aislado, cada dev puede crear una DB propia en Neon y su propio cluster Mongo gratis. Para empezar a navegar dev,  ▎  compartir los de staging está bien.

  3. Agregar sus URIs a las consolas

  Ya agregaste localhost en Google Cloud, pero el OAuth client es compartido, así que sirve para los tres. Si quieren hacer login con    
  Google en localhost, no necesitan agregar nada más — los redirect URIs ya están.

  Mismo tema con Meta, Shopify, Stripe: si ya registraste http://localhost:3000/... en cada consola, los tres devs los reusan. Decíles   
  qué está registrado para que no tengan dudas.

  Lo único por dev: si alguien usa ngrok/Cloudflare tunnel en vez de localhost plano, su URL única tiene que agregarse a Meta y Shopify  
  (Google permite localhost sin HTTPS).

  4. Instalar dependencias

  # En la raíz del repo
  npm install
  npm run prisma:generate

  # Dashboard (workspace independiente)
  cd dashboard-src && npm install && cd ..

  Versiones requeridas (sacadas del package-lock):
  - Node 20+ (yo estoy en v24, ambas andan)
  - npm 10+

  5. Arrancar

  En dos terminales:
  # Terminal 1 — backend
  npm start                   # :3000

  # Terminal 2 — dashboard
  cd dashboard-src && npm run dev    # :8080

  Abrir http://localhost:8080/ en el navegador y loguearse con Google.

  6. Checklist de "funciona"

  - curl http://localhost:3000/adray-pixel.js → devuelve JS (200)
  - curl http://localhost:8080/api/public-config → 401 con {"error":"No hay sesión"} (eso prueba que el proxy Vite→Express anda)
  - Logs del backend muestran ✓ Servidor corriendo en http://localhost:3000, ✓ Conectado a PostgreSQL, ✓ Conectado a MongoDB Atlas       

  7. Gotchas conocidas

  - No dejes .env con URLs de localhost en Render — rompe OAuth en staging.
  - Warnings tipo REDIS_URL not provided, GOOGLE_CREDENTIALS no es JSON válido, duplicados de índices Mongoose: esperables en dev, no    
  bloquean nada.
  - Si tienen instalado Redis local y quieren probar el worker MCP: setx REDIS_URL redis://localhost:6379 y quitar
  RECORDING_WORKER_INLINE=false.
  - Si arrancás en un puerto distinto, ajustá todas las *_CALLBACK_URL/REDIRECT_URI — el proxy Vite también (en
  dashboard-src/vite.config.ts).

  8. Flujo de trabajo (según CLAUDE.md)

  feature branch → german/dev → main
  PRs siempre contra main. Nunca pushear directo a main.
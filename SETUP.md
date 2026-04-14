# Inicialización del repositorio adnova-app

Guía para clonar e inicializar el proyecto desde cero.

## 1. Clonar el repositorio

```bash
git clone https://github.com/EnovaBusinessSolutions/adnova-app.git
cd adnova-app
```

## 2. Instalar dependencias

```bash
# Backend (raíz)
npm install

# Dashboard
cd dashboard-src && npm install && cd ..

# Landing
cd landing-adray && npm install && cd ..
```

## 3. Configurar variables de entorno

```bash
cp .env.example .env
# Llenar los valores en .env
```

## 4. Generar Prisma client

```bash
npm run prisma:generate
```

## 5. Correr en desarrollo

```bash
npm run dev
```

Esto levanta:
- Backend con hot reload (nodemon) en `localhost:3000`
- Dashboard dev server en `localhost:5173`
- Landing dev server

## 6. Build para producción

```bash
npm run build
```

## Estructura del proyecto

| Directorio | Descripción |
|---|---|
| `backend/` | API Express + servicios + jobs |
| `dashboard-src/` | Dashboard React+Vite (antes submodulo) |
| `landing-adray/` | Landing page (antes submodulo) |
| `bookcall-src/` | Página de booking (antes submodulo) |
| `support-src/` | Página de soporte (antes submodulo) |
| `saas-landing/` | Landing SaaS legacy (antes submodulo) |
| `login-src/` | Login Vite+TS |
| `frontend/` | Widget connector |
| `public/` | Assets estáticos y builds compilados |

## Branching

```
main              ← producción
  └─ german/dev   ← staging
       ├─ santiago/dev
       ├─ jose/dev
       └─ german/feature
```

- PR de branch personal → `german/dev` (staging)
- PR de `german/dev` → `main` (producción)

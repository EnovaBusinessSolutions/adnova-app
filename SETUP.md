# Inicialización del repositorio adnova-app

Guía para clonar e iniciar el proyecto sin submódulos.

## 1. Clonar el repositorio

```bash
git clone https://github.com/EnovaBusinessSolutions/adnova-app.git
cd adnova-app
```

## 2. Instalar dependencias

```bash
npm install
npm --prefix dashboard-src install
npm --prefix landing-adray install
```

Instala dependencias adicionales solo si vas a trabajar en esas apps:

```bash
npm --prefix bookcall-src install
npm --prefix support-src install
```

## 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Completa los valores necesarios antes de correr el backend.

## 4. Generar Prisma Client

```bash
npm run prisma:generate
```

## 5. Ejecutar builds locales

```bash
npm run build:landing
npm run build:dashboard
```

## 6. Estructura del proyecto

| Directorio | Descripción |
|---|---|
| `backend/` | API Express, servicios y jobs |
| `dashboard-src/` | Dashboard React + Vite |
| `landing-adray/` | Landing principal |
| `bookcall-src/` | Página de booking |
| `support-src/` | Página de soporte |
| `login-src/` | Login Vite + TS |
| `frontend/` | Widget connector |
| `public/` | Assets estáticos y builds compilados |

## 7. Actualizar el repositorio

```bash
git pull
```

No se requiere `git submodule update`.

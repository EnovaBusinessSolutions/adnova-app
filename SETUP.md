# Inicialización del repositorio adnova-app

Guía para clonar e inicializar el proyecto desde cero.

## 1. Clonar el repositorio principal

```bash
git clone https://github.com/EnovaBusinessSolutions/adnova-app.git
cd adnova-app
```

## 2. Inicializar todos los submódulos

```bash
git submodule update --init --recursive
```

**Nota:** Si el submódulo `plan-src` falla con `Repository not found`, es porque ese repositorio no existe o no tienes acceso. Puedes continuar con el resto; los demás submódulos se clonarán correctamente.

## 3. Si las carpetas de submódulos aparecen vacías

A veces los submódulos se inicializan pero el directorio de trabajo queda vacío (archivos marcados como eliminados). Para restaurarlos, ejecuta en cada submódulo:

```bash
# bookcall-src
cd bookcall-src
git reset --hard HEAD
cd ..

# dashboard-src
cd dashboard-src
git reset --hard HEAD
cd ..

# saas-landing
cd saas-landing
git reset --hard HEAD
cd ..

# support-src
cd support-src
git reset --hard HEAD
cd ..
```

O en PowerShell, de una vez:

```powershell
foreach ($sub in @("bookcall-src", "dashboard-src", "saas-landing", "support-src")) {
    Push-Location $sub
    git reset --hard HEAD
    Pop-Location
}
```

## 4. Submódulos del proyecto

| Submódulo    | URL | Notas |
|--------------|-----|-------|
| saas-landing | https://github.com/EnovaBusinessSolutions/landingpagesaas-html.git | |
| dashboard-src | https://github.com/EnovaBusinessSolutions/adnova-ai-dashboard-full.git | |
| support-src | https://github.com/EnovaBusinessSolutions/adnova-ai-support | |
| bookcall-src | https://github.com/EnovaBusinessSolutions/bookcall-adnova.git | |
| plan-src | https://github.com/EnovaBusinessSolutions/adnova-plan-zen-1.git | ⚠️ Repo no accesible actualmente |

## 5. Obtener últimas actualizaciones

Cuando el proyecto ya esté clonado y quieras traer los últimos cambios:

```bash
# Repo principal
git pull

# Todos los submódulos (a la versión registrada en el padre)
git submodule update --init --recursive

# O últimas versiones de cada submódulo
git submodule update --remote --merge
```

## 6. Verificar estado de submódulos

```bash
git submodule status
```

- ` ` (espacio): submódulo en la versión esperada
- `-`: submódulo no inicializado
- `+`: submódulo en un commit distinto al registrado en el padre

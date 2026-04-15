
# ADNOVA - Flujo de Onboarding

Este proyecto contiene un flujo de onboarding progresivo para ADNOVA, una plataforma de optimización de marketing con IA para tiendas Shopify.

## Contenido

- `onboarding.html`: Página principal con la estructura del flujo de onboarding
- `onboarding.css`: Estilos completos para la página de onboarding

## Características

- Diseño moderno con tema oscuro y gradient accents
- Barra lateral con indicadores de progreso
- Flujo de onboarding de 4 pasos progresivos
- Conexión de plataformas (Shopify, Google, Meta)
- Revisión de permisos
- Simulación de análisis con animaciones
- Diseño totalmente responsive
- Tipografía Inter de Google Fonts

## Estructura

El flujo de onboarding incluye 4 pasos principales:

1. **Connect your accounts**: Permite conectar tienda Shopify (requerido) y plataformas opcionales.
2. **Review permissions**: Muestra los permisos necesarios para la aplicación.
3. **Analysis**: Simula un análisis de datos con barra de progreso animada.
4. **Dashboard**: Pantalla final con mensaje de éxito y botón para acceder al dashboard.

## Cómo integrar

1. Incluye los archivos en tu proyecto:
   ```
   - onboarding.html
   - onboarding.css
   ```

2. Asegúrate de tener acceso a Internet para cargar la fuente Inter de Google Fonts.

3. Para integrarlo en un proyecto existente:
   - Copia el HTML dentro de tu estructura de página
   - Incluye los estilos CSS en tu archivo de estilos o cárgalos por separado
   - Adapta los scripts JavaScript según sea necesario

4. Personalización:
   - Modifica los colores en el archivo CSS para adaptarlos a tu marca
   - Actualiza los iconos y logos según tus necesidades
   - Ajusta las redirecciones en el script JavaScript

## Requisitos técnicos

- Navegador web moderno (Chrome, Firefox, Safari, Edge)
- Conexión a Internet (para cargar la fuente Inter de Google Fonts)

## Notas de implementación

- La redirección al dashboard está configurada a `dashboard.html`. Cambia esta ruta según sea necesario para tu proyecto.
- Todos los botones "Connect" son funcionales y cambian de estado al hacer clic.
- El botón "Continue" del primer paso se activa solo después de conectar Shopify.
- La simulación del análisis es automática y puede ajustarse modificando los tiempos en el script JavaScript.

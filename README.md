# Vitalis

Asistente de ventas de la mesa **Team Matías** · **https://vitaliscrm.netlify.app**: ventas (FTDs) y clientes new compartidos en la mesa, conversión del día, la semana y el mes, snippets con `/atajo`, una sección social (pedir un mate, salir a los 10 o a la media) y sueldo, agenda, turnos y faltas privados de cada agente. Viene con una extensión de Chrome para los avisos, el CRM y los snippets. Se llama así por Vitalis, excompañero de la mesa que siempre cebaba mates (de ahí el logo: un mate torpedo de cuero).

## Cómo está armado

| Carpeta | Qué hay |
|---|---|
| `site/` | Lo que se publica (Netlify la sirve tal cual). **No se edita a mano**: se arma con `python3 app/build.py`. |
| `app/src/` | El código de la app: `core.js` (datos, sueldo, estadísticas), `ui.js`, `actions.js`, `views.js`, `social.js` (pedidos y avisos sociales), `auth.js` (entrada con nombre + PIN), `style.css`, `body.html` (incluye el logo del mate en SVG). |
| `app/fonts/` | Bricolage Grotesque y Figtree (licencia OFL), servidas desde el sitio. |
| `app/config.json` | URL y clave **publishable** de Supabase (son públicas; los datos los protegen las reglas RLS). |
| `extension/` | Extensión de Chrome (Manifest V3). Se empaqueta sola en `site/vitalis-extension.zip`. |
| `supabase/vitalis.sql` | Tablas, reglas de acceso (RLS), la lista de la mesa y el ingreso con PIN. Se puede volver a correr sin borrar datos. |
| `test/` | Pruebas: `sql.test.mjs` (permisos con Postgres local), `server.mjs` (Supabase de prueba), `e2e.py` (la app entera con Chrome) y `e2e_ext.py` (la extensión). |

## Publicar un cambio

1. Editar `app/src/` (o `extension/`).
2. `python3 app/build.py`
3. Commit y push a `main`: Netlify publica `site/` en menos de un minuto.
4. Si cambió `supabase/vitalis.sql`, aplicarlo en el proyecto de Supabase (con el conector de Supabase o en SQL Editor → Run) justo después del push.

## Datos

- **Compartido en la mesa:** `sales` y `leads` (todos leen; cada uno edita lo suyo; team leader y admin cargan y corrigen las de cualquiera), `snippets` marcados como compartidos.
- **Team leader:** carga ventas a nombre de cualquiera de la mesa (Trade24Seven y Novara Markets): a mano eligiendo el vendedor, por CSV o desde el CRM con la extensión, según la columna de agente o eligiendo a alguien en "De". "Nombre en el CRM" (`profiles.crm_name`) ayuda a reconocer a cada uno.
- **Social:** `pings` (mate, salir a los 10, a la media, mensaje corto), para toda la mesa o para alguien. Cooldown en la base (mate 20 min, salidas 3 min, mensajes 15 s), la primera respuesta gana, se borran a los 7 días. Silenciar: `profiles.quiet_until`.
- **Privado:** `settings`, `adjustments`, `agenda`, `shifts`, snippets propios.
- **Entrada:** es para una sola mesa: nombre → PIN. La primera vez el PIN es 0000 y se crea uno propio. Los PIN están en `pins` (nadie los lee desde la app); `pin_login` da una contraseña interna que cambia en cada ingreso. 5 errores seguidos bloquean 15 minutos, y cada bloqueo siguiente dura el doble (hasta 24 h). Registrarse con email está cerrado.
- **Roles:** `admin` (el primero que crea su PIN), `leader`, `agent`. Solo el admin cambia roles, suma gente, resetea PINs y da de baja.
- No subir nunca la clave **secret / service_role** de Supabase.

## Pruebas

```bash
cd test && npm install
node sql.test.mjs          # permisos, PIN y RLS
node server.mjs 54321      # Supabase de prueba en http://localhost:54321 (sirve site/)
python3 e2e.py             # la app entera con Chrome headless (capturas en test/shots/)
python3 e2e_ext.py         # la extensión: snippets, clientes new y ventas del CRM, avisos sociales
```

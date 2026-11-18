# Vitalis — instrucciones para trabajar en este repo

Vitalis es el asistente de ventas de la mesa **Team Matías** (12 agentes + 1 team leader). El nombre es por un excompañero que siempre cebaba mates: el logo es un mate torpedo color cuero. El dueño pide cambios en español rioplatense; las respuestas y los textos de la app van en ese mismo español, cortos y sin explicaciones de más (la ayuda vive en el modal `?`). Estética: moderna, con onda; "vitalis" en minúscula y bold; Bricolage Grotesque + Figtree; verde yerba, cuero y celeste; claro/oscuro.

## Flujo de cada cambio
1. Editar `app/src/*` (app) o `extension/*` (extensión de Chrome). **Nunca** editar `site/` a mano.
2. `python3 app/build.py` → regenera `site/` (incluye `site/vitalis-extension.zip`).
3. Probar (ver abajo). Si se tocó la extensión, subir `version` en `extension/manifest.json`.
4. Commit y `git push` a `main`: Netlify (proyecto `vitaliscrm`) publica `site/` en https://vitaliscrm.netlify.app en menos de un minuto.
5. Si cambió `supabase/vitalis.sql`, aplicarlo con el conector de Supabase (`apply_migration` en el proyecto `vitalis`, exmxdkiqodxjqkhdykpj) justo después del push y verificarlo (es re-ejecutable; no borra datos). Sin conector, el dueño lo pega en SQL Editor → Run.

## Pruebas
- `cd test && npm install && node sql.test.mjs` — permisos/RLS con Postgres local (PGlite). Tienen que pasar todas.
- `node test/server.mjs 54321` — Supabase de prueba (PostgREST + RPC + auth mínimos sobre PGlite, con el mismo SQL) que además sirve `site/`. Todos entran con PIN 0000.
- `cd test && python3 e2e.py` (app entera) y `python3 e2e_ext.py` (extensión) con Playwright + Chrome headless. Mirar las capturas de `test/shots/` después de cambios visuales.
- La red del entorno no llega a `*.supabase.co`: no se puede probar contra la base real.

## Datos y reglas
- Ventas (`sales`) compartidas en la mesa; `settings`, `adjustments`, `agenda`, `shifts` privados de cada uno.
- `leads` (clientes new, compartidos en la mesa) y `snippets` (propios o compartidos).
- Una sola mesa. Entrada: nombre → PIN (0000 la primera vez); sin código ni invitación. Sin email. Las cuentas las crea el SQL (lista de la mesa) o el admin (`add_member`). Nunca habilitar el registro con email.
- Roles: `admin` (el primero que crea su PIN), `leader`, `agent`. Solo el admin cambia roles, suma/baja gente y resetea PINs. Team leader y admin cargan ventas a nombre de cualquiera de la mesa (`crm_name` para reconocerlos en el CRM).
- Social: `pings` (mate/d10/d30/toque; msg ya no se usa en la UI) con cooldown en `ping_guard`, respuestas por `reply_ping`, silenciar con `profiles.quiet_until`. Perfiles (`openProfile`, cualquier `[data-prof]`) con estadísticas y toques.
- Chat: `chats`/`chat_members`/`messages`/`chat_reads`, grupos y privados solo por funciones `chat_*`, lectura con `in_chat`. Avisos instantáneos: realtime (worker) + `catchUp()` al reconectar/volver/foco, sondeo de 5 s solo si el canal está caído, y la extensión despierta la pestaña cada 30 s (`tick`). Con la extensión, tarjeta en la pestaña activa (una por chat, se actualiza).
- En la app: `team` = todas las ventas de la mesa, `ftds` = las mías (sueldo, inicio, turnos usan `ftds`).
- `app/config.json` tiene la URL y la clave **publishable** (pública). Jamás commitear la clave secret/service_role.

## Extensión
- Habla con la página por `window.postMessage` en la misma ventana (`bridge.js`, solo en https://vitaliscrm.netlify.app y con `<meta name="vitalis">`). Si cambia el dominio, actualizar `content_scripts` en el manifest.
- CRM: `crm.js` (botón de ventas aprobadas + clientes en "new" al registro + vigilar la página tocando `.refresh-btn`/Search).
- Snippets: `snip.js` en todas las páginas expande `/atajo` (input, textarea y contenteditable).
- Avisos: `sw.js` (alarmas, tarjeta inyectada en la pestaña activa, sonido por documento offscreen).

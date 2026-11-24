# Vitalis

Asistente de ventas de la mesa **Team Matías** · **https://vitalis.joaquin-or24.workers.dev**: ventas (FTDs) y clientes new compartidos en la mesa, conversión del día, la semana y el mes, snippets con `/atajo`, un chat (toda la mesa, grupos y privados), una sección social (pedir un mate, salir a los 10 o a la media, perfiles con toques) y sueldo, agenda, turnos y faltas privados de cada agente. Viene con una extensión de Chrome para los avisos, el CRM y los snippets. Se llama así por Vitalis, excompañero de la mesa que siempre cebaba mates (de ahí el logo: un mate torpedo de cuero).

## Cómo está armado

| Carpeta | Qué hay |
|---|---|
| `site/` | Lo que se publica (Netlify la sirve tal cual). **No se edita a mano**: se arma con `python3 app/build.py`. |
| `app/src/` | El código de la app: `core.js` (datos, sueldo, estadísticas), `ui.js`, `actions.js`, `views.js`, `social.js` (pedidos, avisos sociales y perfiles), `chat.js` (chat), `auth.js` (entrada con nombre + PIN), `style.css`, `body.html` (incluye el logo del mate en SVG). |
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

## Varias mesas

Cada mesa entra por su propio dominio: **`vitalis-<nombre corto>.joaquin-or24.workers.dev`** (la mesa de siempre: `vitalis-matias.…`). Todas usan este mismo repo y la misma base: la app saca la mesa del dominio y pide la lista de nombres de esa mesa. Sin dominio propio (`vitalis.joaquin-or24.workers.dev`), Vitalis pregunta de qué mesa sos la primera vez y lo recuerda; `#m=<nombre corto>` también sirve.

Para crear una mesa:
1. En Vitalis, como dueño: **Gerencia → Mesas → Nueva mesa** (nombre, nombre corto, team leader y agentes; todos entran con PIN 0000).
2. En Cloudflare: **Workers & Pages → Create → Import a repository**, este repo, nombre del Worker **`vitalis-<nombre corto>`** (el mismo build que el worker `vitalis`: sirve `site/`). Con eso queda `https://vitalis-<nombre corto>.joaquin-or24.workers.dev`. Hasta que exista, la mesa entra por `vitalis.joaquin-or24.workers.dev` eligiéndola en la lista.
3. La extensión de Chrome ya anda en cualquier `*.joaquin-or24.workers.dev` (desde la 1.17.0).

El dueño (perfil `global`, rol admin) y los directores figuran en la lista de todas las mesas: al entrar por el dominio de una mesa pasan a esa mesa, y desde Gerencia ven todas las mesas comparadas y cambian de una a otra con "Entrar". Compartido entre mesas: Banking, la tabla de status del CRM y los snippets globales; todo lo demás (clientes, ventas, chat, cola, estación, targets) es de cada mesa.

## Datos

- **Compartido en la mesa:** `sales` y `leads` (todos leen; cada uno edita lo suyo; team leader y admin cargan y corrigen las de cualquiera), `snippets` marcados como compartidos.
- **Team leader:** carga ventas a nombre de cualquiera de la mesa (Trade24Seven y Novara Markets): a mano eligiendo el vendedor, por CSV o desde el CRM con la extensión. Si la tabla del CRM tiene la columna Sales Rep, se pasan solas a cada vendedor; si no, a quien elija en "De" (por defecto, él). "Nombre en el CRM" (`profiles.crm_name`) ayuda a reconocer a cada uno.
- **Social:** `pings` (mate, salir a los 10, a la media, toque), para toda la mesa o para alguien. Cooldown en la base (mate 20 min, salidas 3 min, toque 2 min por persona), la primera respuesta gana, se borran a los 7 días. Silenciar: `profiles.quiet_until` (vale también para el chat).
- **Snippets globales:** `snippets.global`; solo el admin los crea y edita, a todos les funcionan solos. Gana el propio de cada uno, después el global, después el compartido de un compañero.
- **Clientes del CRM:** con la extensión, todos los clientes que se ven en cualquier pestaña del CRM se guardan con su status, registro, agente, campaña y afiliado (`crm_clients`, `crm_status_log`, solo por `crm_seen()`). Una sola pestaña se actualiza sola (la que se elige con el botón) y avisa de los new; al volver a Vitalis se abre la ficha del cliente.
- **Ahora:** la cola en el orden de la mesa: new, agendas, Call Again · Hang Up · NA (hasta 60 todos; si hay más, los del mes). Nunca Do Not Call ni depositados. El team leader ve la cola de cada uno en Equipo y cambia el tope.
- **Trade24Seven** quedó como archivo: lo de hoy (cola, ficha, conversión, Filtros) es Novara.
- **Registro de accesos:** `audit_log` (exportaciones y cambios a ventas ajenas), en Ajustes para team leader y admin. **Calidad de datos** (admin): ventas sin transacción, status sin clasificar.
- **Filtros:** con las ventas de toda la mesa (período y marca, Novara por defecto): campañas, afiliadores, países y combinaciones que más venden, tendencia contra el período anterior, qué campañas y afiliadores convierten lates y hora de los FTDs. "Para filtrar ahora" resume y se copia; el team leader lo manda como tarea.
- **Sueldo:** premios del mes (USD o UYU, van como las comisiones: en el recibo o aparte) y faltas que descuentan del fijo (fijo ÷ 30 por falta, o el monto que pongas; las justificadas también, salvo que lo desactives). Todo en `settings.cfg` (`premios`, `faltas`, `descFalta`, `faltaJust`).
- **Tareas:** `tasks` (qué hacer, campañas, afiliadores, desde/hasta, status, notas, para cuándo) y `task_people` (a quién y cuándo la hizo). Las manda team leader o admin con `task_create` (sin gente elegida: toda la mesa menos quien la manda); cada uno la marca con `task_done`. Ven la tarea quienes la recibieron; team leader y admin ven todas.
- **Chat:** `chats` (uno `team` por mesa, `group`, `dm`), `chat_members`, `messages` y `chat_reads` (hasta dónde leí y si lo silencié). Grupos y privados solo con funciones (`chat_create`, `chat_add`, `chat_leave`, `chat_rename`, `chat_dm`); cada uno lee solo los chats donde está (`in_chat`). Máximo 15 mensajes cada 30 s.
- **Tiempo real:** todo llega por Supabase Realtime (con el latido en un worker para que no se frene en segundo plano). Si el canal se corta, la app se pone al día enseguida, sondea cada 5 s hasta que vuelve y se resuscribe; con la extensión, además, se despierta cada 30 s.
- **Target individual:** `user_targets` (FTDs del mes de cada uno; lo fija el team leader o el admin; cada uno ve solo el suyo).
- **Target y la mesa:** `targets` (FTDs del mes de la mesa; lo fija team leader o admin, lo leen todos). El inicio muestra lo tuyo (FTDs, bono, líquido) y la mesa (cuántos van, cuánto falta, por día hábil, ritmo y podio).
- **Privado:** `settings` (sueldo, premios, días) y snippets propios. `adjustments`, `agenda` y `shifts` son de cada uno, pero el team leader y el admin los leen (políticas `lead_*`) y ven las faltas por `team_days()`: en Equipo, la ficha de cada persona con su mes, agenda, turnos, clientes y tareas, sin sueldo.
- **Desvinculados:** las ventas del CRM de alguien que ya no está en la mesa se cargan a su nombre como desvinculado (`profiles.former`, inactivo, no entra). En Ajustes se ven aparte y, si alguno era de la mesa con otro nombre, se une (`merge_former`).
- **Fotos de perfil:** `avatars` (una por persona; la ve toda la mesa, la sube y la saca cada uno desde Ajustes o su perfil).
- **Chat:** responder (`messages.reply_to`), reaccionar (`message_reactions`), @ con sugerencias y @todos del team leader.
- **Imágenes del chat:** `chat_files` (se pegan, se arrastran o se eligen; la app las achica). Las ven solo los del chat.
- **Menú:** todas las secciones separadas, en orden de importancia, con Ahora después de Inicio.
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

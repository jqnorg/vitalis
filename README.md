# Vitalis

Asistente de ventas de la mesa **Team Matías** · **https://vitaliscrm.netlify.app**: ventas (FTDs) compartidas en la mesa, y sueldo, agenda, turnos y faltas privados de cada agente. Viene con una extensión de Chrome para los avisos y el CRM.

## Cómo está armado

| Carpeta | Qué hay |
|---|---|
| `site/` | Lo que se publica (Netlify la sirve tal cual). **No se edita a mano**: se arma con `python3 app/build.py`. |
| `app/src/` | El código de la app: `core.js` (datos, sueldo, estadísticas), `ui.js`, `actions.js`, `views.js`, `auth.js`, `style.css`, `body.html`. |
| `app/config.json` | URL y clave **publishable** de Supabase (son públicas; los datos los protegen las reglas RLS). |
| `extension/` | Extensión de Chrome (Manifest V3). Se empaqueta sola en `site/vitalis-extension.zip`. |
| `supabase/vitalis.sql` | Tablas, reglas de acceso (RLS), registro con código de invitación. Se puede volver a correr sin borrar datos. |
| `test/` | Pruebas: `sql.test.mjs` (permisos con Postgres local) y `server.mjs` (Supabase de prueba para probar la app entera). |

## Publicar un cambio

1. Editar `app/src/` (o `extension/`).
2. `python3 app/build.py`
3. Commit y push a `main`: Netlify publica `site/` en menos de un minuto.

## Datos

- **Compartido en la mesa:** `sales` (todos leen; cada uno edita lo suyo; team leader y admin corrigen cualquiera).
- **Privado:** `settings`, `adjustments`, `agenda`, `shifts`.
- **Roles:** `admin` (el primero que se registra), `leader`, `agent`. Solo el admin cambia roles, da de baja y cambia el código.
- No subir nunca la clave **secret / service_role** de Supabase.

## Pruebas

```bash
cd test && npm install
node sql.test.mjs          # 28 controles de permisos
node server.mjs 54321      # Supabase de prueba en http://localhost:54321 (sirve site/)
```

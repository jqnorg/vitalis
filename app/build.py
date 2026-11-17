# Arma la carpeta site/ (lo que publica Netlify): index.html + supabase.js + config.js + la extensión en .zip
# Uso: python3 app/build.py   (desde la raíz del repo)
import pathlib, shutil, json, zipfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
S=ROOT/'app'/'src'; D=ROOT/'site'; D.mkdir(exist_ok=True)
fav="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23060a07'/%3E%3Cpath d='M7 8l9 17 9-17' fill='none' stroke='%237dff8a' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
js='\n'.join((S/f).read_text() for f in ['core.js','ui.js','actions.js','views.js','auth.js'])
js=js.replace('\nboot();\n','\n')+'\nboot();\n'   # boot() al final, después de auth.js
html=f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="vitalis" content="app">
<meta name="theme-color" content="#060a07">
<title>Vitalis</title>
<link rel="icon" href="{fav}">
<style>
{(S/'style.css').read_text()}</style>
</head>
<body>
{(S/'body.html').read_text()}<script src="supabase.js"></script>
<script src="config.js"></script>
<script>
{js}</script>
</body>
</html>
'''
(D/'index.html').write_text(html)
shutil.copy(ROOT/'app'/'vendor'/'supabase.js', D/'supabase.js')
cfg=json.loads((ROOT/'app'/'config.json').read_text())
(D/'config.js').write_text('// Datos públicos del proyecto de Supabase (la clave publishable es pública por diseño; los datos los protegen las reglas RLS).\nwindow.VITALIS_CONFIG = '+json.dumps(cfg,indent=2)+';\n')
(D/'_headers').write_text('/*\n  X-Frame-Options: DENY\n  Referrer-Policy: same-origin\n  X-Content-Type-Options: nosniff\n/*.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n')
with zipfile.ZipFile(D/'vitalis-extension.zip','w',zipfile.ZIP_DEFLATED) as z:   # la extensión se descarga desde la app
    for p in sorted((ROOT/'extension').rglob('*')):
        if p.is_file(): z.write(p, p.relative_to(ROOT/'extension'))
print('site/:', sorted(p.name for p in D.iterdir()), len(html))

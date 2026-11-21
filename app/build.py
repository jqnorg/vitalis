# Arma la carpeta site/ (lo que publica Netlify): index.html + supabase.js + config.js + la extensión en .zip
# Uso: python3 app/build.py   (desde la raíz del repo)
import pathlib, shutil, json, zipfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
S=ROOT/'app'/'src'; D=ROOT/'site'; D.mkdir(exist_ok=True)
import re, urllib.parse
body=(S/'body.html').read_text()
logo=re.search(r'<symbol id="logo" viewBox="0 0 48 48">(.*?)</symbol>', body, re.S).group(1)
fav_svg="<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'>"+re.sub(r'\s+',' ',logo).replace('"',"'")+"</svg>"
(D/'logo.svg').write_text(fav_svg.replace("'",'"'))
fav="data:image/svg+xml,"+urllib.parse.quote(fav_svg)
js='\n'.join((S/f).read_text() for f in ['core.js','ui.js','actions.js','views.js','social.js','chat.js','tasks.js','filtros.js','mesa.js','ahora.js','banking.js','ficha.js','hoy.js','campanas.js','radar.js','cola.js','estacion.js','share.js','lock.js','auth.js'])
js=js.replace('\nboot();\n','\n')+'\nboot();\n'
js=js.replace('__EXT_VER__', json.loads((ROOT/'extension'/'manifest.json').read_text())['version'])   # la versión de la extensión que se descarga   # boot() al final, después de auth.js
cfg=json.loads((ROOT/'app'/'config.json').read_text())
import hashlib
vend=(ROOT/'app'/'vendor'/'supabase.js').read_bytes()
SUPA='supabase.'+hashlib.sha256(vend).hexdigest()[:10]+'.js'   # con el hash en el nombre: el navegador lo guarda para siempre y no vuelve a preguntar
cfgjs='window.VITALIS_CONFIG = '+json.dumps(cfg)+';'
# antes de que cargue nada: el tema guardado y la pantalla de entrada (nunca se ve la app sin sesión)
pre='''<script>try{var t=JSON.parse(localStorage.getItem('vitalis.tema'))||'auto';if(t==='oscuro'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches))document.body.classList.add('dark')}catch(e){}</script>
<div id="auth"><div class="abox"><div class="brand"><svg class="mark" aria-hidden="true"><use href="#logo"/></svg><span class="word">vitalis</span></div><div id="abox"><div class="aload"><svg aria-hidden="true"><use href="#logo"/></svg>Cebando…</div></div></div></div>
'''
html=f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="vitalis" content="app">
<meta name="theme-color" content="#f6f7f8">
<title>Vitalis</title>
<link rel="icon" href="{fav}">
<link rel="preconnect" href="{cfg['url']}" crossorigin>
<link rel="preload" href="{SUPA}" as="script">
<link rel="preload" href="fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
<style>
{(S/'style.css').read_text()}</style>
</head>
<body class="auth">
{pre}{body}<script src="{SUPA}"></script>
<script id="cfg">{cfgjs}</script>
<script>
{js}</script>
</body>
</html>
'''
(D/'index.html').write_text(html)
for old in D.glob('supabase.*.js'):
    if old.name!=SUPA: old.unlink()
(D/SUPA).write_bytes(vend)
shutil.copy(ROOT/'app'/'vendor'/'supabase.js', D/'supabase.js')   # por si alguna página vieja todavía la pide
(D/'config.js').write_text('// Datos públicos del proyecto de Supabase (la clave publishable es pública por diseño; los datos los protegen las reglas RLS).\nwindow.VITALIS_CONFIG = '+json.dumps(cfg,indent=2)+';\n')
(D/'fonts').mkdir(exist_ok=True)
for f in (ROOT/'app'/'fonts').iterdir(): shutil.copy(f, D/'fonts'/f.name)
(D/'_headers').write_text('/*\n  X-Frame-Options: DENY\n  Referrer-Policy: same-origin\n  X-Content-Type-Options: nosniff\n/*.js\n  Cache-Control: no-cache\n/supabase.*.js\n  Cache-Control: public, max-age=31536000, immutable\n/index.html\n  Cache-Control: no-cache\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n')
with zipfile.ZipFile(D/'vitalis-extension.zip','w',zipfile.ZIP_DEFLATED) as z:   # la extensión se descarga desde la app
    for p in sorted((ROOT/'extension').rglob('*')):
        if p.is_file(): z.write(p, p.relative_to(ROOT/'extension'))
print('site/:', sorted(p.name for p in D.iterdir()), len(html))

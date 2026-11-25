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
js='\n'.join((S/f).read_text() for f in ['core.js','ui.js','dock.js','actions.js','views.js','social.js','chat.js','tasks.js','filtros.js','mesa.js','ahora.js','banking.js','kb.js','ficha.js','hoy.js','campanas.js','radar.js','estacion.js','callman.js','gerencia.js','historial.js','share.js','lock.js','auth.js'])
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
# la extensión de prueba (vTL y vAgente): la misma extensión con prueba.json adentro, sin Vitalis (ni bridge ni snippets)
man=json.loads((ROOT/'extension'/'manifest.json').read_text())
TRIAL_SKIP={'bridge.js','snip.js','manifest.json'}
for role,label in [('tl','TL'),('agente','Agente')]:
    m=dict(man); m['name']=f'Vitalis · Prueba ({label})'
    m['description']='Vitalis de prueba, solo lectura del CRM: avisa de cada new al instante, mide cuánto se tarda en llamarlo y muestra la info de la campaña. '+('El team leader ve quién sigue en New y hace cuánto.' if role=='tl' else 'El agente ve su siguiente new y sus números del día.')
    m['permissions']=[x for x in man['permissions'] if x not in ('contextMenus','idle')]
    m['content_scripts']=[c for c in man['content_scripts'] if 'crm.js' in c['js']]
    m['action']=dict(man['action'],default_title=m['name'])
    with zipfile.ZipFile(D/f'vitalis-prueba-{role}.zip','w',zipfile.ZIP_DEFLATED) as z:
        for q in sorted((ROOT/'extension').rglob('*')):
            if q.is_file() and q.name not in TRIAL_SKIP: z.write(q, q.relative_to(ROOT/'extension'))
        z.writestr('manifest.json', json.dumps(m, ensure_ascii=False, indent=2))
        z.writestr('prueba.json', json.dumps({'role':'tl' if role=='tl' else 'agent','url':cfg['url'],'key':cfg['key']}))
# la página pública de invitación a la prueba
(D/'prueba').mkdir(exist_ok=True)
pr=(ROOT/'app'/'prueba.html').read_text().replace('__URL__',cfg['url']).replace('__KEY__',cfg['key']).replace('__VER__',man['version']).replace('__LOGO_INNER__',re.sub(r'\s+',' ',logo))
(D/'prueba'/'index.html').write_text(pr)
print('site/:', sorted(p.name for p in D.iterdir()), len(html))

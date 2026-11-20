# Prueba la extensión de Chrome con Vitalis (base de prueba server.mjs):
# snippets con /atajo en otra página y clientes "new" del CRM que llegan al registro.
# Uso: cd test && python3 e2e_ext.py   → capturas en test/shots/
import asyncio, re, subprocess, time, json, urllib.request, pathlib, sys, tempfile
from playwright.async_api import async_playwright
PORT = 54420
LOCAL = f'http://localhost:{PORT}'
APP = 'https://vitalis.joaquin-or24.workers.dev/'
API = 'https://mock.supabase.test'
EXT = str((pathlib.Path(__file__).parent.parent / 'extension').resolve())
OUT = pathlib.Path(__file__).parent / 'shots'; OUT.mkdir(exist_ok=True)
def sql(q, params=None):
    r = urllib.request.Request(f'{LOCAL}/__sql', data=json.dumps({'sql': q, 'params': params or []}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
fails = []
def ok(c, m):
    print(('  ✔ ' if c else '  ✖ ') + m)
    if not c: fails.append(m)

FORM = '''<!doctype html><meta charset="utf-8"><title>Formulario</title><body style="font:16px system-ui;padding:20px">
<input id="i" style="width:600px"><br><br><textarea id="t" rows="6" cols="70"></textarea><br><br>
<div id="ce" contenteditable="true" style="border:1px solid #999;min-height:80px;width:600px;padding:6px"></div>
<input id="pw" type="password"><input id="no" data-vitalis-nosnip><div id="sh"></div>
<script>document.getElementById('sh').attachShadow({mode:'open'}).innerHTML='<input id="si" style="width:400px"><div id="sce" contenteditable="true" style="border:1px solid #999;min-height:40px;width:400px"></div>'</script></body>'''
CRM = '''<!doctype html><meta charset="utf-8"><title>CRM · Clients</title><body style="font:14px system-ui;padding:20px"><h3>Clients</h3><button class="refresh-btn" onclick="window.__clicks=(window.__clicks||0)+1">⟳</button>
<table border="1" cellpadding="6"><thead><tr><th>Client ID</th><th>Full Name</th><th>Country</th><th>Status</th><th>Registration Time</th></tr></thead><tbody>
<tr><td>555001</td><td>Lucía Pérez</td><td>Peru</td><td>New</td><td>17/11/2026 10:02</td></tr>
<tr><td>555002</td><td>Jorge Díaz</td><td>Chile</td><td>New</td><td>17/11/2026 10:40</td></tr>
<tr><td>555003</td><td>Ana Gómez</td><td>Mexico</td><td>No answer</td><td>16/11/2026 18:00</td></tr>
</tbody></table></body>'''
TLCRM = re.sub(r'<button class="refresh-btn"[^>]*>.*?</button>', '<button class="ant-btn" onclick="window.__s=(window.__s||0)+1"><span>Search</span></button> <button class="ant-btn" onclick="window.__r=(window.__r||0)+1"><span class="anticon anticon-reload"></span><span>Refresh</span></button>', CRM, count=1)
T24 = '''<!doctype html><meta charset="utf-8"><title>CRM · Bank transactions</title><body style="font:14px system-ui;padding:20px"><h3>Bank transactions</h3><button class="refresh-btn" onclick="window.__clicks=(window.__clicks||0)+1">⟳</button>
<table border="1" cellpadding="6"><thead><tr><th>Status</th><th>Time of FTD</th><th>User ID</th><th>Full Name</th><th>Country</th><th>Amount</th><th>Transaction ID</th><th>Sales Rep</th></tr></thead><tbody>
<tr><td>Approved</td><td>17/11/2026 10:15</td><td>777001</td><td>Carla Núñez</td><td>Peru</td><td>250</td><td>TX777001</td><td>Sofia Arias</td></tr>
<tr><td>Approved</td><td>17/11/2026 11:20</td><td>777002</td><td>Diego Soto</td><td>Chile</td><td>300</td><td>TX777002</td><td>Mateo Herrera</td></tr>
<tr><td>Approved</td><td>17/11/2026 12:05</td><td>777003</td><td>Rosa Paz</td><td>Mexico</td><td>200</td><td>TX777003</td><td>Fulano Externo</td></tr>
<tr><td>Declined</td><td>17/11/2026 12:30</td><td>777004</td><td>Luis Mora</td><td>Peru</td><td>100</td><td>TX777004</td><td>Sofia Arias</td></tr>
<tr><td>Approved</td><td>16/11/2026 15:40</td><td>777005</td><td>Ana Vera</td><td>Chile</td><td>150</td><td>TX777005</td><td>Mauricio Gomez</td></tr>
<tr><td>Approved</td><td>16/11/2026 16:10</td><td>777006</td><td>Pedro Gil</td><td>Peru</td><td>120</td><td>TX777006</td><td></td></tr>
</tbody></table></body>'''

T24_SINREP = '''<!doctype html><meta charset="utf-8"><title>CRM · FTDs</title><body style="font:14px system-ui;padding:20px"><h3>FTDs</h3><button class="refresh-btn">⟳</button>
<table border="1" cellpadding="6"><thead><tr><th>Status</th><th>Time of FTD</th><th>User ID</th><th>Full Name</th><th>Country</th><th>Amount</th><th>Transaction ID</th></tr></thead><tbody>
<tr><td>Success</td><td>17/11/2026 14:15</td><td>777101</td><td>Marta Gil</td><td>Peru</td><td>180</td><td>TX777101</td></tr>
</tbody></table></body>'''

# como el CRM de Novara: encabezado y fila de filtros en una tabla, las filas en otra, y la columna Actions fija aparte
def _nv_row(i, c):
    tds = ''.join(f'<td role="gridcell" aria-colindex="{j+1}">{v}</td>' for j, v in enumerate(['<div class="dx-select-checkbox"></div>'] + c + ['<i class="ic"></i>']))
    return f'<tr class="dx-row dx-data-row" role="row" aria-rowindex="{i+1}">{tds}</tr>'
_NV_H = ['', 'User ID', 'Country', 'Full Name', 'Affiliate', 'User Source', 'Sales Status', 'Last Communication Time', 'Registration Time', 'Last Note', 'Actions']
_NV = [['880101', 'Mexico', 'Rosa Ibarra', '109028', 'App Uno', 'NA - DAY3', '18/11/2026 09:45', '17/11/2026 18:48', 'NA 3.1'],
       ['880102', 'Chile', 'Tomás Vera', '108887', 'Capital Dos', 'NA - DAY2', '18/11/2026 12:33', '17/11/2026 18:35', 'vm 2.3'],
       ['880103', 'Colombia', 'Inés Lara', '97285', 'Capital Dos', 'Hang Up', '18/11/2026 09:46', '17/11/2026 16:32', 'NA 2-2'],
       ['880104', 'Colombia', 'Raúl Peña', '108887', 'App Tres', 'Call Again', '18/11/2026 15:19', '17/11/2026 14:42', 'The number is out of service'],
       ['880105', 'Mexico', 'Eva Ruiz', '109028', 'App Uno', 'No Answer', '', '16/11/2026 18:38', '']]
NOVARA = ('''<!doctype html><meta charset="utf-8"><title>CRM · Clients</title><body style="font:12px system-ui;padding:10px"><button class="refresh-btn">⟳</button>
<div class="dx-datagrid" role="grid"><div class="dx-datagrid-headers"><div class="dx-datagrid-content"><table class="dx-datagrid-table"><tbody>
<tr class="dx-row dx-column-lines dx-header-row" role="row">''' + ''.join(f'<td role="columnheader" aria-colindex="{j+1}">{h}</td>' for j, h in enumerate(_NV_H)) + '''</tr>
<tr class="dx-row dx-column-lines dx-datagrid-filter-row" role="row">''' + ''.join(f'<td role="gridcell" aria-colindex="{j+1}">{v}</td>' for j, v in enumerate(
    ['', '<input placeholder="Search...">', '<input placeholder="Filter..."><select></select>', '<input placeholder="Search...">', '<input placeholder="Filter...">', '<input placeholder="Search...">',
     '<div class="tag">No Answer, ... (8)</div>', '<input placeholder="Search...">', '<div>16/11/2026 - 20/11/2026</div><input type="text">', '<input placeholder="Search...">', ''])) + '''</tr>
</tbody></table></div></div><div class="dx-datagrid-rowsview"><div class="dx-datagrid-content"><table class="dx-datagrid-table"><tbody>''' + ''.join(_nv_row(i, c) for i, c in enumerate(_NV)) + '''
<tr class="dx-row dx-freespace-row"><td colspan="11"></td></tr></tbody></table></div>
<div class="dx-datagrid-content dx-datagrid-content-fixed"><table class="dx-datagrid-table"><tbody>''' + ''.join('<tr class="dx-row dx-data-row"><td colspan="10" class="dx-pointer-events-none"></td><td><i class="ic"></i></td></tr>' for _ in _NV) + '''</tbody></table></div></div></div></body>''')

async def main():
    srv = subprocess.Popen(['node', 'server.mjs', str(PORT)], cwd=pathlib.Path(__file__).parent, stdout=open('/tmp/srv_ext.log','w'), stderr=subprocess.STDOUT); time.sleep(5)
    errs = []
    try:
        async with async_playwright() as p:
            ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path='/usr/bin/google-chrome', headless=False,
                viewport={'width': 1366, 'height': 860},
                args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--disable-features=DisableLoadExtensionCommandLineSwitch'])
            async def to_local(route, path):
                req = route.request
                r = await route.fetch(url=LOCAL + path, method=req.method, headers=req.headers, post_data=req.post_data_buffer)
                await route.fulfill(response=r)
            async def app(route):
                path = route.request.url[len(APP) - 1:].split('#')[0] or '/'
                if path.startswith('/config.js'):
                    return await route.fulfill(status=200, content_type='text/javascript', body=f"window.VITALIS_CONFIG={{url:'{API}',key:'test-anon-key'}};")
                if path.split('?')[0] in ('/', '/index.html'):
                    r = await route.fetch(url=LOCAL + '/')
                    html = re.sub(r'<script id="cfg">[\s\S]*?</script>', f"<script id=\"cfg\">window.VITALIS_CONFIG={{url:'{API}',key:'test-anon-key'}};</script>", await r.text())
                    return await route.fulfill(status=200, content_type='text/html', body=html)
                await to_local(route, path)
            await ctx.route(APP + '**', app)
            await ctx.route(API + '/**', lambda route: to_local(route, route.request.url[len(API):]))
            await ctx.route('https://example.test/**', lambda r: r.fulfill(status=200, content_type='text/html', body=FORM))
            await ctx.route('https://cc-dal01.voiso.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<html><body><h1>Agent Workspace</h1></body></html>'))
            await ctx.route('https://crmnovaramarkets.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=CRM))
            await ctx.route('https://crmtrade24seven.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=T24))
            await ctx.route('https://ant-crm.crmnovaramarkets.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<!doctype html><meta charset="utf-8"><title>CRM</title><body><div class="hdr"><div><h2>Fabio Prueba</h2><div>ID 712345</div></div></div><p>Server: Stock</p></body>'))
            await ctx.route('https://crmnovaramarkets.com/novara', lambda r: r.fulfill(status=200, content_type='text/html', body=NOVARA))
            _t = lambda hs, rows: '<!doctype html><meta charset="utf-8"><title>CRM</title><body><table class="ant-table"><thead><tr>' + ''.join(f'<th>{h}</th>' for h in hs) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{v}</td>' for v in r) + '</tr>' for r in rows) + '</tbody></table></body>'
            DOS = _t(['User ID', 'Full Name', 'Status', 'Sales Status', 'Registration Time'], [['880201', 'Ana Dos', 'Full Registration', 'Call Again', '17/11/2026 10:00'], ['880202', 'Beto Dos', 'Full Registration', 'Llamar de nuevo', '17/11/2026 10:05'], ['880203', 'Caro Dos', 'Partial Registration', 'NA - DAY2', '17/11/2026 10:09']])
            TRX = _t(['User ID', 'Full Name', 'Status', 'Amount'], [['880301', 'Dani Tres', 'Success', '250'], ['880302', 'Eli Tres', 'TimeOut', '250'], ['880303', 'Fede Tres', 'Failure', '300'], ['880304', 'Gabi Tres', 'Approved', '300']])
            await ctx.route('https://crmnovaramarkets.com/novara-dos', lambda r: r.fulfill(status=200, content_type='text/html', body=DOS))
            await ctx.route('https://crmnovaramarkets.com/novara-trx', lambda r: r.fulfill(status=200, content_type='text/html', body=TRX))
            await ctx.route('https://crmnovaramarkets.com/tl', lambda r: r.fulfill(status=200, content_type='text/html', body=TLCRM))
            await ctx.route('https://crmtrade24seven.com/sinrep', lambda r: r.fulfill(status=200, content_type='text/html', body=T24_SINREP))
            sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
            ok('chrome-extension://' in sw.url, 'la extensión cargó')

            A = await ctx.new_page()
            A.on('pageerror', lambda e: errs.append('A ' + str(e)))
            await A.goto(APP); await A.wait_for_timeout(1500)
            await A.click('.person:has-text("Sofía Ar")'); await A.keyboard.type('0000'); await A.wait_for_timeout(1500)
            await A.keyboard.type('1357'); await A.wait_for_timeout(300); await A.keyboard.type('1357'); await A.wait_for_timeout(2500)
            ok(await A.evaluate('ready'), 'Sofía entra a Vitalis')
            sql("""insert into public.snippets (team_id,user_id,shortcut,title,body) select team_id,id,'kyc','KYC',E'Hola!\\nNecesito tu documento.\\nSaludos, {yo}' from public.profiles where name='Sofía Ar';
                   insert into public.snippets (team_id,user_id,shortcut,body) select team_id,id,'dep','Tu depósito de {cursor} USD ya está acreditado.' from public.profiles where name='Sofía Ar';
                   insert into public.snippets (team_id,user_id,shortcut,body) select team_id,id,'dep2','Segundo depósito recibido.' from public.profiles where name='Sofía Ar';""")
            await A.reload(); await A.wait_for_timeout(3000)
            ok(await A.evaluate('extOn()'), 'Vitalis ve la extensión conectada')
            st = await sw.evaluate("chrome.storage.local.get(['snips','me'])")
            ok(len(st.get('snips', [])) == 3 and st.get('me') == 'Sofía Ar', f"la extensión recibió los snippets ({len(st.get('snips', []))}) y el nombre")

            # snippets en otra página
            F = await ctx.new_page()
            await F.goto('https://example.test/form'); await F.wait_for_timeout(800)
            await F.click('#i'); await F.keyboard.type('Hola /kyc', delay=30); await F.wait_for_timeout(300)
            v = await F.input_value('#i')
            ok(v.startswith('Hola Hola!') and 'Sofía Ar' in v, f'input: /kyc se expande ({v!r})')
            await F.click('#t'); await F.keyboard.type('/kyc', delay=30); await F.wait_for_timeout(300)
            v = await F.input_value('#t')
            ok(v == 'Hola!\nNecesito tu documento.\nSaludos, Sofía Ar', f'textarea: respeta los renglones ({v!r})')
            await F.fill('#t', ''); await F.click('#t'); await F.keyboard.type('/dep', delay=30); await F.wait_for_timeout(300)
            ok(await F.input_value('#t') == '/dep', 'si otro atajo empieza igual (/dep2) espera')
            await F.keyboard.press('Space'); await F.keyboard.type('250', delay=20); await F.wait_for_timeout(200)
            v = await F.input_value('#t')
            ok(v == 'Tu depósito de 250 USD ya está acreditado.', f'con espacio se completa y el cursor queda en {{cursor}} ({v!r})')
            await F.fill('#t', ''); await F.click('#t'); await F.keyboard.type('/dep2', delay=30); await F.wait_for_timeout(300)
            ok(await F.input_value('#t') == 'Segundo depósito recibido.', '/dep2 se expande solo')
            await F.click('#ce'); await F.keyboard.type('Buenas /kyc', delay=30); await F.wait_for_timeout(400)
            t = await F.inner_text('#ce')
            ok('Necesito tu documento.' in t and '/kyc' not in t, f'contenteditable: se expande ({t!r})')
            await F.click('#pw'); await F.keyboard.type('/kyc', delay=20); await F.wait_for_timeout(200)
            ok(await F.input_value('#pw') == '/kyc', 'en contraseñas no se expande')
            await F.click('#no'); await F.keyboard.type('/kyc', delay=20); await F.wait_for_timeout(200)
            ok(await F.input_value('#no') == '/kyc', 'en campos marcados data-vitalis-nosnip no se expande')
            await F.click('#i'); await F.fill('#i', ''); await F.keyboard.type('http://x.com/kyc', delay=10); await F.wait_for_timeout(200)
            ok(await F.input_value('#i') == 'http://x.com/kyc', 'en una dirección (x.com/kyc) no se expande')
            await F.click('#si'); await F.keyboard.type('/dep2', delay=30); await F.wait_for_timeout(300)
            ok(await F.input_value('#si') == 'Segundo depósito recibido.', 'adentro de un shadow DOM (input) también')
            await F.click('#sce'); await F.keyboard.type('Ok /dep2', delay=30); await F.wait_for_timeout(300)
            ok('Segundo depósito recibido.' in await F.inner_text('#sce') and '/dep2' not in await F.inner_text('#sce'), 'y en un editor adentro de un shadow DOM')
            # la extensión se actualiza con la página abierta: la copia nueva toma el lugar, sin duplicar
            await sw.evaluate("chrome.tabs.query({url:'https://example.test/*'}).then(([t])=>chrome.scripting.executeScript({target:{tabId:t.id,allFrames:true},files:['snip.js']}))"); await F.wait_for_timeout(300)
            await F.fill('#i', ''); await F.click('#i'); await F.keyboard.type('/dep2', delay=30); await F.wait_for_timeout(300)
            ok(await F.input_value('#i') == 'Segundo depósito recibido.', f'después de reinyectar se expande una sola vez ({await F.input_value("#i")!r})')
            # clic derecho → Snippets de Vitalis: pega en el campo donde estás
            await sw.evaluate('snipMenu()'); await F.wait_for_timeout(500)
            await F.fill('#t', 'Hola '); await F.click('#t'); await F.keyboard.press('End')
            await sw.evaluate("chrome.tabs.query({url:'https://example.test/*'}).then(([t])=>chrome.scripting.executeScript({target:{tabId:t.id},func:pasteSnip,args:['desde el menú {cursor}listo']}))"); await F.wait_for_timeout(300)
            ok(await F.input_value('#t') == 'Hola desde el menú listo', f'el menú del clic derecho pega el snippet ({await F.input_value("#t")!r})')
            await F.click('#si'); await F.fill('#si', '')
            await sw.evaluate("chrome.tabs.query({url:'https://example.test/*'}).then(([t])=>chrome.scripting.executeScript({target:{tabId:t.id},func:pasteSnip,args:['en sombra']}))"); await F.wait_for_timeout(300)
            ok(await F.input_value('#si') == 'en sombra', 'y también adentro de un shadow DOM')
            await F.screenshot(path=OUT / 'x1_snippets_en_pagina.png')

            # clientes new del CRM → registro de Vitalis
            C = await ctx.new_page()
            await C.goto('https://crmnovaramarkets.com/clients'); await C.wait_for_timeout(3500)
            await C.screenshot(path=OUT / 'x2_crm.png')
            rows = sql("select client_id, name, source, (select name from public.profiles where id=user_id) who from public.leads order by client_id")
            ok([(r['client_id'], r['name']) for r in rows] == [('555001', 'Lucía Pérez'), ('555002', 'Jorge Díaz')] and all(r['who'] == 'Sofía Ar' and r['source'] == 'crm' for r in rows), f'los 2 clientes en new llegaron al registro con su nombre ({rows})')
            await C.reload(); await C.wait_for_timeout(2500)
            ok(sql("select count(*)::int c from public.leads")[0]['c'] == 2, 'recargar el CRM no los duplica')
            q = await sw.evaluate("chrome.storage.local.get('leadQ')")
            ok(len(q.get('leadQ', [])) == 0, 'la cola de la extensión quedó vacía')
            # con Vitalis cerrado quedan en cola y entran al abrirlo
            await A.close()
            await C.evaluate("""() => { const tb = document.querySelector('tbody'); tb.insertAdjacentHTML('beforeend', '<tr><td>555004</td><td>Pedro Ruiz</td><td>Peru</td><td>New</td><td>17/11/2026 12:00</td></tr>'); }""")
            await C.wait_for_timeout(2500)
            q = await sw.evaluate("chrome.storage.local.get('leadQ')")
            ok(len(q.get('leadQ', [])) == 1, 'con Vitalis cerrado, el cliente nuevo queda en cola')
            A2 = await ctx.new_page(); await A2.goto(APP); await A2.wait_for_timeout(4000)
            ok(sql("select count(*)::int c from public.leads where client_id='555004'")[0]['c'] == 1, 'al abrir Vitalis entra el de la cola')
            await A2.evaluate("go('clientes')"); await A2.wait_for_timeout(600)
            await A2.screenshot(path=OUT / 'x3_clientes_desde_crm.png')
            # todos los clientes que se ven (no solo los new) llegan al registro de clientes, con su status
            await A2.wait_for_timeout(1500)
            rows = sql("select client_id, status, status_group g, reg, brand from public.crm_clients order by client_id")
            ok([(x['client_id'], x['g']) for x in rows][:3] == [('555001', 'new'), ('555002', 'new'), ('555003', 'na')] and rows[0]['reg'] == '2026-11-17 10:02' and rows[0]['brand'] == 'Novara Markets', f'todos los clientes que se ven llegan con status, registro y marca ({rows[:3]})')
            ok(any(x['client_id'] == '555004' for x in rows), 'también los que esperaron en cola con Vitalis cerrado')
            q = await sw.evaluate("chrome.storage.local.get('crmQ')")
            ok(len(q.get('crmQ', [])) == 0, 'la cola de clientes vistos quedó vacía')
            await C.evaluate("()=>{const td=[...document.querySelectorAll('td')].find(t=>t.textContent==='No answer');td.textContent='NA-2'}"); await C.wait_for_timeout(3000)
            r = sql("select new_status from public.crm_status_log where client_id='555003' order by id")
            ok([x['new_status'] for x in r] == ['No answer', 'NA-2'], f'un cambio de status en el CRM queda en el historial ({r})')
            # la lista de Novara (NA, Call Again y Hang Up), con fila de filtros, filas en otra tabla y la columna Actions fija
            Nv = await ctx.new_page(); await Nv.goto('https://crmnovaramarkets.com/novara'); await Nv.wait_for_timeout(4000)
            rows = sql("select client_id, status_group g, last_call, note, camp, aff, reg, country from public.crm_clients where client_id like '8801%' order by client_id")
            G = {x['client_id']: x for x in rows}
            ok(len(rows) == 5 and [G[k]['g'] for k in sorted(G)] == ['na', 'na', 'hang_up', 'call_again', 'na'], f'la lista de Novara llega entera y cada status en su grupo ({[(x["client_id"], x["g"]) for x in rows]})')
            ok(G.get('880101', {}).get('last_call') == '2026-11-18 09:45' and G['880101']['note'] == 'NA 3.1' and G['880101']['camp'] == 'App Uno' and G['880101']['aff'] == '109028' and G['880101']['reg'] == '2026-11-17 18:48' and G['880105']['last_call'] is None,
               f'con último contacto, última nota, campaña, afiliador y registro ({G.get("880101")})')
            ok(sql("select count(*)::int c from public.crm_clients where status ilike '%no answer, %' or client_id ilike 'search%'")[0]['c'] == 0, 'la fila de filtros no es un cliente')
            nvp = Nv.locator('#ftd-crm-button')
            ok(await nvp.locator('.vv').inner_text() == json.loads((pathlib.Path(EXT) / 'manifest.json').read_text())['version'], 'el panel del CRM muestra la versión de la extensión')
            ok('5 clientes a la vista' in await nvp.locator('#wst').inner_text() and await nvp.locator('[data-diag]').count() == 0, 'y cuántos clientes ve, sin pedir diagnóstico')
            await Nv.screenshot(path=OUT / 'x2b_crm_novara.png')
            await A2.evaluate("go('ahora')"); await A2.wait_for_timeout(1500)
            t = await A2.locator('#ahBody').inner_text()
            ok('880104' in t and '880101' in t and t.index('880104') < t.index('880103') < t.index('880102') < t.index('880101'), 'en Ahora: Call Again, Hang Up y después NA por día')
            ok('NA 3.1' in t, 'con la última nota a la vista')
            await A2.screenshot(path=OUT / 'x2c_ahora_novara.png')
            # el cliente abierto en el CRM (su ficha) queda como "cliente actual" en Vitalis
            Cu = await ctx.new_page(); await Cu.goto('https://ant-crm.crmnovaramarkets.com/user/712345?authToken=x'); await Cu.wait_for_timeout(2500)
            cur = await A2.evaluate("curCl&&[curCl.id,curCl.name,curCl.src]")
            ok(cur == ['712345', 'Fabio Prueba', 'crm'], f'el cliente abierto en el CRM es el cliente actual de Vitalis ({cur})')
            ok('cliente actual: 712345' in await Cu.evaluate("(document.getElementById('vitalis-cur-pill')||{shadowRoot:{textContent:''}}).shadowRoot.textContent"), 'y en el CRM se ve un aviso chico de que Vitalis lo tomó')
            await Cu.close()
            # o la ficha abierta como panel arriba de la lista (el número en otro elemento y un ícono al lado)
            await Nv.bring_to_front()
            await Nv.evaluate("()=>{const d=document.createElement('div');d.id='drw';d.innerHTML='<div class=hd><div><span class=dot></span> Ana Panel</div><div class=sub>ID <span>70370</span><i class=ic></i></div></div><p>Server: Stock</p>';document.body.appendChild(d)}"); await Nv.wait_for_timeout(2500)
            cur = await A2.evaluate("curCl&&[curCl.id,curCl.name]")
            ok(cur == ['70370', 'Ana Panel'], f'también la ficha abierta como panel arriba de la lista del CRM ({cur})')
            # cada toque en Omega, Gizat o Voiso es una llamada a ese cliente (el interno después del guión no se guarda)
            await Nv.evaluate("()=>{const d=document.getElementById('drw');d.insertAdjacentHTML('beforeend','<div class=btns><button class=vb>☎ Omega - 9944418</button><button class=vb>☎ Gizat - 1371</button><button class=vb>☎ Voiso LATAM - 3262</button><a href=\"#\">+57312547XXXX</a></div>')}")
            await A2.evaluate("setCurrent('555002','Otro','lista')"); await A2.wait_for_timeout(300)
            await Nv.click('text=Omega - 9944418'); await Nv.click('text=Omega - 9944418'); await Nv.click('text=Gizat - 1371'); await Nv.click('text=+57312547XXXX'); await Nv.wait_for_timeout(3000)
            cl = sql("select client_id, line from public.calls where client_id='70370' order by line")
            ok(await A2.evaluate("curCl&&curCl.id") == '70370', 'a quien llamás queda como cliente actual')
            ok([(x['client_id'], x['line']) for x in cl] == [('70370', 'gizat'), ('70370', 'omega')], f'los toques en Omega y Gizat llegan como llamadas a 70370 (el doble toque cuenta uno; el teléfono no) ({cl})')
            ok(not sql("select 1 from public.calls where client_id like '%9944418%' or client_id like '%1371%'"), 'sin el interno del agente')
            await Nv.evaluate("document.getElementById('drw').remove()"); await Nv.wait_for_timeout(800)
            # la ficha como en el CRM de verdad (nombre, "ID 68636", Server, teléfono tapado, Omega/Gizat/Voiso, país...). La dirección quedó
            # vieja (?userId= de hace rato) y hay una ficha vieja fuera de la pantalla, primera en la página: gana la que se ve, y Vitalis cambia solo
            await A2.evaluate("go('inicio')"); await Nv.bring_to_front()
            await Nv.evaluate("""()=>{history.replaceState(null,'',location.pathname+'?userId=51234');
              window.__mk=(id,name)=>'<div class=hd><div class=nm><span class=dot></span><span>'+name+'</span></div><div class=uid><span class=tag>ID '+id+'</span><span class=cp></span></div></div><div class=row><span>Server:</span><span></span></div><div class=row>+57312*****</div><div class=calls><button>☎ Omega - 9944418</button><button>☎ Gizat - 1371</button><button>☎ Voiso LATAM - 3262</button></div><div>Colombia</div><div>Spanish; Castilian</div><div>Apx Time 09:43 (UTC -5)</div><div>Source: trade ai</div><div>Novara Markets</div><div>INDIVIDUAL</div>';
              const old=document.createElement('div');old.id='oldDrw';old.style.cssText='position:fixed;top:0;left:100%;width:320px';old.innerHTML=__mk('60001','Vieja Ficha');document.body.prepend(old);
              const d=document.createElement('div');d.id='fic';d.innerHTML=__mk('68636','Lucio Diaz');document.body.prepend(d)}"""); await Nv.wait_for_timeout(1800)
            cur = await A2.evaluate("curCl&&[curCl.id,curCl.name,curCl.src]")
            ok(cur == ['68636', 'Lucio Diaz', 'crm'], f'la ficha a la vista del CRM es el cliente actual, aunque la dirección haya quedado vieja y haya otra ficha escondida ({cur})')
            ok(await A2.evaluate("cur") == 'cliente' and await A2.locator('#nbCli').inner_text() == '68636', 'Vitalis pasa solo a la sección Cliente, con el ID en el menú')
            ok('cliente actual: 68636' in await Nv.evaluate("(document.getElementById('vitalis-cur-pill')||{shadowRoot:{textContent:''}}).shadowRoot.textContent"), 'y el CRM avisa que lo tomó')
            t0 = await Nv.evaluate("performance.now()")
            await Nv.evaluate("document.getElementById('fic').innerHTML=__mk('68700','Marta Gomez')")
            await A2.wait_for_function("curCl&&curCl.id==='68700'", timeout=4000)
            dt = await Nv.evaluate("performance.now()") - t0
            ok(await A2.evaluate("[curCl.name,cur,document.getElementById('nbCli').textContent]") == ['Marta Gomez', 'cliente', '68700'], 'al abrir otro cliente en el CRM, Vitalis cambia solo, sin refrescar')
            ok(dt < 2500, f'enseguida ({dt:.0f} ms)')
            # el ID en una tabla de datos ("ID" en una celda y el número en la de al lado) y el "ID" puesto por el estilo
            await Nv.evaluate("document.getElementById('fic').innerHTML='<table class=desc><tr><th>Name</th><td>Rosa Prueba</td></tr><tr><th>ID</th><td>68801</td><th>Server</th><td>Stock</td></tr></table><div class=calls><button>Omega - 9944418</button></div>'")
            await A2.wait_for_function("curCl&&curCl.id==='68801'", timeout=4000)
            ok(True, 'el ID en una tabla de datos de la ficha')
            await Nv.evaluate("document.getElementById('fic').innerHTML='<style>.uidb::before{content:\"ID \"}</style><div class=hd><b>Pedro Prueba</b><div class=uidb>68902</div></div><div class=calls><button>Gizat - 1371</button></div>'")
            await A2.wait_for_function("curCl&&curCl.id==='68902'", timeout=4000)
            ok(await A2.evaluate("curCl.name") == 'Pedro Prueba', 'y el "ID" puesto por el estilo, con su nombre')
            # se cierra la ficha: no vuelve a la vieja escondida ni al de la dirección vieja
            await Nv.evaluate("document.getElementById('fic').remove()"); await Nv.wait_for_timeout(2200)
            ok(await A2.evaluate("curCl.id") == '68902', f'al cerrar la ficha queda el último (no la vieja escondida ni el de la dirección vieja) ({await A2.evaluate("curCl.id")})')
            # sin encontrar el ID de una ficha con botones: el CRM ofrece copiar un diagnóstico sin datos del cliente
            await Nv.evaluate("()=>{const d=document.createElement('div');d.id='fic';d.innerHTML='<div class=hd><b>Juan Raro</b><div>Ref 12</div></div><div class=calls><button>Voiso LATAM - 3262</button></div>';document.body.prepend(d)}"); await Nv.wait_for_timeout(4500)
            pill = await Nv.evaluate("(document.getElementById('vitalis-cur-pill')||{shadowRoot:{textContent:''}}).shadowRoot.textContent")
            ok('no encuentro el ID' in pill and 'Copiar diagnóstico' in pill, f'si no encuentra el ID de la ficha, ofrece copiar un diagnóstico ({pill!r})')
            try:
                await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin='https://crmnovaramarkets.com')
                await Nv.evaluate("document.getElementById('vitalis-cur-pill').shadowRoot.querySelector('button').click()"); await Nv.wait_for_timeout(500)
                dg = await Nv.evaluate("navigator.clipboard.readText()")
            except Exception as e:
                dg = f'ERR {e}'
            ok('Voiso' in dg and 'calls' in dg and 'Juan' not in dg and 'Raro' not in dg and 'xxxx' in dg, f'el diagnóstico tiene la forma de la ficha y ningún dato del cliente ({dg[:160]!r})')
            await Nv.evaluate("()=>{document.getElementById('fic').remove();document.getElementById('oldDrw').remove();history.replaceState(null,'',location.pathname);document.getElementById('vitalis-cur-pill')&&document.getElementById('vitalis-cur-pill').remove()}"); await Nv.wait_for_timeout(800)
            # una pestaña con "Status" (el de registro) y "Sales Status": vale el de venta; el CRM en español es el mismo status.
            # Una tabla de transacciones (Success, TimeOut…) no es una lista de clientes: no entra nadie ni pide diagnóstico
            Nd = await ctx.new_page(); await Nd.goto('https://crmnovaramarkets.com/novara-dos'); Nt = await ctx.new_page(); await Nt.goto('https://crmnovaramarkets.com/novara-trx')
            await Nd.wait_for_timeout(4500)
            st = {x['client_id']: x['status'] for x in sql("select client_id, status from public.crm_clients where client_id like '8802%' or client_id like '8803%'")}
            ok(st == {'880201': 'Call Again', '880202': 'Call Again', '880203': 'NA - DAY2'}, f'con "Status" de registro y "Sales Status", vale el de venta, y "Llamar de nuevo" es Call Again ({st})')
            ok(await Nt.locator('#ftd-crm-button').count() == 0, 'la tabla de transacciones no es una lista de clientes (ni pide diagnóstico)')
            await Nd.close(); await Nt.close()
            # al actualizar la extensión, la copia nueva entra en la pestaña abierta y la vieja se apaga (sin recargar el CRM)
            await sw.evaluate("chrome.tabs.query({url:'https://crmnovaramarkets.com/novara'}).then(([t])=>chrome.scripting.executeScript({target:{tabId:t.id,allFrames:true},files:['crm.js']}))"); await Nv.wait_for_timeout(1500)
            ok(await Nv.locator('#ftd-crm-button').count() == 1, 'al actualizar, la copia nueva reemplaza a la vieja: un solo panel')
            await Nv.evaluate("()=>{const td=[...document.querySelectorAll('.dx-data-row td')].find(t=>t.textContent==='NA - DAY2');td.textContent='Call Again'}"); await Nv.wait_for_timeout(3000)
            ok(sql("select status_group g from public.crm_clients where client_id='880102'")[0]['g'] == 'call_again', 'y sigue mandando los cambios de status')
            # si la tabla cambia y no leo las filas, el panel ofrece copiar un diagnóstico sin datos de clientes
            await Nv.evaluate("()=>document.querySelectorAll('.dx-datagrid-rowsview .dx-data-row').forEach(r=>{r.querySelectorAll('td').forEach(c=>c.removeAttribute('role'));r.insertAdjacentHTML('beforeend','<td>a</td><td>b</td><td>c</td>')})"); await Nv.wait_for_timeout(1500)
            ok(await nvp.locator('[data-diag]').count() == 1 and 'no leo las filas' in await nvp.locator('#wids').inner_text(), 'si la tabla cambia y no leo las filas, el panel ofrece copiar un diagnóstico')
            await Nv.screenshot(path=OUT / 'x2d_crm_diagnostico.png')
            await Nv.close()
            # se actualiza solo la pestaña que elegís; esa avisa de los new y Vitalis abre la ficha cuando volvés
            cpn = C.locator('#ftd-crm-button')
            ok('Actualizar esta pestaña' in await cpn.locator('#wbtn').inner_text(), 'ninguna pestaña se actualiza sola hasta que elegís una')
            await cpn.locator('#wbtn').click(); await C.wait_for_timeout(1500)
            ok('se actualiza sola' in (await cpn.locator('#wst').inner_text()).lower() and 'Dejar de actualizar' in await cpn.locator('#wbtn').inner_text(), 'la elegida se actualiza sola')
            await A2.evaluate('document.hasFocus=()=>false')
            await C.evaluate("""() => { document.querySelector('tbody').insertAdjacentHTML('beforeend', '<tr><td>555006</td><td>Rita Nueva</td><td>Chile</td><td>New</td><td>17/11/2026 13:00</td></tr>'); }""")
            await C.wait_for_timeout(3500)
            await A2.evaluate("document.hasFocus=()=>true;dispatchEvent(new Event('focus'))"); await A2.wait_for_timeout(3000)
            fi = await A2.inner_text('#v-cliente') if await A2.is_visible('#v-cliente') else ''
            ok('entró un new' in fi and 'Rita Nueva' in fi and 'Chile' in fi, f'al volver a Vitalis, el new está en la sección Cliente ({fi[:120]!r})')
            await A2.screenshot(path=OUT / 'x11_ficha_new.png')
            await A2.keyboard.press('Escape'); await A2.wait_for_timeout(300)
            await A2.evaluate("(()=>{const h=document.getElementById('ftd-agenda-overlay');if(h)h.remove()})()")
            # un Talking que desaparece de la lista que se actualiza: en Vitalis deja de ser new
            await C.evaluate("() => { document.querySelector('tbody').insertAdjacentHTML('afterbegin', '<tr id=tk><td>555007</td><td>Tito Habla</td><td>Peru</td><td>Talking</td><td>17/11/2026 13:10</td></tr>'); }")
            await C.wait_for_timeout(3000)
            ok(sql("select status from public.crm_clients where client_id='555007'")[0]['status'] == 'Talking', 'el Talking llega al registro')
            await C.evaluate("document.getElementById('tk').remove()"); await C.wait_for_timeout(3000)
            ok(sql("select left_new_at from public.crm_clients where client_id='555007'")[0]['left_new_at'] is None, 'recién desaparecido, todavía no (puede ser la lista recargando)')
            await C.wait_for_timeout(11000); await C.evaluate("document.querySelector('h3').textContent='Clients '"); await C.wait_for_timeout(3000)
            ok(sql("select left_new_at from public.crm_clients where client_id='555007'")[0]['left_new_at'] is not None, 'a los 12 s sin aparecer, sale de Talking en Vitalis')
            await A2.evaluate('crmLoad(true)'); await A2.wait_for_timeout(1500)
            ok(await A2.evaluate("!queueOf(null).g1.some(r=>r.id==='555007')"), 'y ya no está entre los new de la cola')
            await cpn.locator('#wbtn').click(); await C.wait_for_timeout(1000)
            ok(await sw.evaluate("chrome.storage.local.get('watches').then(s=>Object.keys(s.watches||{}).length)") == 0, '"Dejar de actualizar" la libera')
            # aviso de prueba (tarjeta en la pestaña)
            await A2.evaluate("go('config')"); await A2.wait_for_timeout(400)
            await A2.click('[data-act=probarAviso]'); await A2.wait_for_timeout(2500)
            await A2.screenshot(path=OUT / 'x4_aviso.png')
            ok(await A2.evaluate("!!document.getElementById('ftd-agenda-overlay')"), 'el aviso de prueba muestra la tarjeta')
            await A2.evaluate("(()=>{const h=document.getElementById('ftd-agenda-overlay');if(h)h.remove()})()")

            # el team leader pasa las ventas de toda la mesa desde el CRM de Trade24Seven
            await A2.evaluate('sb.auth.signOut()'); await A2.wait_for_timeout(500)
            await A2.reload(); await A2.wait_for_timeout(1800)
            await A2.click('.person:has-text("Matias Me")'); await A2.keyboard.type('0000'); await A2.wait_for_timeout(1500)
            await A2.keyboard.type('2468'); await A2.wait_for_timeout(300); await A2.keyboard.type('2468'); await A2.wait_for_timeout(3000)
            ok(await A2.evaluate("ready&&profile.role==='leader'"), 'entra el team leader')
            st = await sw.evaluate("chrome.storage.local.get('desk')")
            ok(st.get('desk', {}).get('role') == 'leader' and len(st['desk'].get('members', [])) == 13, 'la extensión sabe que es team leader y conoce la mesa')
            G = await ctx.new_page()
            await G.goto('https://crmtrade24seven.com/#/bank-transactions'); await G.wait_for_timeout(3000)
            panel = G.locator('#ftd-crm-button')
            r = sql("select client_id, brand, (select name from public.profiles where id=user_id) who from public.sales where client_id like '7770%' order by client_id")
            ok([(x['client_id'], x['who']) for x in r] == [('777001', 'Sofía Ar'), ('777002', 'Mateo He'), ('777003', 'Fulano Externo'), ('777005', 'Mauricio Gomez')], f'con la columna Sales Rep se pasan solas, cada una a su vendedor, sin tocar nada ({r})')
            fm = sql("select name, active, former, crm_name from public.profiles where former order by name")
            ok([(x['name'], x['active'], x['crm_name']) for x in fm] == [('Fulano Externo', False, 'Fulano Externo'), ('Mauricio Gomez', False, 'Mauricio Gomez')], f'los que no están en la mesa quedan como desvinculados (y Mauricio Gomez no es Mauricio Mo) ({fm})')
            ok(await A2.locator('#toasts [data-key=formers]').count() == 1 and 'Fulano Externo' in await A2.inner_text('#toasts [data-key=formers]'), 'Vitalis avisa quiénes entraron como desvinculados')
            ok(not await panel.locator('#whoRow').is_visible(), 'con Sales Rep no hay "De" para elegir')
            t = await panel.locator('.box').inner_text()
            ok('Se pasan solas' in t and 'Sales Rep' in t and 'desvinculados' in t, f'el panel lo dice ({t!r})')
            ok('Asignar 1 venta sin vendedor' in await panel.locator('#go').inner_text(), 'la que no es de nadie de la mesa queda para asignar')
            await G.screenshot(path=OUT / 'x5_crm_leader.png')
            ok(sql("select count(*)::int c from public.sales where client_id='777004'")[0]['c'] == 0, 'las rechazadas no pasan')
            # "Asignar": va a Vitalis y ahí se elige a quién
            await panel.locator('#go').click(); await G.wait_for_timeout(2500)
            await A2.bring_to_front(); await A2.wait_for_timeout(300)
            ok(await A2.locator('#toasts [data-key=asignar]').count() == 1, 'en Vitalis queda para asignar')
            matias = sql("select id from public.profiles where name='Matias Me'")[0]['id']
            await A2.click('#toasts [data-key=asignar] .btn'); await A2.wait_for_timeout(400)
            await A2.select_option('.mbox [data-an="0"]', matias); await A2.click('.mbox .mf .pri'); await A2.wait_for_timeout(1500)
            r = sql("select (select name from public.profiles where id=user_id) who from public.sales where client_id='777006'")
            ok(len(r) == 1 and r[0]['who'] == 'Matias Me', f'la que no tiene vendedor se asigna a mano desde Vitalis ({r})')
            # un desvinculado que en realidad era alguien de la mesa: se unen
            await A2.evaluate("go('config')"); await A2.wait_for_timeout(500)
            ok('Fulano Externo' in await A2.inner_text('#cfFormers') and 'Fulano Externo' not in await A2.inner_text('#cfMembers'), 'en Ajustes los desvinculados van aparte')
            await A2.screenshot(path=OUT / 'x5b_desvinculados.png', full_page=True)
            await A2.click('#cfFormers [data-act=formers]'); await A2.wait_for_timeout(400)
            dahi = sql("select id from public.profiles where name='Dahiana Le'")[0]['id']
            fid = sql("select id from public.profiles where name='Fulano Externo'")[0]['id']
            await A2.select_option(f'.mbox [data-fm="{fid}"]', dahi); await A2.click('.mbox .mf .pri'); await A2.wait_for_timeout(2000)
            r = sql("select (select name from public.profiles where id=user_id) who from public.sales where client_id='777003'")
            ok(r and r[0]['who'] == 'Dahiana Le' and sql("select count(*)::int c from public.profiles where name='Fulano Externo'")[0]['c'] == 0, f'"era Dahiana": su venta pasa a ella y el desvinculado se borra ({r})')
            ok(sql("select crm_name from public.profiles where name='Dahiana Le'")[0]['crm_name'] == 'Fulano Externo', 'y queda guardado para la próxima')
            # una tabla sin columna de vendedor: "De" aparece y por defecto es "Yo"
            G2 = await ctx.new_page()
            await G2.goto('https://crmtrade24seven.com/sinrep'); await G2.wait_for_timeout(3500)
            p2 = G2.locator('#ftd-crm-button')
            ok(await p2.locator('#whoRow').is_visible() and await p2.locator('#who').input_value() == matias, 'sin columna de vendedor: "De" con "Yo" por defecto')
            ok(sql("select count(*)::int c from public.sales where client_id='777101'")[0]['c'] == 0, 'y no se pasan solas')
            await p2.locator('#go').click(); await G2.wait_for_timeout(3000)
            r = sql("select (select name from public.profiles where id=user_id) who from public.sales where client_id='777101'")
            ok(len(r) == 1 and r[0]['who'] == 'Matias Me', f'el botón las pasa a quien está en "De" ({r})')
            await G2.close()

            # social: aviso en la pestaña activa y la respuesta vuelve a Vitalis
            await F.bring_to_front(); await F.wait_for_timeout(500)
            await A2.evaluate('document.hasFocus=()=>false') # en headless todas las pestañas tienen foco: simulo que Vitalis quedó atrás
            sql("insert into public.pings (team_id,from_id,to_id,kind) select p.team_id, p.id, (select id from public.profiles where name='Matias Me'), 'd10' from public.profiles p where p.name='Joaquín Or'")
            await A2.evaluate('socialPoll()'); await F.wait_for_timeout(2500)
            card = F.locator('#ftd-agenda-overlay .card.social')
            ok(await card.count() == 1, 'el pedido social aparece como tarjeta en la pestaña donde estás')
            await F.screenshot(path=OUT / 'x7_social_tarjeta.png')
            await card.locator('[data-a="r:si"]').click(); await F.wait_for_timeout(3000)
            r = sql("select reply, (select name from public.profiles where id=reply_by) who from public.pings where kind='d10'")
            ok(r and r[0]['reply'] == 'si' and r[0]['who'] == 'Matias Me', f'contestar desde la tarjeta responde en Vitalis ({r})')

            # chat: el mensaje aparece como tarjeta en la pestaña activa y "Abrir chat" lleva a Vitalis
            sql("insert into public.messages (chat_id, user_id, body) select c.id, p.id, 'Matias, ¿me pasás el link del CRM?' from public.chats c, public.profiles p where c.kind='team' and p.name='Joaquín Or'")
            await F.bring_to_front(); await A2.evaluate("go('inicio')"); await F.wait_for_timeout(300)
            await A2.evaluate('catchUp(true)'); await F.wait_for_timeout(2500)
            card = F.locator('#ftd-agenda-overlay .card.social:has-text("link del CRM")')
            ok(await card.count() == 1 and 'Toda la mesa' in await card.inner_text(), 'un mensaje del chat aparece como tarjeta donde estés')
            ok('info' in (await card.get_attribute('class')), 'el chat va como normal (celeste)')
            sql("insert into public.messages (chat_id, user_id, body) select c.id, p.id, 'Es urgente' from public.chats c, public.profiles p where c.kind='team' and p.name='Joaquín Or'")
            await A2.evaluate('catchUp(true)'); await F.wait_for_timeout(2500)
            cards = F.locator('#ftd-agenda-overlay .card.social:has-text("Toda la mesa")')
            ok(await cards.count() == 1 and 'Es urgente' in await cards.inner_text(), 'otro mensaje del mismo chat actualiza la misma tarjeta (no se apilan)')
            await F.screenshot(path=OUT / 'x8_chat_tarjeta.png')
            await cards.locator('[data-a=open]').click(); await F.wait_for_timeout(2500)
            ok(await A2.evaluate("cur") == 'chat' and 'Es urgente' in await A2.inner_text('#chMsgs'), '"Abrir chat" abre Vitalis en ese chat')
            # tarea nueva: tarjeta en la pestaña activa y "Ya la hice" la marca en Vitalis
            sql("insert into public.tasks (team_id, created_by, what, campaigns, status) select team_id, id, 'Repasar', array['Google ES'], 'No answer' from public.profiles where name='Sofía Ar'")
            sql("insert into public.task_people (task_id, user_id) select t.id, p.id from public.tasks t, public.profiles p where p.name='Matias Me'")
            await F.bring_to_front(); await A2.evaluate("go('inicio')")
            await A2.evaluate('catchUp(true)'); await F.wait_for_timeout(2500)
            card = F.locator('#ftd-agenda-overlay .card.social:has-text("Tarea nueva")')
            ok(await card.count() == 1 and 'Google ES' in await card.inner_text(), 'una tarea nueva aparece como tarjeta donde estés')
            ok('imp' in (await card.get_attribute('class')), 'la tarea va como importante (naranja)')
            await F.screenshot(path=OUT / 'x9_tarea_tarjeta.png')
            await card.locator('[data-a="r:done"]').click(); await F.wait_for_timeout(2500)
            ok(sql("select done_at is not null d from public.task_people")[0]['d'], '"Ya la hice" desde la tarjeta la marca hecha en Vitalis')
            # en Voiso (el softphone) no aparece la tarjeta: espera a la próxima pestaña
            Vo = await ctx.new_page(); await Vo.goto('https://cc-dal01.voiso.com/agent_workspace'); await Vo.wait_for_timeout(800)
            await Vo.bring_to_front(); await Vo.wait_for_timeout(300)
            sql("insert into public.messages (chat_id, user_id, body) select c.id, p.id, 'no podrías tener campañas' from public.chats c, public.profiles p where c.kind='team' and p.name='Joaquín Or'")
            await A2.evaluate('catchUp(true)'); await Vo.wait_for_timeout(2500)
            ok(not await Vo.evaluate("!!document.getElementById('ftd-agenda-overlay')"), 'en Voiso no aparece la tarjeta')
            await Vo.screenshot(path=OUT / 'x10_voiso_sin_tarjeta.png')
            await F.bring_to_front(); await F.wait_for_timeout(1500)
            ok(await F.locator('#ftd-agenda-overlay .card.social:has-text("campañas")').count() == 1, 'y aparece al pasar a otra pestaña')
            await Vo.close()

            # los avisos quedan hasta que los cierres: sincronizar con Vitalis no los saca; los mensajes del chat sí se van solos
            sql("insert into public.tasks (team_id, created_by, what, campaigns, status) select team_id, id, 'Llamar news', array['Meta CL'], 'New' from public.profiles where name='Sofía Ar'")
            sql("insert into public.task_people (task_id, user_id) select t.id, p.id from public.tasks t, public.profiles p where p.name='Matias Me' and t.what='Llamar news'")
            await A2.evaluate('catchUp(true)'); await F.wait_for_timeout(2500)
            tcard = F.locator('#ftd-agenda-overlay .card.social:has-text("Meta CL")')
            ok(await tcard.count() == 1, 'otra tarea: su tarjeta aparece')
            await sw.evaluate("alertCard({k:'crm:t1',kind:'crm',title:'Cliente nuevo en el CRM',id:'990001',kw:'Prueba Nueva',meta:'Chile',btns:[['crm','Ver en el CRM',1],['close','Ok']]},null)")
            await A2.evaluate("extSig='';syncExt()"); await F.wait_for_timeout(1500)
            await A2.evaluate("extSig='';syncExt()"); await F.wait_for_timeout(1500)
            ok(await tcard.count() == 1 and await F.locator('#ftd-agenda-overlay .card.crm:has-text("990001")').count() == 1, 'sincronizar con Vitalis no saca las tarjetas de tareas ni de clientes nuevos')
            await F.mouse.move(20, 700) # con el mouse encima la tarjeta espera
            await F.wait_for_timeout(7500)
            ok(await F.locator('#ftd-agenda-overlay .card.social:has-text("campañas")').count() == 0, 'el mensaje del chat se va solo a los segundos')
            ok(await tcard.count() == 1 and await F.locator('#ftd-agenda-overlay .card.crm:has-text("990001")').count() == 1, 'la tarea y el cliente nuevo siguen ahí hasta que los cierres')
            F2 = await ctx.new_page(); await F2.goto('https://example.test/otra'); await F2.bring_to_front(); await F2.wait_for_timeout(1500)
            nl = await sw.evaluate("liveNow().then(l=>l.length)")
            ok(nl >= 2 and await F2.locator('#ftd-agenda-overlay .card').count() == nl and await F2.locator('#ftd-agenda-overlay .card:has-text("campañas")').count() == 0, f'y te siguen a la pestaña que abras, sin el mensaje del chat ({nl})')
            for _ in range(nl):
                await F2.locator('#ftd-agenda-overlay .card .x').first.click(); await F2.wait_for_timeout(700)
            ok(await sw.evaluate("liveNow().then(l=>l.length)") == 0, 'al cerrarlas, no queda ninguna pendiente')
            await F2.close(); await F.bring_to_front(); await F.wait_for_timeout(600)
            ok(await F.locator('#ftd-agenda-overlay .card').count() == 0, 'y se van también de las otras pestañas')
            # tres tandas de clientes a la vez (una lista grande, o dos pestañas): no se pisan en la cola
            await sw.evaluate("Promise.all([0,1,2].map(b=>crmSeen(Array.from({length:120},(_,i)=>({id:String(661000+b*1000+i),brand:'Novara Markets',name:'Tanda '+b,status:'No Answer',reg:'2026-11-18 10:00'})))))")
            await F.wait_for_timeout(4000)
            ok(sql("select count(*)::int c from public.crm_clients where name like 'Tanda %'")[0]['c'] == 360, 'tres tandas de clientes al mismo tiempo llegan enteras (360)')

            # una sola pestaña del CRM se actualiza: la que elegís; mientras exista, ninguna otra la reemplaza (para un agente)
            asAgent = "chrome.storage.local.get('desk').then(s=>chrome.storage.local.set({desk:{...(s.desk||{}),role:'agent'}}))"
            await sw.evaluate(asAgent)
            Wp = await ctx.new_page()
            await Wp.goto('https://crmnovaramarkets.com/clients'); await Wp.wait_for_timeout(2500)
            Wp2 = await ctx.new_page()
            await Wp2.goto('https://crmnovaramarkets.com/clients?b'); await Wp2.wait_for_timeout(2500)
            wpn, wpn2 = Wp.locator('#ftd-crm-button'), Wp2.locator('#ftd-crm-button')
            await sw.evaluate(asAgent); await wpn.locator('#wbtn').click(); await Wp.wait_for_timeout(1500)
            t2 = await wpn2.locator('#wst').inner_text()
            ok('otra pestaña' in t2 and 'Ir a esa' in await wpn2.locator('#wbtn').inner_text(), f'la otra pestaña dice que ya se actualiza otra ({t2!r})')
            await sw.evaluate(asAgent)
            ok((await sw.evaluate(f"chrome.tabs.query({{url:'https://crmnovaramarkets.com/clients?b'}}).then(([t])=>watchStart(t))")).get('busy'), 'y no se puede elegir mientras la primera exista')
            await Wp.evaluate('window.__clicks=0'); await Wp2.evaluate('window.__clicks=0')
            await F.bring_to_front(); await F.wait_for_timeout(22000)  # el clic en el botón cuenta como uso: la primera vuelta se saltea
            ok(await Wp.evaluate('window.__clicks||0') >= 1, 'la elegida se actualiza sola (toca el botón de actualizar del CRM)')
            ok(await Wp2.evaluate('window.__clicks||0') == 0, 'la otra no se recarga: queda para sumar clientes')
            ws = await sw.evaluate("chrome.storage.local.get('watches').then(s=>Object.keys(s.watches||{}).length)")
            ok(ws == 1, f'una sola pestaña vigilada ({ws})')
            # la pestaña que se actualiza sola para los news no cambia el cliente actual; las demás sí
            await A2.evaluate("setCurrent('555001','Antes','lista')"); await A2.wait_for_timeout(300)
            panel = "(id)=>{const d=document.createElement('div');d.innerHTML='<div class=hd><div>Cli '+id+'</div><div class=sub>ID <span>'+id+'</span></div></div>';document.body.appendChild(d)}"
            await Wp.bring_to_front(); await Wp.evaluate(panel, '71111'); await Wp.wait_for_timeout(2500)
            ok(await A2.evaluate("curCl&&curCl.id") == '555001', 'la pestaña de los news no cambia el cliente actual')
            await Wp2.bring_to_front(); await Wp2.evaluate(panel, '72222'); await Wp2.wait_for_timeout(2500)
            ok(await A2.evaluate("curCl&&curCl.id") == '72222', 'otra pestaña del CRM sí lo cambia')
            ok(await sw.evaluate("chrome.storage.local.get('watches').then(s=>Object.values(s.watches)[0].tabId).then(id=>chrome.tabs.get(id)).then(t=>t.autoDiscardable===false)"), 'y Chrome no la duerme')
            await Wp.screenshot(path=OUT / 'x10_crm_sola.png'); await Wp2.screenshot(path=OUT / 'x10b_crm_otra.png')
            await Wp.close(); await F.wait_for_timeout(1500)
            ok('Actualizar esta pestaña' in await wpn2.locator('#wbtn').inner_text(), 'al cerrar la elegida, la otra se puede elegir')
            await Wp2.close(); await F.wait_for_timeout(500)
            # el team leader puede tener varias pestañas actualizándose (sin avisos de new)
            desk0 = await sw.evaluate("chrome.storage.local.get('desk').then(s=>s.desk||null)")
            await sw.evaluate("chrome.storage.local.get('desk').then(s=>chrome.storage.local.set({desk:{...(s.desk||{}),role:'leader'}}))")
            L1 = await ctx.new_page(); await L1.goto('https://crmnovaramarkets.com/clients?l1'); await L1.wait_for_timeout(2500)
            L2 = await ctx.new_page(); await L2.goto('https://crmnovaramarkets.com/clients?l2'); await L2.wait_for_timeout(2500)
            await L1.locator('#ftd-crm-button #wbtn').click(); await L1.wait_for_timeout(1200)
            ok('también' in await L2.locator('#ftd-crm-button #wbtn').inner_text(), 'team leader: la otra pestaña ofrece actualizarse también')
            await L2.locator('#ftd-crm-button #wbtn').click(); await L2.wait_for_timeout(1200)
            ws = await sw.evaluate("chrome.storage.local.get('watches').then(s=>Object.keys(s.watches||{}).length)")
            ok(ws == 2 and '2 pestañas' in await L1.locator('#ftd-crm-button #wst').inner_text(), f'y quedan las dos actualizándose ({ws})')
            await L1.close(); await L2.close(); await F.wait_for_timeout(800)
            # el CRM del team leader se actualiza con "Refresh": nunca toca "Search" (el de un agente, sí)
            TLp = await ctx.new_page(); await TLp.goto('https://crmnovaramarkets.com/tl'); await TLp.wait_for_timeout(2500)
            send = "chrome.tabs.query({url:'https://crmnovaramarkets.com/tl'}).then(([t])=>chrome.tabs.sendMessage(t.id,{type:'crm-refresh'}))"
            r1 = await sw.evaluate(send); await TLp.wait_for_timeout(500)
            ok(r1.get('clicked') == 'Refresh' and await TLp.evaluate('[window.__r||0, window.__s||0]') == [1, 0], f'team leader: toca Refresh, nunca Search ({r1})')
            await sw.evaluate(asAgent); await TLp.wait_for_timeout(800)
            r2 = await sw.evaluate(send); await TLp.wait_for_timeout(500)
            ok(r2.get('clicked') == 'Search' and await TLp.evaluate('[window.__r||0, window.__s||0]') == [1, 1], f'un agente sigue tocando Search ({r2})')
            await TLp.close()
            await sw.evaluate(f"chrome.storage.local.set({{desk:{json.dumps(desk0)}}})")

            # la extensión despierta a Vitalis en segundo plano para ponerse al día
            await A2.evaluate("window.__ticks=0;addEventListener('message',e=>{if(e.data&&e.data.type==='ftd-agenda-tick')window.__ticks++})")
            await sw.evaluate('tickVitalis()'); await A2.wait_for_timeout(800)
            ok(await A2.evaluate('window.__ticks') >= 1, 'la extensión despierta a Vitalis cada 30 s')
            ok(await sw.evaluate("chrome.alarms.get('vt').then(a=>!!a&&a.periodInMinutes===0.5)"), 'con una alarma de 30 s')
            await ctx.close()
    finally:
        srv.terminate()
    print('\nerrores de la página:', errs or 'ninguno')
    print(f'\n{len(fails)} FALLAS' if fails else '\nTodo OK')
    sys.exit(1 if fails or errs else 0)
asyncio.run(main())

# Prueba la extensión de Chrome con Vitalis (base de prueba server.mjs):
# snippets con /atajo en otra página y clientes "new" del CRM que llegan al registro.
# Uso: cd test && python3 e2e_ext.py   → capturas en test/shots/
import asyncio, subprocess, time, json, urllib.request, pathlib, sys, tempfile
from playwright.async_api import async_playwright
PORT = 54420
LOCAL = f'http://localhost:{PORT}'
APP = 'https://vitaliscrm.netlify.app/'
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
<input id="pw" type="password"><input id="no" data-vitalis-nosnip></body>'''
CRM = '''<!doctype html><meta charset="utf-8"><title>CRM · Clients</title><body style="font:14px system-ui;padding:20px"><h3>Clients</h3>
<table border="1" cellpadding="6"><thead><tr><th>Client ID</th><th>Full Name</th><th>Country</th><th>Status</th><th>Registration Time</th></tr></thead><tbody>
<tr><td>555001</td><td>Lucía Pérez</td><td>Peru</td><td>New</td><td>17/11/2026 10:02</td></tr>
<tr><td>555002</td><td>Jorge Díaz</td><td>Chile</td><td>New</td><td>17/11/2026 10:40</td></tr>
<tr><td>555003</td><td>Ana Gómez</td><td>Mexico</td><td>No answer</td><td>16/11/2026 18:00</td></tr>
</tbody></table></body>'''
T24 = '''<!doctype html><meta charset="utf-8"><title>CRM · Bank transactions</title><body style="font:14px system-ui;padding:20px"><h3>Bank transactions</h3>
<table border="1" cellpadding="6"><thead><tr><th>Status</th><th>Time of FTD</th><th>User ID</th><th>Full Name</th><th>Country</th><th>Amount</th><th>Transaction ID</th><th>Agent</th></tr></thead><tbody>
<tr><td>Approved</td><td>17/11/2026 10:15</td><td>777001</td><td>Carla Núñez</td><td>Peru</td><td>250</td><td>TX777001</td><td>Sofia Arias</td></tr>
<tr><td>Approved</td><td>17/11/2026 11:20</td><td>777002</td><td>Diego Soto</td><td>Chile</td><td>300</td><td>TX777002</td><td>Mateo Herrera</td></tr>
<tr><td>Approved</td><td>17/11/2026 12:05</td><td>777003</td><td>Rosa Paz</td><td>Mexico</td><td>200</td><td>TX777003</td><td>Fulano Externo</td></tr>
<tr><td>Declined</td><td>17/11/2026 12:30</td><td>777004</td><td>Luis Mora</td><td>Peru</td><td>100</td><td>TX777004</td><td>Sofia Arias</td></tr>
</tbody></table></body>'''

async def main():
    srv = subprocess.Popen(['node', 'server.mjs', str(PORT)], cwd=pathlib.Path(__file__).parent, stdout=subprocess.PIPE, stderr=subprocess.STDOUT); time.sleep(5)
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
                await to_local(route, path)
            await ctx.route(APP + '**', app)
            await ctx.route(API + '/**', lambda route: to_local(route, route.request.url[len(API):]))
            await ctx.route('https://example.test/**', lambda r: r.fulfill(status=200, content_type='text/html', body=FORM))
            await ctx.route('https://crmnovaramarkets.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=CRM))
            await ctx.route('https://crmtrade24seven.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=T24))
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
            await A2.keyboard.press('3'); await A2.wait_for_timeout(600)
            await A2.screenshot(path=OUT / 'x3_clientes_desde_crm.png')
            # aviso de prueba (tarjeta en la pestaña)
            await A2.keyboard.press('9'); await A2.wait_for_timeout(400)
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
            ok(await panel.locator('#whoRow').is_visible(), 'el panel del CRM muestra "De" para el team leader')
            ok(await panel.locator('#who').input_value() == 'col', 'por defecto: cada venta según la columna de agente')
            await G.screenshot(path=OUT / 'x5_crm_leader.png')
            await panel.locator('#go').click(); await G.wait_for_timeout(3500)
            r = sql("select client_id, brand, (select name from public.profiles where id=user_id) who from public.sales where client_id like '7770%' order by client_id")
            ok([(x['client_id'], x['who'], x['brand']) for x in r] == [('777001', 'Sofía Ar', 'Trade24Seven'), ('777002', 'Mateo He', 'Trade24Seven')], f'cada venta a su vendedor, marca Trade24Seven ({r})')
            m = await panel.locator('#msg').inner_text()
            ok('sin vendedor' in m, f'avisa la que quedó sin vendedor ({m!r})')
            await G.screenshot(path=OUT / 'x6_crm_leader_pasadas.png')
            matias = sql("select id from public.profiles where name='Matias Me'")[0]['id']
            await panel.locator('#who').select_option(matias); await G.wait_for_timeout(300)
            await panel.locator('#go').click(); await G.wait_for_timeout(3000)
            r = sql("select (select name from public.profiles where id=user_id) who from public.sales where client_id='777003'")
            ok(len(r) == 1 and r[0]['who'] == 'Matias Me', f'eligiendo a alguien en "De" van a esa persona ({r})')
            ok(sql("select count(*)::int c from public.sales where client_id='777004'")[0]['c'] == 0, 'las rechazadas no pasan')

            # social: aviso en la pestaña activa y la respuesta vuelve a Vitalis
            sql("insert into public.pings (team_id,from_id,to_id,kind) select p.team_id, p.id, (select id from public.profiles where name='Matias Me'), 'd10' from public.profiles p where p.name='Joaquín Or'")
            await F.bring_to_front(); await F.wait_for_timeout(500)
            await A2.evaluate('document.hasFocus=()=>false') # en headless todas las pestañas tienen foco: simulo que Vitalis quedó atrás
            await A2.evaluate('socialPoll()'); await F.wait_for_timeout(2500)
            card = F.locator('#ftd-agenda-overlay .card.social')
            ok(await card.count() == 1, 'el pedido social aparece como tarjeta en la pestaña donde estás')
            await F.screenshot(path=OUT / 'x7_social_tarjeta.png')
            await card.locator('[data-a="r:si"]').click(); await F.wait_for_timeout(3000)
            r = sql("select reply, (select name from public.profiles where id=reply_by) who from public.pings where kind='d10'")
            ok(r and r[0]['reply'] == 'si' and r[0]['who'] == 'Matias Me', f'contestar desde la tarjeta responde en Vitalis ({r})')
            await ctx.close()
    finally:
        srv.terminate()
    print('\nerrores de la página:', errs or 'ninguno')
    print(f'\n{len(fails)} FALLAS' if fails else '\nTodo OK')
    sys.exit(1 if fails or errs else 0)
asyncio.run(main())

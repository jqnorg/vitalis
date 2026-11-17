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
            sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
            ok('chrome-extension://' in sw.url, 'la extensión cargó')

            A = await ctx.new_page()
            A.on('pageerror', lambda e: errs.append('A ' + str(e)))
            await A.goto(APP + '#mesa=MATIAS-TEST'); await A.wait_for_timeout(1500)
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
            await A2.keyboard.press('8'); await A2.wait_for_timeout(400)
            await A2.click('[data-act=probarAviso]'); await A2.wait_for_timeout(2500)
            await A2.screenshot(path=OUT / 'x4_aviso.png')
            ok(await A2.evaluate("!!document.getElementById('ftd-agenda-overlay')"), 'el aviso de prueba muestra la tarjeta')
            await ctx.close()
    finally:
        srv.terminate()
    print('\nerrores de la página:', errs or 'ninguno')
    print(f'\n{len(fails)} FALLAS' if fails else '\nTodo OK')
    sys.exit(1 if fails or errs else 0)
asyncio.run(main())

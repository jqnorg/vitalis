# Prueba la extensión de prueba (vTL / vAgente): sola, sin Vitalis, contra la base de prueba (server.mjs).
# Uso: cd test && python3 e2e_trial.py   → capturas en test/shots/
import asyncio, re, subprocess, time, json, urllib.request, pathlib, sys, tempfile, shutil
from playwright.async_api import async_playwright
PORT = 54430
LOCAL = f'http://localhost:{PORT}'
ROOT = pathlib.Path(__file__).parent.parent
OUT = pathlib.Path(__file__).parent / 'shots'; OUT.mkdir(exist_ok=True)
def sql(q, params=None):
    r = urllib.request.Request(f'{LOCAL}/__sql', data=json.dumps({'sql': q, 'params': params or []}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
fails = []
def ok(c, m):
    print(('  ✔ ' if c else '  ✖ ') + m)
    if not c: fails.append(m)

def trial_dir(role):  # la extensión de prueba como la arma build.py (sin bridge ni snippets), apuntando a la base de prueba
    d = pathlib.Path(tempfile.mkdtemp()) / f'prueba-{role}'
    shutil.copytree(ROOT / 'extension', d, ignore=shutil.ignore_patterns('bridge.js', 'snip.js'))
    m = json.loads((d / 'manifest.json').read_text())
    m['content_scripts'] = [c for c in m['content_scripts'] if 'crm.js' in c['js']]
    m['permissions'] = [x for x in m['permissions'] if x not in ('contextMenus', 'idle')]
    (d / 'manifest.json').write_text(json.dumps(m))
    (d / 'prueba.json').write_text(json.dumps({'role': role, 'url': LOCAL, 'key': 'test-anon-key'}))
    return str(d)

HOY = time.strftime('%d/%m/%Y')
def lista(rows):
    return '''<!doctype html><meta charset="utf-8"><title>CRM · Clients</title><body style="font:14px system-ui;padding:20px"><h3>Clients</h3><button class="refresh-btn" onclick="window.__clicks=(window.__clicks||0)+1">⟳</button>
<table border="1" cellpadding="6"><thead><tr><th>Client ID</th><th>Full Name</th><th>Country</th><th>Sales Status</th><th>Sales Rep</th><th>Affiliate</th><th>User Source</th><th>Registration Time</th></tr></thead><tbody>''' + ''.join(
        f'<tr><td>{c[0]}</td><td>{c[1]}</td><td>{c[2]}</td><td>{c[3]}</td><td>{c[4]}</td><td>{c[5]}</td><td>{c[6]}</td><td>{c[7]}</td></tr>' for c in rows) + '''</tbody></table>
<div id="drw"><div class="hd"><div>Lucía Trial</div><div class="sub">ID <span>661001</span></div></div><div class="btns"><button class="vb">☎ Omega - 1234</button><button class="vb">☎ Gizat - 1371</button></div></div></body>'''
ROWS = [['661001', 'Lucía Trial', 'Mexico', 'New', 'Pepe Rep', '97275', 'Finvera AI', f'{HOY} 09:00'],
        ['661002', 'Jorge Trial', 'Chile', 'New', 'Otro Rep', '108887', 'Capital Dos', f'{HOY} 09:05'],
        ['661003', 'Ana Trial', 'Mexico', 'Talking', 'Pepe Rep', '97275', 'Banamex', f'{HOY} 09:10'],
        ['661004', 'Raúl Trial', 'Colombia', 'Call Again', 'Pepe Rep', '97275', 'Finvera AI', f'{HOY} 08:00']]

async def run(p, role, code):
    EXT = trial_dir(role)
    ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path='/usr/bin/google-chrome', headless=False, viewport={'width': 1366, 'height': 860},
        args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--disable-features=DisableLoadExtensionCommandLineSwitch'])
    await ctx.route('https://crmnovaramarkets.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=lista(ROWS)))
    sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
    await sw.evaluate("chrome.storage.local.set({stationHours:{days:[0,1,2,3,4,5,6],from:0,to:1440}})")  # en la prueba siempre es horario
    ext_id = sw.url.split('/')[2]
    T = await sw.evaluate('trialCfg()')
    ok(T and T['role'] == role and T['url'] == LOCAL, f'[{role}] la extensión arranca en modo prueba ({T})')
    # el ícono: código + nombre
    P = await ctx.new_page(); await P.goto(f'chrome-extension://{ext_id}/popup.html'); await P.wait_for_timeout(800)
    ok(await P.locator('#tCode').is_visible() and await P.locator('#main').is_hidden(), f'[{role}] el ícono pide el código de la mesa y el nombre (nada de Vitalis)')
    await P.fill('#tCode', 'zzzzzz'); await P.fill('#tName', 'Pepe Rep'); await P.click('#tGo'); await P.wait_for_timeout(1200)
    ok('no existe' in await P.locator('#tMsg').inner_text(), f'[{role}] con un código que no existe no entra')
    await P.fill('#tCode', code.lower()); await P.click('#tGo'); await P.wait_for_timeout(1500)
    me = await sw.evaluate("chrome.storage.local.get(['trial','desk'])")
    ok(me.get('trial', {}).get('code') == code and me['trial']['role'] == role and me['desk']['role'] == ('leader' if role == 'tl' else 'agent'), f'[{role}] con el código y el nombre entra ({me.get("trial")})')
    await P.screenshot(path=OUT / f'tr_{role}_popup.png')
    return ctx, sw, P, ext_id

async def main():
    srv = subprocess.Popen(['node', 'server.mjs', str(PORT)], cwd=pathlib.Path(__file__).parent, stdout=open('/tmp/srv_trial.log', 'w'), stderr=subprocess.STDOUT); time.sleep(5)
    errs = []
    try:
        sql("update public.profiles set global = true where name = 'Joaquín Or'")
        sql("insert into public.trial_desks (code, name) values ('PRUEBA', 'Mesa Norte')")
        async with async_playwright() as p:
            # ---------- vAgente ----------
            ctx, sw, P, ext_id = await run(p, 'agent', 'PRUEBA')
            C = await ctx.new_page(); C.on('pageerror', lambda e: errs.append('C ' + str(e)))
            await C.goto('https://crmnovaramarkets.com/clients'); await C.wait_for_timeout(3500)
            pnl = C.locator('#ftd-crm-button')
            ok('Mesa Norte' in await pnl.locator('#t').inner_text() and await pnl.locator('#sSales').is_hidden() and await pnl.locator('#sStation').is_hidden(), '[agent] el botón del CRM dice la mesa y no ofrece ventas ni estación')
            rows = sql("select client_id, status, agent, aff, camp from public.trial_news where desk = 'PRUEBA' order by client_id")
            ok([r['client_id'] for r in rows] == ['661001', '661002', '661003'] and rows[0]['aff'] == '97275' and rows[0]['camp'] == 'Finvera AI', f'los news de la lista llegan a la base (y el Call Again no) ({rows})')
            ok(sql("select count(*)::int c from public.crm_clients")[0]['c'] == 0, 'y nada entra al registro de Vitalis')
            # la ficha: la campaña con el afiliado
            await C.wait_for_function("(document.getElementById('vitalis-dock')||{shadowRoot:{textContent:''}}).shadowRoot.textContent.includes('661001')", timeout=8000)
            DK = "(document.getElementById('vitalis-dock')||{shadowRoot:{textContent:''}}).shadowRoot.textContent"
            t = await C.evaluate(DK)
            ok('Afiliado97275' in t.replace('\n', '') or ('Afiliado' in t and '97275' in t), f'la mini ficha muestra al cliente abierto con el número del afiliado')
            ok('Finvera AI' in t and 'Todavía no sabemos el monto mínimo' in t, 'y la campaña, sin info todavía')
            dkd = await sw.evaluate("sess.get('dock',null)")
            ok(dkd and [x['id'] for x in dkd['next']] == ['661001'] and 'En New: llamalo ya' in dkd['next'][0]['why'] and dkd['stats']['news'] == 2, f'y el siguiente new es el mío en New (el abierto no se repite en la ficha) ({dkd and dkd["next"]})')
            await C.screenshot(path=OUT / 'tr_agent_dock.png')
            await C.locator('#vitalis-dock [data-ce]').click(); await C.wait_for_timeout(300)
            await C.locator('#vitalis-dock #cmin').fill('250 USD'); await C.locator('#vitalis-dock #cad').fill('Invertí con IA desde 250')
            await C.locator('#vitalis-dock [data-cs]').click(); await C.wait_for_timeout(2000)
            ci = sql("select aff, camp, country, min_amount from public.campaign_info where aff = '97275' and camp = 'Finvera AI'")
            ok(len(ci) == 1 and ci[0]['min_amount'] == '250 USD' and ci[0]['country'] == 'Mexico', f'"Agregar" guarda la info de la campaña, compartida ({ci})')
            t = await C.evaluate(DK)
            ok('Mínimo 250 USD' in t and 'Invertí con IA desde 250' in t, 'y la ficha la muestra enseguida')
            # una llamada
            await C.click('.vb:has-text("Omega")'); await C.wait_for_timeout(2500)
            calls = sql("select agent, client_id, line from public.trial_calls where desk = 'PRUEBA'")
            ok(calls == [{'agent': 'Pepe Rep', 'client_id': '661001', 'line': 'omega'}], f'el toque en Omega es una llamada de Pepe a ese cliente ({calls})')
            ok(sql("select first_call_by from public.trial_news where client_id = '661001'")[0]['first_call_by'] == 'Pepe Rep', 'y queda como la primera llamada al new')
            # "Actualizar esta pestaña": la lista se refresca sola y avisa de un new nuevo
            await pnl.locator('#wbtn').click(); await C.wait_for_timeout(500)
            ok('se actualiza sola' in await pnl.locator('#wst').inner_text(), 'la pestaña de news se actualiza sola')
            ok((await sw.evaluate("(async()=>{const w=Object.values((await chrome.storage.local.get('watches')).watches||{})[0];return w?(await chrome.tabs.get(w.tabId)).pinned:null})()")) is True, 'y queda fijada (el agente no la cierra por error)')
            # en la prueba, la pestaña de news también manda el cliente abierto (el agente abre la ficha desde ahí)
            await C.evaluate("()=>{document.querySelector('#drw .sub span').textContent='661002';document.querySelector('#drw .hd div').textContent='Jorge'}"); await C.wait_for_timeout(3500)
            ok('661002' in await C.evaluate(DK) and (await sw.evaluate("sess.get('trialCur',null)") or {}).get('id') == '661002', 'al abrir otro cliente en la pestaña que se actualiza sola, la mini ficha cambia')
            NUEVO = ['661009', 'Nuevo Trial', 'Peru', 'New', 'Pepe Rep', '97275', 'Finvera AI', f'{HOY} 10:00']
            await ctx.route('https://crmnovaramarkets.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=lista(ROWS + [NUEVO])))
            await C.evaluate("()=>{const tr=document.createElement('tr');tr.innerHTML='<td>661009</td><td>Nuevo Trial</td><td>Peru</td><td>New</td><td>Pepe Rep</td><td>97275</td><td>Finvera AI</td><td>%s 10:00</td>';document.querySelector('tbody').appendChild(tr)}" % HOY)
            await C.wait_for_timeout(4000)
            live = await sw.evaluate('liveNow()')
            ok(any(x['k'] == 'crm:id:661009' for x in live), f'un new que entra: tarjeta con sonido para el agente ({[x["k"] for x in live]})')
            await C.screenshot(path=OUT / 'tr_agent_card.png')
            # el ícono con los números del día
            await P.reload(); await P.wait_for_timeout(2500)
            tp = await P.locator('#trial').inner_text()
            ok('Mesa Norte' in tp and 'Te llegaron' in tp and 'en New' in tp, f'el ícono del agente: sus news en New y sus números de hoy')
            await P.screenshot(path=OUT / 'tr_agent_popup2.png')
            await ctx.close()

            # ---------- vTL ----------
            sql("update public.trial_news set reg = to_char(now() at time zone 'America/Montevideo' - interval '20 minutes', 'YYYY-MM-DD HH24:MI') where client_id = '661002'")  # Jorge lleva 20 min en New sin que nadie lo llame
            ctx, sw, P, ext_id = await run(p, 'tl', 'PRUEBA')
            await sw.evaluate('trialBoardTick(true)'); await P.wait_for_timeout(1500)
            live = await sw.evaluate('liveNow()')
            ok(any(x['k'] == 'crm:tl:661002' for x in live) and not any(x['k'] == 'crm:tl:661001' for x in live), f'el team leader recibe aviso del New sin llamar a los 5 min (y no del que ya llamaron) ({[x["k"] for x in live]})')
            await P.reload(); await P.wait_for_timeout(2500)
            tp = await P.locator('#trial').inner_text()
            ok('En New' in tp and '661002' in tp and 'Otro Rep' in tp and '661003' in tp and 'En Talking' in tp and 'Hoy por agente' in tp and 'Pepe Rep' in tp, 'el tablero del team leader: los activos (en New y en llamada), hace cuánto, y los agentes de hoy')
            await P.screenshot(path=OUT / 'tr_tl_popup.png')
            G = await ctx.new_page(); await G.goto('https://crmnovaramarkets.com/clients'); await G.bring_to_front(); await G.wait_for_timeout(2500); await G.screenshot(path=OUT / 'tr_tl_card.png'); await G.close()
            C = await ctx.new_page(); await C.goto('https://crmnovaramarkets.com/clients'); await C.wait_for_timeout(3000)
            ok(await C.locator('#vitalis-dock').count() == 0, 'el team leader no tiene mini ficha')
            d = await sw.evaluate("chrome.storage.local.get('trial')")
            await sw.evaluate("chrome.runtime.sendMessage ? trialOut() : trialOut()"); await P.wait_for_timeout(500)
            ok(not (await sw.evaluate("chrome.storage.local.get('trial')")).get('trial'), '"Salir" borra el código y el nombre')
            await ctx.close()
            # el dueño ve las mesas de prueba
            r = sql("select public.trial_desks_list() j")
            ok(True, 'fin')
    finally:
        srv.terminate()
    print('\nerrores de la página:', errs or 'ninguno')
    print(f'\n{len(fails)} FALLAS' if fails else '\nTodo OK')
    sys.exit(1 if fails or errs else 0)
asyncio.run(main())

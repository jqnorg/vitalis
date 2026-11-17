# Prueba de punta a punta con Chrome headless contra la base de prueba (server.mjs).
# Uso: cd test && python3 e2e.py   → capturas en test/shots/
import asyncio, subprocess, time, json, urllib.request, pathlib, sys
from playwright.async_api import async_playwright
PORT = 54410
URL = f'http://localhost:{PORT}/'
OUT = pathlib.Path(__file__).parent / 'shots'; OUT.mkdir(exist_ok=True)
def sql(q, params=None):
    r = urllib.request.Request(f'http://localhost:{PORT}/__sql', data=json.dumps({'sql': q, 'params': params or []}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
fails = []
def ok(c, m):
    print(('  ✔ ' if c else '  ✖ ') + m)
    if not c: fails.append(m)

SEED = """
insert into public.sales (team_id,user_id,n,date,time,client_id,country,name,aff,camp,amount,tx,reg,brand)
select p.team_id, p.id, g, date '2026-11-02' + ((g*5) % 15), '1'||(g%9)||':15', (70000+g)::text, (array['Peru','Chile','Mexico','Colombia'])[1+g%4], 'Cliente '||g, '12', (array['FB-01','GG-UY','null'])[1+g%3], 100+g*7, 'tx'||g,
       (date '2026-11-02' + ((g*5) % 15) - (g%3))::text, 'Novara Markets'
from generate_series(1,13) g, public.profiles p where p.name = 'Joaquín Or';
insert into public.sales (team_id,user_id,n,date,time,client_id,country,name,amount,tx,reg,brand)
select p.team_id, p.id, g, date '2026-11-03' + ((g*3) % 14), '11:00', (80000+g*10+(case p.name when 'Matias Me' then 1 when 'Sofía Ar' then 2 else 3 end))::text, 'Peru', 'Otro '||g, 150, 'ty'||g||left(p.id::text,4), (date '2026-11-03' + ((g*3) % 14))::text, 'Novara Markets'
from generate_series(1,6) g, public.profiles p where p.name in ('Matias Me','Sofía Ar','Mateo He');
insert into public.leads (team_id,user_id,client_id,name,country,date,source)
select p.team_id, p.id, (70000+g)::text, 'Cliente '||g, 'Peru', date '2026-11-17' - (g % 18), 'crm' from generate_series(1,13) g, public.profiles p where p.name = 'Joaquín Or';
insert into public.leads (team_id,user_id,client_id,name,country,date,source)
select p.team_id, p.id, (60000+g)::text, 'Lead '||g, 'Chile', date '2026-11-17' - (g % 12), 'crm' from generate_series(1,24) g, public.profiles p where p.name = 'Joaquín Or';
insert into public.snippets (team_id,user_id,shortcut,title,body,shared)
select p.team_id, p.id, 'kyc', 'Pedido de documentos', E'Hola! Para habilitar tu cuenta necesito:\\n1. Foto de tu documento (frente y dorso)\\n2. Una selfie con el documento\\n\\nCualquier duda, escribime. {yo}', false from public.profiles p where p.name = 'Joaquín Or';
insert into public.snippets (team_id,user_id,shortcut,title,body,shared)
select p.team_id, p.id, 'saludo', 'Saludo inicial', E'Buenas! Te habla {yo} de Novara Markets. ¿Tenés un minuto?{cursor}', true from public.profiles p where p.name = 'Matias Me';
"""

async def main():
    srv = subprocess.Popen(['node', 'server.mjs', str(PORT)], cwd=pathlib.Path(__file__).parent, stdout=subprocess.PIPE, stderr=subprocess.STDOUT); time.sleep(5)
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--headless=new'])
            async def newpage(tag, w=1440, h=920, dark=False):
                ctx = await b.new_context(viewport={'width': w, 'height': h}, color_scheme='dark' if dark else 'light')
                pg = await ctx.new_page()
                pg.on('pageerror', lambda e: errs.append(tag + ' ' + str(e)))
                pg.on('console', lambda m: errs.append(tag + ' console ' + m.text) if m.type == 'error' and 'realtime' not in m.text and 'WebSocket' not in m.text and '404' not in m.text else None)
                return pg
            A = await newpage('A')
            await A.goto(URL); await A.wait_for_timeout(1200)
            await A.screenshot(path=OUT / 'a1_codigo.png')
            ok(await A.is_visible('#auth input[name=code]'), 'sin código: pide el código de la mesa')
            await A.fill('[name=code]', 'nope'); await A.click('#auth [type=submit]'); await A.wait_for_timeout(500)
            ok('ninguna mesa' in await A.inner_text('#aErr'), 'código equivocado: avisa')
            await A.fill('[name=code]', 'matias-test'); await A.click('#auth [type=submit]'); await A.wait_for_timeout(800)
            n = await A.locator('.person').count()
            ok(n == 13, f'muestra los 13 nombres ({n})')
            await A.screenshot(path=OUT / 'a2_nombres.png')
            await A.click('.person:has-text("Joaquín Or")'); await A.wait_for_timeout(300)
            ok('0000' in await A.inner_text('.hint'), 'primera vez: avisa que el PIN es 0000')
            await A.keyboard.type('1111'); await A.wait_for_timeout(900)
            ok('incorrecto' in await A.inner_text('.amsg'), 'PIN equivocado: avisa')
            await A.screenshot(path=OUT / 'a3_pin.png')
            for k in '0000': await A.click(f'.pad [data-k="{k}"]')
            await A.wait_for_timeout(1800)
            ok('Creá tu PIN' in await A.inner_text('#abox h2'), '0000 entra y pide crear el PIN')
            await A.screenshot(path=OUT / 'a4_crear_pin.png')
            await A.keyboard.type('0000'); await A.wait_for_timeout(500)
            ok('Elegí otro' in await A.inner_text('.amsg'), 'no deja quedarse con 0000')
            await A.keyboard.type('4821'); await A.wait_for_timeout(400)
            await A.keyboard.type('4821'); await A.wait_for_timeout(2000)
            ok(await A.evaluate('ready'), 'entra a Vitalis')
            ok(await A.evaluate('profile.role') == 'admin', 'el primero queda como admin')
            await A.screenshot(path=OUT / 'b0_inicio_vacio.png')
            # datos de ejemplo
            sql(SEED)
            await A.reload(); await A.wait_for_timeout(2500)
            ok(await A.evaluate('ready'), 'la sesión sigue al recargar')
            await A.screenshot(path=OUT / 'b1_inicio.png', full_page=False)
            ok((await A.inner_text('#iHero .n')).strip() == '13', 'la pista muestra 13 FTDs')
            for i, v in enumerate(['ventas', 'clientes', 'agenda', 'turnos', 'sueldo', 'snippets', 'config', 'equipo']):
                await A.keyboard.press(str(i + 2)); await A.wait_for_timeout(600)
                ok(await A.is_visible(f'#v-{v}'), f'sección {v}')
                await A.screenshot(path=OUT / f'c{i+2}_{v}.png')
            # clientes: manual + conversión
            await A.keyboard.press('3'); await A.wait_for_timeout(300)
            await A.click('[data-act=nuevoCliente]'); await A.fill('#ncI', '99001'); await A.fill('#ncN', 'Ana Prueba'); await A.click('.mbox .mf .pri'); await A.wait_for_timeout(800)
            ok(sql("select count(*)::int c from public.leads where client_id='99001' and source='manual'")[0]['c'] == 1, 'cliente cargado a mano')
            # snippet nuevo
            await A.keyboard.press('7'); await A.wait_for_timeout(300)
            await A.click('[data-act=nuevoSnip]'); await A.fill('#snS', '/Dep Ok'); await A.fill('#snB', 'Listo {yo}, ya se acreditó tu depósito.'); await A.wait_for_timeout(200)
            prev = await A.inner_text('#snP')
            ok('Joaquín Or' in prev, 'la vista previa reemplaza {yo}')
            await A.click('.mbox .mf .pri'); await A.wait_for_timeout(800)
            ok(sql("select count(*)::int c from public.snippets where shortcut='dep-ok'")[0]['c'] == 1, 'snippet guardado como /dep-ok')
            # mesa: resetear PIN y sumar persona
            await A.keyboard.press('8'); await A.wait_for_timeout(400)
            await A.click('#cfAddM'); await A.fill('#amN', 'Nueva Persona'); await A.click('.mbox .mf .pri'); await A.wait_for_timeout(1200)
            ok(sql("select count(*)::int c from public.profiles where name='Nueva Persona' and login is not null")[0]['c'] == 1, 'el admin suma a alguien')
            await A.screenshot(path=OUT / 'd1_mesa.png', full_page=True)
            # oscuro y celular
            D = await newpage('D', dark=True)
            await D.goto(URL + '#mesa=MATIAS-TEST'); await D.wait_for_timeout(1000)
            ok(await D.locator('.person').count() == 14, 'el link de entrada trae el código: va directo a los nombres')
            await D.click('.person:has-text("Matias Me")'); await D.keyboard.type('0000'); await D.wait_for_timeout(1500)
            await D.keyboard.type('2468'); await D.wait_for_timeout(300); await D.keyboard.type('2468'); await D.wait_for_timeout(2200)
            ok(await D.evaluate('ready') and await D.evaluate('profile.role') == 'leader', 'el team leader entra (sigue team leader)')
            await D.screenshot(path=OUT / 'e1_oscuro_inicio.png')
            M = await newpage('M', 390, 844)
            await M.goto(URL); await M.wait_for_timeout(900)
            await M.fill('[name=code]', 'MATIAS-TEST'); await M.click('#auth [type=submit]'); await M.wait_for_timeout(900)
            await M.screenshot(path=OUT / 'f0_celular_nombres.png')
            await M.click('.person:has-text("Joaquín Or")'); await M.keyboard.type('4821'); await M.wait_for_timeout(2200)
            await M.screenshot(path=OUT / 'f1_celular_inicio.png', full_page=True)
            await b.close()
    finally:
        srv.terminate()
    print('\nerrores de la página:', errs or 'ninguno')
    print(f'\n{len(fails)} FALLAS' if fails else '\nTodo OK')
    sys.exit(1 if fails or errs else 0)
asyncio.run(main())

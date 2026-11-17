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
            await A.goto(URL + '#mesa=VIEJO'); await A.wait_for_timeout(1400)
            n = await A.locator('.person').count()
            ok(n == 13, f'entra directo a los 13 nombres, sin código (un link viejo con #mesa= no molesta) ({n})')
            ok(not await A.is_visible('#auth .slogan') and not await A.is_visible('#auth .aside'), 'sin presentación')
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
            for i, v in enumerate(['ventas', 'clientes', 'agenda', 'turnos', 'sueldo', 'snippets', 'social', 'config', 'equipo']):
                await A.keyboard.press(str((i + 2) % 10)); await A.wait_for_timeout(600)
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
            await A.keyboard.press('9'); await A.wait_for_timeout(400)
            ok(not await A.is_visible('#cfCode') and not await A.is_visible('#cfLinkCopy'), 'sin código ni link de la mesa en Ajustes')
            await A.fill('[data-crm]:nth-match(*,1)' if False else '#cfMembers tr:has-text("Sofía Ar") [data-crm]', 'Sofia Arismendi'); await A.keyboard.press('Tab'); await A.wait_for_timeout(700)
            ok(sql("select crm_name from public.profiles where name='Sofía Ar'")[0]['crm_name'] == 'Sofia Arismendi', 'el nombre en el CRM se guarda')
            await A.click('#cfAddM'); await A.fill('#amN', 'Nueva Persona'); await A.click('.mbox .mf .pri'); await A.wait_for_timeout(1200)
            ok(sql("select count(*)::int c from public.profiles where name='Nueva Persona' and login is not null")[0]['c'] == 1, 'el admin suma a alguien')
            await A.screenshot(path=OUT / 'd1_mesa.png', full_page=True)
            # oscuro: el team leader
            D = await newpage('D', dark=True)
            await D.goto(URL); await D.wait_for_timeout(1200)
            ok(await D.locator('.person').count() == 14, 'la lista ya tiene a la persona nueva')
            await D.click('.person:has-text("Matias Me")'); await D.keyboard.type('0000'); await D.wait_for_timeout(1500)
            await D.keyboard.type('2468'); await D.wait_for_timeout(300); await D.keyboard.type('2468'); await D.wait_for_timeout(2200)
            ok(await D.evaluate('ready') and await D.evaluate('profile.role') == 'leader', 'el team leader entra (sigue team leader)')
            await D.screenshot(path=OUT / 'e1_oscuro_inicio.png')
            # el team leader carga una venta a nombre de Sofía
            await D.keyboard.press('n'); await D.wait_for_timeout(400)
            ok(await D.is_visible('.mbox [name=uid]'), 'el team leader elige el vendedor en Nueva venta')
            sofia = sql("select id from public.profiles where name='Sofía Ar'")[0]['id']
            await D.select_option('.mbox [name=uid]', sofia)
            await D.fill('.mbox [name=id]', '88001'); await D.fill('.mbox [name=name]', 'Cliente de Sofía'); await D.fill('.mbox [name=amount]', '150'); await D.fill('.mbox [name=brand]', 'Trade24Seven'); await D.fill('.mbox [name=tx]', 'T88001')
            await D.click('.mbox .mf .pri'); await D.wait_for_timeout(1200)
            r = sql("select (select name from public.profiles where id=user_id) who, brand, n from public.sales where client_id='88001'")
            ok(len(r) == 1 and r[0]['who'] == 'Sofía Ar' and r[0]['brand'] == 'Trade24Seven' and r[0]['n'] == sql("select count(*)::int c from public.sales where user_id=(select id from public.profiles where name='Sofía Ar')")[0]['c'], f'la venta queda a nombre de Sofía, con su número ({r})')
            # CSV del team leader con columna de agente
            csv = 'Time of FTD,User ID,Full Name,Amount,Transaction ID,Agent\n17/11/2026 10:00,88002,Uno,100,T88002,Sofia Arismendi\n17/11/2026 11:00,88003,Dos,120,T88003,Mateo Herrera\n17/11/2026 12:00,88004,Tres,90,T88004,Fulano Externo\n'
            await D.evaluate('''(csv)=>{const R=csvToRows(parseCSV(csv));for(const x of R.ok){x.brand='Novara Markets';x.uid=agentUid(x.agent)||null}return addForSellers(R.ok,'de prueba')}''', csv); await D.wait_for_timeout(1500)
            r = sql("select client_id, (select name from public.profiles where id=user_id) who from public.sales where client_id in ('88002','88003','88004') order by client_id")
            ok([(x['client_id'], x['who']) for x in r] == [('88002', 'Sofía Ar'), ('88003', 'Mateo He')], f'cada venta a su vendedor por la columna de agente ({r})')
            ok(await D.is_visible('#toasts [data-key=asignar]'), 'la que no es de nadie de la mesa queda para asignar')
            await D.click('#toasts [data-key=asignar] .btn'); await D.wait_for_timeout(400)
            await D.select_option('.mbox [data-an="0"]', sofia); await D.click('.mbox .mf .pri'); await D.wait_for_timeout(1200)
            ok(sql("select (select name from public.profiles where id=user_id) who from public.sales where client_id='88004'")[0]['who'] == 'Sofía Ar', 'asignada a mano y se carga')
            # social: A pide un mate, D lo ve y lo ceba, A ve la respuesta
            await A.keyboard.press('8'); await A.wait_for_timeout(400)
            await A.click('[data-ping=mate]'); await A.wait_for_timeout(800)
            ok(sql("select count(*)::int c from public.pings where kind='mate'")[0]['c'] == 1, 'A pide un mate a la mesa')
            ok(await A.is_disabled('[data-ping=mate]'), 'el botón queda en espera (cooldown)')
            await D.evaluate('socialPoll()'); await D.wait_for_timeout(600)
            ok(await D.is_visible('#toasts .toast.alert:has-text("pide un mate")'), 'al team leader le llega el aviso del mate')
            ok(await D.inner_text('#nbSo') == '1', 'Social marca 1 pendiente')
            await D.screenshot(path=OUT / 'g1_aviso_mate.png')
            await D.click('#toasts .toast.alert .btn:has-text("Te lo cebo")'); await D.wait_for_timeout(800)
            ok(sql("select reply from public.pings where kind='mate'")[0]['reply'] == 'si', 'D le ceba el mate')
            await A.evaluate('socialPoll()'); await A.wait_for_timeout(600)
            ok(await A.is_visible('#toasts .toast:has-text("Te lo cebo")'), 'A ve que le ceban el mate')
            await A.select_option('#soTo', sql("select id from public.profiles where name='Matias Me'")[0]['id']); await A.wait_for_timeout(300)
            await A.click('[data-ping=d10]'); await A.wait_for_timeout(700)
            await D.evaluate('socialPoll()'); await D.wait_for_timeout(500)
            ok(await D.is_visible('#toasts .toast.alert:has-text("salimos a los 10")'), 'a Matias le preguntan si sale a los 10')
            await D.click('#toasts .toast.alert .btn:has-text("Silenciar 1 h")'); await D.wait_for_timeout(800)
            ok(sql("select quiet_until > now() q from public.profiles where name='Matias Me'")[0]['q'], 'Matias silencia los avisos sociales')
            await A.click('[data-ping=d30]'); await A.wait_for_timeout(600)
            await D.evaluate('socialPoll()'); await D.wait_for_timeout(500)
            ok(not await D.is_visible('#toasts .toast.alert:has-text("a la media")'), 'silenciado: no le llega el aviso')
            await D.keyboard.press('8'); await D.wait_for_timeout(500)
            ok('a la media' in await D.inner_text('#soFeed'), 'pero lo ve en Social')
            await D.screenshot(path=OUT / 'g2_social_silenciado.png')
            await A.reload(); await A.wait_for_timeout(2500); await A.keyboard.press('8'); await A.wait_for_timeout(500)
            ok('🔕' in await A.inner_text('#soPeople'), 'los demás ven que está silenciado')
            await A.screenshot(path=OUT / 'g3_social.png')
            M = await newpage('M', 390, 844)
            await M.goto(URL); await M.wait_for_timeout(1200)
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

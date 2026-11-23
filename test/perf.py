# Medición de velocidad: arranque, login y cada sección con datos de tamaño real. Uso: cd test && python3 perf.py
import asyncio, subprocess, time, json, urllib.request, pathlib
from playwright.async_api import async_playwright
PORT = 54470; URL = f'http://localhost:{PORT}/'
def sql(q):
    r = urllib.request.Request(f'http://localhost:{PORT}/__sql', data=json.dumps({'sql': q, 'params': []}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
SEED = """
insert into public.sales (team_id,user_id,n,date,time,client_id,country,name,aff,camp,amount,tx,reg,brand)
select p.team_id, p.id, g, date '2025-06-01' + (g % 530), '1'||(g%9)||':15', (100000+g*13+length(p.name))::text, (array['Peru','Chile','Mexico','Colombia'])[1+g%4], 'Cliente '||g, (10+g%9)::text, (array['FB-01','GG-UY','TT-3'])[1+g%3], 100+g%400, 'tx'||g||left(p.id::text,6), (date '2025-06-01' + (g % 530))::text, 'Novara Markets'
from generate_series(1,200) g, public.profiles p;
insert into public.crm_clients (team_id,brand,client_id,name,country,status,status_group,reg,crm_agent,camp,aff,first_seen,last_seen,status_since)
select p.team_id,'Novara Markets',(700000+g)::text,'Persona '||g,(array['Peru','Chile','Mexico','Colombia'])[1+g%4],(array['New','No Answer','Call Again','Hang Up','Low Potential','NA - DAY3'])[1+g%6],(array['new','na','call_again','hang_up','low_potential','na'])[1+g%6],to_char(now()-((g%20)||' days')::interval,'YYYY-MM-DD HH24:MI'),'Joaquín Or',(array['FB-01','GG-UY'])[1+g%2],'12',now()-interval '2 days',now(),now()-interval '1 day'
from generate_series(1,450) g, public.profiles p where p.name='Joaquín Or';
"""
async def main():
    srv = subprocess.Popen(['node', 'server.mjs', str(PORT)], cwd=pathlib.Path(__file__).parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(5)
    try:
        for q in SEED.split(';'):
            if q.strip(): sql(q)
        print('ventas', sql('select count(*) n from public.sales')[0]['n'])
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--headless=new'])
            ctx = await b.new_context(viewport={'width': 1440, 'height': 920})
            A = await ctx.new_page()
            # parpadeo: se demora supabase.js y miro qué se ve antes
            async def slow(route):
                await asyncio.sleep(1.2)
                try: await route.continue_()
                except Exception: pass
            await A.route('**/supabase*.js', slow)
            await A.goto(URL, wait_until='commit'); await A.wait_for_timeout(600)
            vis = await A.evaluate("(()=>{const n=document.getElementById('nav');return !!n&&n.getBoundingClientRect().width>0&&getComputedStyle(document.body).visibility!=='hidden'&&!document.body.classList.contains('auth')})()")
            print('PARPADEO: menú visible antes del login =', vis)
            await A.screenshot(path='shots/perf_parpadeo.png')
            await A.unroute('**/supabase*.js')
            await A.wait_for_selector('.person', timeout=15000)
            t0 = time.time()
            await A.click('.person:has-text("Joaquín Or")')
            for k in '0000': await A.click(f'.pad [data-k="{k}"]')
            await A.wait_for_selector('text=Creá tu PIN', timeout=15000)
            print(f'login (PIN → pantalla siguiente): {time.time()-t0:.2f}s')
            await A.keyboard.type('4821'); await A.wait_for_timeout(500); await A.keyboard.type('4821')
            await A.wait_for_function('ready', timeout=20000)
            async def lag(route):
                await asyncio.sleep(0.22)
                try: await route.continue_()
                except Exception: pass
            await A.route('**/rest/v1/**', lag); await A.route('**/auth/v1/**', lag)
            for i in range(2):
                await A.evaluate("new Promise(r=>{const q=indexedDB.deleteDatabase('vitalis');q.onsuccess=q.onerror=q.onblocked=()=>r()})")
                t0 = time.time(); await A.reload(); await A.wait_for_function("ready&&(()=>{const v=document.querySelector('#main .view:not([hidden])');return !!v&&v.innerText.trim().length>80})()", timeout=30000)
                print(f'recarga SIN guardado (220 ms por consulta) → inicio con datos: {time.time()-t0:.2f}s')
            await A.wait_for_timeout(3000)
            for i in range(2):
                t0 = time.time(); await A.reload(); await A.wait_for_function("ready&&(()=>{const v=document.querySelector('#main .view:not([hidden])');return !!v&&v.innerText.trim().length>80})()", timeout=30000)
                print(f'recarga CON guardado (220 ms por consulta) → inicio con datos: {time.time()-t0:.2f}s')
                await A.wait_for_timeout(2500)
            await A.unroute('**/rest/v1/**'); await A.unroute('**/auth/v1/**')
            await A.wait_for_timeout(2500)
            r = await A.evaluate("""async()=>{const out={};for(const v of VIEWS){if(v==='equipo'&&!isLeader())continue;const t=performance.now();go(v);out[v]=Math.round((performance.now()-t)*10)/10}
              const t=performance.now();for(let i=0;i<5;i++){status()}out._status=Math.round((performance.now()-t)/5*10)/10;
              go('inicio');const t2=performance.now();for(let i=0;i<5;i++)V.inicio.render({});out._inicio_x=Math.round((performance.now()-t2)/5*10)/10;return out}""")
            print('ms por sección (go):', json.dumps(r))
            await b.close()
    finally:
        srv.terminate()
asyncio.run(main())

# Capturas de la estética Noche y la Bandeja (no es un test): python3 shots_noche.py (con `node server.mjs 54399` andando)
import asyncio, json, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright
PORT = 54399; URL = f'http://localhost:{PORT}/'; OUT = Path(__file__).parent / 'shots'
def sql(q, params=None):
    r = urllib.request.Request(f'http://localhost:{PORT}/__sql', data=json.dumps({'sql': q, 'params': params or []}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
async def login(pg, name, pin):
    await pg.goto(URL); await pg.wait_for_timeout(1200)
    await pg.click(f'.person:has-text("{name}")'); await pg.keyboard.type('0000'); await pg.wait_for_timeout(1500)
    if await pg.is_visible('#abox h2'):
        await pg.keyboard.type(pin); await pg.wait_for_timeout(300); await pg.keyboard.type(pin)
    await pg.wait_for_timeout(2500)
async def main():
    import datetime; te = datetime.date.today().isoformat()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--headless=new'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 920})
        await ctx.add_init_script("try{const d=new Date(),z=n=>String(n).padStart(2,'0');localStorage.setItem('vitalis.cierre',JSON.stringify(d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())))}catch(e){}")
        A = await ctx.new_page(); A.on('pageerror', lambda e: print('ERR', e))
        await login(A, 'Joaquín Or', '4821')
        print('cur', await A.evaluate('cur'))
        # datos para la bandeja: news, agendas, tarea
        h = await A.evaluate("(()=>{const d=new Date(Date.now()-50*6e4);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')})()")
        await A.evaluate(f'''()=>crmSeenFromExt([
          {{id:'500001',brand:'Novara Markets',country:'Chile',status:'New',reg:'{te} 09:10',agent:'Joaquín Or',camp:'FB-01',aff:'12',k:'a'}},
          {{id:'500002',brand:'Novara Markets',country:'Peru',status:'New',reg:'{te} {h}',agent:'Joaquín Or',camp:'GG-UY',k:'b'}}])''')
        await A.wait_for_timeout(800)
        await A.evaluate(f"B.addPend({{n:1,id:'610001',kw:'juan perez',due:'{te}T08:30',notified:true}})")
        await A.evaluate(f"B.addPend({{n:2,id:'610002',kw:'maria',due:'{te}T16:30'}})")
        await A.evaluate("B.taskCreate({what:'Revisar los new de ayer',camps:[],affs:[],due:'"+te+"'})")
        await A.wait_for_timeout(1200)
        await A.evaluate("go('home')"); await A.wait_for_timeout(800); await A.screenshot(path=OUT / 'rev_home.png', full_page=True)
        await A.evaluate("go('inicio')"); await A.wait_for_timeout(800); await A.screenshot(path=OUT / 'rev_rend.png', full_page=True)
        await A.evaluate("go('equipo')"); await A.wait_for_timeout(800); await A.screenshot(path=OUT / 'rev_mesa.png')
        await A.evaluate("go('agenda')"); await A.wait_for_timeout(600); await A.screenshot(path=OUT / 'rev_agenda.png')
        await A.evaluate("go('chat')"); await A.wait_for_timeout(600); await A.screenshot(path=OUT / 'rev_chat.png')
        await A.evaluate("go('banking')"); await A.wait_for_timeout(600); await A.screenshot(path=OUT / 'rev_banking.png')
        await A.evaluate("applyTheme('oscuro');go('home')"); await A.wait_for_timeout(600); await A.screenshot(path=OUT / 'rev_home_noche.png', full_page=True)
        await b.close()
asyncio.run(main())

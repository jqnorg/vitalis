// El dólar BROU para el líquido del sueldo: la compra de la pizarra ("Dólar"), leída de la página oficial del BROU.
// Corre en Supabase (así el navegador no choca con CORS) y guarda el valor 15 minutos. Si no puede leerlo, responde 502
// y Vitalis se queda con el último valor (o el que cargó cada uno a mano). Nunca sustituye por el eBROU ni por otra fuente.
const PAGE = 'https://www.brou.com.uy/cotizaciones';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const ENT: Record<string, string> = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', nbsp: ' ', amp: '&' };

// "Dólar 39,40000 41,80000 …  Dólar eBROU 39,90000 41,30000" → {compra, venta, ebrou}
export function parseBrou(html: string) {
  const t = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[String(n).toLowerCase()] ?? m)
    .replace(/\s+/g, ' ');
  const num = '(\\d{1,3}(?:[.,]\\d{1,6})?)';
  const sep = '[\\s|:]*';
  const val = (s: string) => +s.replace(',', '.');
  const ok = (n: number) => n > 15 && n < 150;
  let compra = 0, venta = 0, ebrou: { compra: number; venta: number } | null = null;
  for (const m of t.matchAll(new RegExp('D[óo]lar(?!\\s*e\\s*BROU)' + sep + num + sep + num, 'gi'))) {
    const c = val(m[1]), v = val(m[2]);
    if (ok(c) && ok(v) && v >= c) { compra = c; venta = v; break; }
  }
  const e = t.match(new RegExp('D[óo]lar\\s*e\\s*BROU' + sep + num + sep + num, 'i'));
  if (e && ok(val(e[1])) && ok(val(e[2]))) ebrou = { compra: val(e[1]), venta: val(e[2]) };
  return compra ? { compra, venta, ebrou } : null;
}

let cache: { at: number; body: string } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (body: string, status = 200) => new Response(body, { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'max-age=900' } });
  if (cache && Date.now() - cache.at < 15 * 60e3) return json(cache.body);
  try {
    const r = await fetch(PAGE, { headers: { 'user-agent': 'Mozilla/5.0 (Vitalis, mesa Team Matias)', accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('BROU respondió ' + r.status);
    const q = parseBrou(await r.text());
    if (!q) throw new Error('no encontré la fila Dólar');
    const body = JSON.stringify({ ...q, fuente: 'BROU · pizarra', url: PAGE, at: new Date().toISOString() });
    cache = { at: Date.now(), body };
    return json(body);
  } catch (e) {
    console.error('dolar-brou:', (e as Error).message);
    return json(JSON.stringify({ error: 'sin cotización', detalle: (e as Error).message }), 502);
  }
});

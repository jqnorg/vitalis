# Propuestas anotadas (noviembre 2026)

Salen del análisis de las ventas de Trade24Seven (2.525 FTDs, abril 2025 a noviembre 2026, con hora de registro y de depósito).
Límite de todos los datos: solo hay clientes que depositaron; no se sabe cuántos se llamaron y no depositaron. Novara lo va a
permitir medir cuando junte historia. Las horas son las del CRM. Nada de esto está construido: el dueño elige cuáles se hacen.

| # | Propuesta | Quién la ve | Dato que la sostiene |
|---|---|---|---|
| 1 | **El reloj del new**: en la Cola, cada new con su "ventana fuerte"; primero el que se enfría | Agentes | Mismo día: mediana 52 min del registro; 58% antes de 1 h; 85% antes de 2 h; 4% antes de 20 min. Por país: Chile 46 min (70% en 1 h), Colombia 54, México 64 (46% en 1 h), Perú 66 |
| 2 | **Campaña caliente**: aviso cuando una campaña lleva 2+ FTDs hoy y tenés clientes de esa campaña | Agentes | De las que dan 1 FTD en el día, 26% da otro; con 2, 36% da un tercero; con 3, 46% un cuarto |
| 3 | **Segundas oportunidades**: los que hablaron y no depositaron, ordenados por la chance que les queda | Agentes | 11% de los FTDs es late; 47% de los lates deposita al día siguiente, 64% en 3 días, 87% en 7; hora 10 a 13; los del viernes vuelven el lunes |
| 4 | **Pronóstico del mes**: rango de cierre de la mesa y de cada agente contra su target | **Solo team leader y administradores** | Al día 10 la mesa lleva 34% del mes (21–41), al 15 52% (34–61), al 20 70% (52–82), al 25 85% (70–98) |
| 5 | **El mapa del día**: a qué hora deposita cada país | Agentes | Pico 11 a 13, segundo empujón a las 16; México parejo de 12 a 15; casi nada después de las 18 |
| 6 | **Días de cobro**: calendario por país y aviso para agendar a los "no tengo la plata" | Agentes | Colombia: 28% de sus FTDs del 1 al 6 (parejo sería 20%). México: 20% del 14 al 17 (parejo 13%). Chile: parejo |
| 7 | **Radar de campañas**: cuál nace y cuál se apaga (últimas 2 semanas contra las 2 anteriores) | Todos | Una campaña da 17% de sus FTDs en la primera semana y 39% en las primeras cuatro; vida mediana 36 días |
| 8 | **Tu día**: según a qué hora llega el primer FTD, la chance de hacer 2 o 3 | Agentes | Primer FTD antes de las 11: 56% termina con 2+, 26% con 3+. Después de las 15: 16% y 2% |
| 9 | **Afiliadores que maduran tarde**: la ficha avisa si conviene insistir varios días | Agentes | El late va de 3% a 40% según el afiliador (mesa: 11%) |
| 10 | **Curva del agente nuevo**: FTDs por mes desde que entra | **Solo team leader y administradores** | 1er mes 8,5 FTDs; 2º 16,6; después entre 12 y 16 (10 agentes desde julio 2025) |

Notas:
- La 5 incluía "quién cierra más rápido" (38 a 80 min de mediana por agente): mezcla habilidad con qué clientes le tocan a cada uno; si se hace, solo para team leader.
- La 8 es en parte obvia (cerrar temprano deja más día), pero el salto es grande.
- La 1 mejora con la ventana por país de la tabla.

## Más señales como Campaña caliente (20/11/2026)

Avisos en vivo que dicen a quién llamar primero. Las tres primeras se miden con la historia de Trade24Seven; las otras dos se aprenden de lo que junta la extensión.

| # | Propuesta | Dato que la sostiene |
|---|---|---|
| 11 | **País caliente**: el país donde se está depositando ahora; tus clientes de ese país primero | Misma hora del día: después de una hora con FTD de Colombia, 43% de chance de otro en la hora siguiente (12% si no hubo); México 23% contra 6%; Chile 35% contra 22% |
| 12 | **Afiliador caliente**: como Campaña caliente, pero con todo el afiliador (todas sus campañas en ese país) | Afiliador con 2 FTDs en el día: 56% da un tercero (campaña: 36%); con 1, 45% da otro (campaña: 26%) |
| 13 | **Volvió el procesador**: cuando Banking marca que un procesador o método volvió en un país, tus clientes con depósito trabado de ese país | Sale de lo que ya está en Vitalis (vueltas de `pay_report` y clientes en `failed`) |
| 14 | **A qué hora atiende cada cliente**: la hora en que atendió antes; a esa hora va primero | Se aprende de los cambios de status (limpios desde el 20/11); hacen falta unas dos semanas |
| 15 | **Qué línea atiende hoy** (Omega, Gizat o Voiso, por país) | Se aprende de las llamadas registradas y el status que queda después; todavía no hay llamadas registradas |

Descartadas: la "tanda" (mismos campaña y día de registro: 34% contra 26%, casi lo mismo que Campaña caliente) y las notas del CRM (la columna que se lee trae textos de unas 10 letras, sin horas ni días).

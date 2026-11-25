# Fuentes y cobertura comprobada — T02

Revisión inicial del 11/11/2026, 18:48 Madrid. **Corrección posterior: T02 reabierta. El usuario descarta la alternativa manual y exige vigilancia automática.** Los hallazgos y las muestras siguientes se conservan como investigación, pero su decisión manual inicial queda sustituida por [CUOTAS_AUTOMATICAS.md](CUOTAS_AUTOMATICAS.md). No hay proveedor automático validado todavía.

El catálogo legible por el programa está en [config/sources.json](../config/sources.json). Las muestras y huellas están en [source-audit-t02.json](source-audit-t02.json); los originales CC0 descargados están en data/source-audits/2026-11-11T17-48-16.763Z/.

## Decisiones para comenzar

| Necesidad | Fuente elegida | Comprobación | Acceso y coste | Limitación principal |
|---|---|---|---|---|
| Históricos de resultados | [OpenFootball](https://github.com/openfootball/football.json), CC0 declarada | Seis temporadas descargadas; tres completas en la muestra | Sin clave, 0 € de proveedor | Hay huecos y actualización reciente insuficiente; no contiene cuotas, xG o lesiones |
| Calendario y resultados recientes | [ESPN scoreboard](https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=20261122), como complemento experimental | Cuatro partidos futuros con UTC; cinco finalizados de otra fecha con marcador | Endpoint público probado sin clave; sin garantía contractual | Condiciones de reutilización y cobertura completa pendientes para la integración; contraste con referencia oficial |
| Referencia oficial | [Calendario de LaLiga](https://www.laliga.com/laliga-easports/calendario) | Temporada 2026/27 visible; el texto descargado no mostró partidos | Web pública | No se ha demostrado un recolector automático de horarios oficiales |
| Titulares actuales | [RSS de Mundo Deportivo](https://www.mundodeportivo.com/rss/futbol/laliga.xml) | 100 entradas, con titular, URL y fecha; la última del día de la auditoría | Público sin clave | Metadatos, no artículos completos ni confirmación de lesiones |
| Segundo RSS | [MARCA](https://e00-marca.uecdn.es/rss/futbol/primera-division.xml) | 49 entradas; última publicación recibida del 07/11 | Público sin clave | Muestra antigua: no utilizarla como actualidad del 11/11 |
| Precio de las recomendaciones | Entrada manual de lo que el usuario vea en Bet365 | Decidida como alternativa de T02; se implementa en T05 | Sin proveedor contratado | Primera cuota de la cuenta del usuario y formulario todavía pendientes |

Los RSS y ESPN no declaran una licencia abierta en la muestra. Se registra ese estado expresamente: acceso público no equivale a una autorización ilimitada de redistribución o entrenamiento. La implementación debe respetar sus condiciones, usar referencias y fragmentos mínimos y no copiar artículos completos por defecto. No se considera noticia verificada un titular solo por haberlo descargado.

## Cobertura real de los históricos

| Temporada | Filas | Marcadores finales | Filas pasadas sin marcador |
|---|---:|---:|---:|
| 2021/22 | 380 | 380 | 0 |
| 2022/23 | 380 | 380 | 0 |
| 2023/24 | 380 | 380 | 0 |
| 2024/25 | 380 | 370 | 10 |
| 2025/26 | 380 | 365 | 15 |
| 2026/27 | 380 | 64 | 56 a fecha de revisión |

La muestra contiene **1.939 marcadores**, de los cuales 1.140 corresponden a las tres primeras temporadas completas. No se ha auditado todavía cada resultado contra otra fuente ni descartado todos los duplicados; ese trabajo corresponde a T03/T04. No se confunde número de filas con partidos terminados.

En el archivo 2026/27 el último resultado es del 20/09/2026 y faltan horas en 290 filas. Sus fechas por jornada pueden ser provisionales: para el encuentro Elche–Betis aparecía fecha genérica del domingo; ESPN aporta además 13:00 UTC. No convertir una fecha sin hora en medianoche como si fuera el inicio confirmado. La hora UTC de ESPN debe convertirse a Europe/Madrid sin desplazarla dos veces.

El [README de OpenFootball](https://github.com/openfootball/football.json) advierte que la generación automática del JSON no garantiza actualización diaria de los datos de origen. La [licencia descargada](https://github.com/openfootball/football.json/blob/master/LICENSE.md) declara CC0-1.0. Conservamos ambas limitaciones: licencia abierta y calidad/actualidad son cuestiones diferentes.

## Muestras de calendario y resultados

- Consulta de 22/11/2026: evento ESPN 401882804, Barcelona–Villarreal, estado programado, inicio 13:00 UTC. Es una muestra de la respuesta obtenida, susceptible de cambio de horario.
- Consulta de 08/11/2026: evento 401882814, Elche–Betis, estado finalizado, resultado 0–2. En esta segunda consulta los cinco eventos devueltos figuraban finalizados.
- Una petición con rango agosto–noviembre y limit=1000 devolvió HTTP 400. No se asume que ese método permita descargar toda una temporada. T04 deberá usar consultas admitidas y verificar los huecos.

## Cuotas de Bet365: elección y candidato de automatización

**Vía inicial: entrada manual.** Se ha documentado el formato y se desarrollará en T05. No necesitamos la contraseña de Bet365. Un informe actualizado requerirá cargar precios observados recientemente; una cuota caducada o sin confirmar no dará lugar a una recomendación accionable.

Hay una muestra pública de precios atribuidos a Bet365 por [OddsAPI.dev para LaLiga](https://www.oddsapi.dev/odds/la-liga): Elche–Betis, 08/11/2026 a las 13:00 UTC; 1X2 3,50 / 3,60 / 2,00. La página indicaba actualización del 07/11 a las 07:02 UTC. También mostraba más/menos 2,5 goles a 1,67 / 2,20. Es un **ejemplo archivado del proveedor**, no un precio confirmado en la cuenta del usuario ni una oportunidad vigente. El JSON de demostración contiguo en esa web pertenece a Pinnacle; no se reutiliza como si fuera Bet365.

El [proveedor publica](https://www.oddsapi.dev/) planes desde 50 USD/mes y prueba de siete días. No se ha creado una cuenta, activado una prueba, contratado nada ni probado su API con clave. La procedencia regional, equivalencia de reglas y coincidencia con Bet365 del usuario deben contrastarse antes de seleccionarlo. Permanece como candidato, no como fuente automática activa.

## Catálogo acotado de la primera familia

Para que la primera entrega pueda aceptarse sobre un alcance concreto, se registra en sources.json el catálogo candidato: 1X2, doble oportunidad, empate no válido, hándicap europeo con línea local -1/+1 y asiático con las líneas locales enumeradas allí, entre -1,5 y +1,5. Se evaluarán solo las que realmente se observen en Bet365 y tengan reglas comprobadas. No se simula la oferta de un mercado ni se da por implementado su modelo. Los mercados equivalentes se identificarán para no duplicar riesgo.

## Campos todavía no resueltos para familias posteriores

No están acreditadas fuentes completas para xG, lesiones históricas con fecha de conocimiento, alineaciones, minutos, árbitros, córners, tarjetas o estadísticas detalladas de jugadores. Las noticias pueden aportar hechos, pero no sustituyen un histórico estadístico ni garantizan cobertura de todos los clubes. Cada familia debe resolver sus propios datos antes de activarse.

## Evidencia y repetición

- Auditoría completa exitosa: data/source-audits/2026-11-11T17-48-16.763Z/audit.json.
- Comprobación posterior de resultados recientes: data/source-audits/2026-11-11T17-48-47.316Z/audit.json.
- Ambas se recopilan, conservando el intento HTTP 400, en [source-audit-t02.json](source-audit-t02.json).
- `node scripts/audit-sources.mjs` repite una auditoría puntual; requiere acceso a Internet. `--only=espn-current-results` consulta únicamente esa fuente. No es una tarea programada ni el importador de producción.
- El fallo inicial de conexión restringida se conserva en data/source-audits/2026-11-11T17-46-57.317Z/audit.json. Las consultas posteriores funcionaron con acceso de red permitido; no era una caída simultánea de todas las fuentes.

**Estado corregido de T02:** históricos y muestras investigados; falta validar cuotas automáticas de Bet365. No hay pronósticos ni cuotas ejecutables generados. Las menciones anteriores a entrada manual describen la decisión inicial, ya descartada como solución operativa.

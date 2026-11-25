# Históricos, calendario, noticias y Qwen — T04, T09 y T10

Comprobado el 15/11/2026. Los módulos funcionan con Node.js 24 y las fuentes gratuitas existentes, sin nuevas dependencias ni cambios en el bot cripto.

## Datos reales incorporados

`src/data/service.ts` exporta `refreshData({ network, analyzeNews, request })`, `loadData()` y `canonicalTeamName()`. La actualización guarda las capturas y observaciones en `data/laliga.sqlite` y publica de forma atómica `data/snapshot.json` para el panel y los modelos.

- 29 clubes históricos con correspondencias explícitas. Se reconocen los 20 nombres de MoviOdds y los nombres canónicos de OpenFootball. Los nombres desconocidos se notifican; no se unen por aproximación. El alias genérico «Deportivo» observado en ESPN solo se añade al catálogo de identificación y a esa fuente; no se utiliza para atribuir noticias al Dépor cuando el texto habla del Deportivo Alavés.
- 2.280 fichas de seis temporadas, 2021-22 a 2026-27. La actualización real contiene **2.019 marcadores finalizados**: cinco temporadas de 380 resultados y 119 de la actual. La ficha Rayo–Athletic no contiene resultado porque corresponde a un partido suspendido: su estado se contrastó con las fuentes oficiales y se conserva sin marcador final.
- Los resultados de OpenFootball consultados el 15/11 siguen incompletos después del 20/09/2026. Las consultas públicas experimentales de ESPN completan huecos y aportan resultados hasta el 08/11/2026 y **19 próximos encuentros con hora UTC** en los siguientes 15 días. El resto del calendario puede seguir siendo provisional.
- La cobertura distingue cada fuente de la vista fusionada, con partidos, marcadores, fechas del último resultado, horas desconocidas y huecos. Que una fuente esté desactualizada no se oculta al completar una ficha con otra.

[OpenFootball](https://github.com/openfootball/football.json) declara CC0-1.0; no exige clave. Sus campos de hora local no declaran zona: se conserva `date` y `kickoffAt: null`, sin inventar una conversión UTC. ESPN es una fuente pública experimental sin garantía ni licencia abierta confirmada; no se presenta como servicio contratado. Se conserva su procedencia y no se publica ni revende su feed.

Las capturas guardan fuente, URL, contenido, huella, solicitud y recepción. Una misma captura no cambia de fecha al releerse desde caché. `availableAt` indica cuándo recibimos el conjunto, aunque sus partidos sean antiguos. La evaluación reconstruida por fecha del encuentro no equivale a una prueba de que estas capturas estaban disponibles en aquel momento. Ningún resultado futuro o del día actual sin hora confirmada se toma como un resultado histórico finalizado.

**Revisión de la suspensión:** la [ficha oficial del Rayo](https://www.rayovallecano.es/partidos/temporada-2026-2027-laliga-ea-sports-8-rayo-vallecano-vs-athletic-club-2997) muestra el partido suspendido tras iniciarse; el [calendario oficial de LaLiga](https://www.laliga.com/clubes/rayo-vallecano/proximos-partidos) publica su reanudación el 9 de diciembre, a las 20:00. La fecha se conserva como `2026-12-09`, la hora como etiqueta de la fuente y `kickoffAt` permanece desconocido. No se inventa una conversión UTC. Las dos páginas y un metadato derivado que las enlaza quedan capturados en SQLite. La ficha no se entrena como 0-0 y no cuenta como resultado perdido. Su eventual reanudación tampoco puede analizarse con un modelo de 90 minutos nuevos.

El calendario experimental consulta fechas individuales: huecos identificados, ocho semanas recientes y 15 días siguientes. Cada petición tiene un límite de 12 segundos y 3 MB. Se reutiliza la caché: históricos completos siete días, temporada actual cuatro horas, calendario pasado siete días, próximo seis horas y noticias treinta minutos. Un fallo conserva muestras con sus horas originales y una advertencia. No crea información nueva para ocultar el fallo.

## Noticias recogidas

La actualización pública obtuvo **100 elementos RSS** de Mundo Deportivo. Se guardan URL, publicación, recepción, titular y hasta 500 caracteres del resumen disponible. No se descarga el artículo completo, no se incorpora `content:encoded` y el campo `scope` distingue metadatos de extractos. Los textos se convierten a texto plano; no se ejecutan etiquetas, scripts ni entidades externas.

La última publicación observada en este RSS es del 11/11, no del 15/11. El sistema muestra las fechas, no afirma que cien elementos sean cien noticias de hoy. Este RSS no ofrece una cobertura exhaustiva de lesiones, sanciones, convocatorias ni todas las fuentes oficiales.

Se eliminan duplicados de URL y se agrupan textos iguales como copias de una información. Varias copias no pasan a ser confirmaciones independientes. Los equipos se asignan mediante nombres explícitos presentes en titular o resumen. Si falta fecha se conserva como desconocida y la noticia no se utiliza como evidencia reciente de Qwen. Si no hay noticias o falla la descarga, se identifica la ausencia y solo se muestra el metadato archivado disponible, sin suponer que no hay bajas.

## Qwen local

La extracción utiliza `qwen3:8b` en `http://127.0.0.1:11434/api/chat`. Se comprobaron los parámetros contra la [documentación oficial de Ollama](https://docs.ollama.com/api/chat). La petición no transmite noticias a un servicio externo, no usa herramientas y trata su contenido como datos no fiables. Pide JSON con esquema, temperatura cero, contexto de 4.096, un máximo de salida y 45 segundos de espera. Las peticiones de este bot se serializan y usan dos hilos; el monitor de cuotas no tiene que esperar al análisis de noticias. No se modifica ni se detiene el proyecto cripto. La cola es propia de este bot, no una cola global compartida con aquel proyecto.

Se revisan hasta seis noticias recientes fechadas y vinculadas por petición. Cada hecho debe indicar tipo, equipo, jugador si aparece, cita literal, identificador de noticia e incertidumbre. La validación rechaza citas o nombres ausentes, equipos ajenos, noticias antiguas, copias, campos no previstos y conversiones de dudas o rumores en hechos confirmados. Un artículo de un medio no se clasifica por sí solo como comunicado oficial.

**Prueba real:** el 15/11 a las 10:34 UTC Qwen respondió en unos siete segundos a seis resúmenes RSS reales. Devolvió `facts: []`: los textos hablaban de entradas, resultados e imágenes, sin datos explícitos suficientes para afirmar bajas. La abstención se mantuvo y figura en `data/news-analysis.json`; no se inventaron lesiones para rellenar el informe. Una respuesta satisfactoria al protocolo no demuestra que la extracción esté libre de errores semánticos: sigue identificada como experimental.

Los hechos no cambian por sí solos ninguna probabilidad ni cantidad a apostar. Su aportación numérica requerirá evaluación; el estado del modelo o la seguridad declarada por Qwen no sustituye una probabilidad calibrada.

## Comprobaciones

```powershell
node scripts/refresh-data.ts
node scripts/refresh-data.ts --no-ai
node scripts/refresh-data.ts --offline --no-ai
node --test test/data.test.ts test/data-fetch.test.ts test/news.test.ts
```

Las pruebas cubren identidad de equipos, fechas desconocidas, huecos, resultados futuros y duplicados, calendario con zona, aplazamientos, reutilización de muestras, errores de HTTP y límites de tamaño. Para noticias se comprueban fechas, alcance, duplicados, contenido no ejecutable, rumores, citas inventadas, nombres incorrectos, IA caída, abstención y concurrencia. Los datos controlados viven en las pruebas, no se cargan como marcadores o noticias reales.

La carga histórica, el calendario experimental, el recolector RSS y la extracción local están implementados y comprobados. Esto no valida precios regionales de Bet365 ni demuestra rentabilidad. La cobertura de todas las fuentes y todas las familias sigue siendo la que conste en el panel.

## Puerta de calidad deportiva

`src/data/quality.ts` exporta `assessingSportsReadiness(snapshot, event, now)`. Devuelve `ready`, `passed`, motivos, avisos y un diagnóstico por equipo. Exige un archivo actualizado en 24 horas, al menos 300 marcadores globales y ocho por club, un resultado por club en los últimos treinta días y ausencia de resultados desconocidos de los últimos 180 días que involucren a sus participantes. Los aplazamientos documentados quedan excluidos de forma y resultados; se distinguen de los huecos sin explicación.

Un resultado ausente de Rayo–Athletic bloquearía importes para sus equipos mientras se desconozca su estado; no bloquearía un Barcelona–Getafe con datos completos. Resuelta la suspensión mediante fuentes oficiales, ambos clubes pueden analizar sus otros encuentros, conservando la advertencia. Para la propia reanudación sigue bloqueada la predicción de 90 minutos completos. Las lesiones y alineaciones no cubiertas permanecen desconocidas.

La calidad solo usa resultados anteriores al corte y capturas recibidas antes de él (`availableAt <= now`). Los resultados sin hora no se dan por disponibles hasta después de su fecha completa; los que tienen inicio confirmado reciben un margen conservador de dos horas. Siete pruebas adicionales cubren estos casos, incluido que los datos recibidos en el futuro no reparan retroactivamente un historial insuficiente.

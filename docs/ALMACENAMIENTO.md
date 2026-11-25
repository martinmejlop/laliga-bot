# T03 — Historial de datos comprobado

Completada el 11/11/2026. Almacenamiento local con SQLite incluido en Node.js 24: sin instalar paquetes, contratar servicios ni compartir la base del bot cripto.

## Qué guarda

- Equipos con identificadores internos y nombres explícitos por fuente. Se han configurado los 20 equipos de la muestra; los nombres desconocidos se rechazan y registran como incidencia. La correspondencia de jugadores se añadirá con sus familias.
- Partidos identificados por competición, temporada, local y visitante, vinculando los identificadores de cada fuente. Un cambio de horario o aplazamiento crea otra observación del mismo encuentro.
- Cuotas por partido, mercado, periodo, selección y línea, con precio, último cambio, última confirmación, solicitud, recepción, suspensión y estado de verificación regional. Las nuevas observaciones conservan las anteriores.
- Noticias con URL, titular, texto disponible, publicación, recepción, versiones y equipos vinculados explícitamente. Una asociación errónea se corrige con una nueva versión.
- Estadísticas, versiones de modelos, predicciones e informes como documentos versionados, con referencias obligatorias a las capturas utilizadas. Almacenar estos documentos no crea ni valida un modelo predictivo.
- Contenido de cada muestra, formato, URL, fuente, huella SHA-256 y hora de incorporación al archivo. Las incidencias permanecen visibles.

## Dos archivos separados

| Archivo | Contenido actual | Uso |
|---|---|---|
| `data/laliga.sqlite` | Dos fuentes y catálogo de 20 equipos; sin partidos, cuotas, noticias ni modelos cargados | Base preparada para las siguientes tareas |
| `data/storage-validation.sqlite` | Tres muestras archivadas de cuotas y un registro de metadatos RSS | Comprobación aislada; sin recomendaciones |

El esquema tiene versión e identificador del proyecto. Se rechaza abrir una base ajena como si fuera la de LaLiga. Las tablas de evidencia impiden reescrituras y borrados; las correcciones añaden observaciones. Cada importación es una transacción: si falla una correspondencia, se revierte el lote y se conserva la incidencia. Reimportar la misma captura devuelve sus identificadores sin duplicar registros; reutilizar su clave con otro contenido produce un conflicto visible.

Las horas se almacenan en milisegundos UTC. Las horas de calendario desconocidas son `null`, nunca una medianoche inventada. Las consultas de historial de partidos, cuotas y noticias admiten un instante de corte: exigen tanto recepción como incorporación anteriores al corte. Importar hoy un resultado antiguo no demuestra que el bot lo conociera años atrás. La fecha original de una captura archivada tampoco se cambia por la hora de reimportación.

El archivo no decide si una cuota es accionable: conserva los datos que necesitan los controles de vigencia. Una cuota antigua o de región sin contrastar sigue teniendo esas limitaciones después de guardarse.

## Evidencia real de almacenamiento

Comprobante reproducible en [storage-evidence.json](storage-evidence.json):

- 20 partidos y 60 observaciones de calendario, sin multiplicar encuentros al repetir la importación.
- 180 observaciones de cuotas: 60 selecciones en cada una de las tres capturas del 11/11/2026, entre las 18:47:37 y las 18:48:08 UTC. Son observaciones sucesivas, no 180 selecciones diferentes ni cambios de precio acreditados.
- Una noticia de la auditoría RSS vinculada a FC Barcelona por la correspondencia explícita «Barça». Solo se conserva el titular y su metadato; no se afirma haber leído el artículo.
- Segunda importación idéntica sin cambios en los recuentos, las muestras o sus huellas.
- Integridad SQLite correcta, cero errores de referencias y cero incidencias en esta comprobación.

Los archivos de cuotas son el JSON **normalizado** que guardó la prueba de T02, identificado como `normalized-moviodds-board-v1`. Se conserva ese texto exacto; no se presenta como el cuerpo HTTP original. La muestra de noticias es un registro de la auditoría de T02, con formato `rss-audit-record-v1`: el XML original y el artículo completo no se guardaron. Para ese registro, recepción significa finalización de la auditoría, no una hora de respuesta HTTP medida individualmente.

Las tres capturas reales no mostraron variaciones de precio. Las pruebas aisladas verifican que los cambios y suspensiones se conservan, que se rechazan asociaciones erróneas y que una importación tardía no aparece en un historial anterior. **Estas pruebas no cierran T02 ni T05.** Los precios de Bet365 España y los cambios reales siguen pendientes de contraste.

## Comprobaciones y consulta

```powershell
npm.cmd run storage:init
npm.cmd run storage:status
npm.cmd run storage:check
npm.cmd run storage:status -- --validation
npm.cmd test
```

`storage:init` prepara la base y el catálogo, de forma repetible. `storage:check` usa las muestras locales ya archivadas, sin consultar Internet, y actualiza el comprobante. `storage:status` abre la base en modo lectura. Para consultar una captura del comprobante:

```powershell
npm.cmd run storage:evidence -- 3e2e878e-d852-4fd1-8d72-8169761a6b97 --validation
```

Ese identificador corresponde a la primera captura de la comprobación de este equipo; los identificadores vigentes figuran en `storage-evidence.json`. La consulta devuelve formato, horas, huella y texto conservado. Sin `--validation` consulta la base de uso diario.

La suite completa supera **32 pruebas**, incluidas **13 de almacenamiento**: repetición, versiones de cuotas y noticias, historia con corte temporal, conflictos, equipos, aplazamientos, documentos derivados con evidencia, persistencia al reabrir, referencias y rechazo de una base ajena. Los datos controlados de estas pruebas viven en memoria o carpetas temporales, nunca en la base de uso diario.

No se han cargado históricos completos, iniciado vigilancia permanente, creado pronósticos, calculado importes ni registrado apuestas. El siguiente paso de implementación es T04; puede avanzar con los formatos ya identificados sin dar por cerrada la validación regional de cuotas.

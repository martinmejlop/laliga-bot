# Aceptación de fuentes y cuotas — 23/11/2026

Estado comprobado: T02, 4/5 criterios; T05, 6/7. Ambas comparten un único requisito pendiente: observar suspended=true en una selección del catálogo inicial, con identidad y tiempos coherentes. No se ha sustituido ese requisito por una simulación ni por un mercado retirado.

Catálogo inicial acotado: resultado final, doble oportunidad y resultado sin empate. Los hándicaps y demás familias conservan su cálculo/investigación y no producen importes hasta ampliar el catálogo con reglas, contraste y validación propios.

## Evidencia

- 210 lecturas nuevas entre el 22/11 a las 18:08 y 18:31 Madrid, tres partidos, cero errores de transporte.
- 982 capturas comparables de fuente en el conjunto auditado; 123 cambios coherentes y 15 retiradas de disponibilidad de fuente. No equivalen a cierres comprobados en la página española.
- 19 selecciones aceptadas de siete mercados repartidos en tres partidos. Getafe–Atlético y Levante–Elche tienen los tres mercados completos. Osasuna conserva solo resultado final: doble oportunidad se excluyó por horas incoherentes y sin empate por discrepancia de precios.
- Serie histórica continua de 300 consultas intercaladas durante 103,6 minutos, con hueco máximo 23,2 segundos. No implica que todos los partidos estén reconfirmados continuamente.
- Duración HTTP p95 de la muestra: 1.687 segundos. La edad de la confirmación se mide por separado y puede ser elevada. No se ha medido la propagación exacta desde Bet365 España.
- 174 pruebas correctas antes de esta entrega; el botón del panel vuelve a ejecutar la suite completa y guarda el TAP por huella.

## Funcionamiento

El panel muestra cada criterio y la fecha de su evidencia. «Comprobar evidencia y pruebas» vuelve a analizar la base y ejecuta las pruebas, sin apostar ni consumir consultas externas de cuotas. Mientras está abierto el bot, la evidencia se reevalúa también periódicamente cada 30 minutos. La vigencia de fuentes y perfil se revalida en cada consulta del informe; una etiqueta antigua de éxito no abre la puerta a importes.

La captura pública española conserva URL, encabezado, precio, equipos y horario. Su compatibilidad muestral caduca en 24 horas: el monitor no renueva ese contraste simplemente leyendo el proveedor. Renovarlo requiere otra comparación pública real. El estado indicará su caducidad si ocurre; no se amplía el plazo para aparentar cobertura.

El programa aísla cuotas con tiempos incompatibles y conserva los originales. Un lote estructuralmente ambiguo se rechaza entero. Retiradas por inicio se distinguen de ausencias RAW del proveedor; stale se distingue de suspensión explícita. Los reintentos y su plazo sobreviven a reinicios. No se publica una caché como nueva al arrancar.

Los originales de la serie y las tres lecturas públicas se han incorporado a SQLite. Las copias incluyen catálogo, estado de aceptación, prueba por huella y archivos operativos del monitor; la clave de MoviOdds queda excluida.

El monitor permanece funcionando. Hasta superar la aceptación técnica, todas las propuestas son de observación.

## Pendiente externo

La prueba de inicio de Osasuna mostró retiradas, pero ningún flag de suspensión explícita válido dentro de los tres grupos iniciales. Las suspensiones de otros grupos no se utilizan para completar este requisito. El auditor podrá reconocer una futura muestra válida y actualizar el progreso; requiere que el bot esté encendido y la fuente efectivamente la publique. No hay garantía de fecha.

## Copia real recuperada — 23/11
La base de evidencias supera los 5 GB. Se corrigió el cálculo de huellas para leer por bloques en lugar de cargarla entera en memoria. Copia comprobada en data/backups/2026-11-23T08-02-08.516Z-b6ea6e6e: integridad SQLite ok, recuperación aislada correcta, estado de aceptación y comprobantes incluidos, clave excluida. Las dos copias incompletas creadas durante esta prueba se eliminaron tras verificar que carecían de manifiesto.

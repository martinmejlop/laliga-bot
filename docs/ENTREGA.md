# Entrega integrada — 15/11/2026

**16 de 18 tareas comprobadas.** El recorrido local está integrado; T02 y T05 mantienen pendiente su aceptación externa completa. Se entrega un asistente experimental consultable, sin declarar rentabilidad demostrada ni cobertura de todas las apuestas.

## Datos y modelo

- 2.280 partidos, 2.019 resultados y 29 clubes. Cinco temporadas completas tras complementar huecos con ESPN experimental. La temporada actual tiene 119 resultados y una suspensión oficial, sin rellenarla con 0-0.
- 19 próximos partidos con UTC explícito en la fuente de calendario. Las horas sin zona quedan desconocidas; los horarios del proveedor de cuotas no se presentan como oficiales confirmados.
- Rayo–Athletic se suspendió tras comenzar. Su reanudación se excluye del modelo de 90 minutos nuevos. Una descarga más reciente de un calendario comunitario no revoca ese estado oficial documentado.
- Prueba final de 404 partidos: error logarítmico 0,96756 frente a 1,05180 de referencia; Brier 0,57286 frente a 0,63386; acierto 53,96 %. Los parámetros se eligen en validación, sin utilizar el periodo final.
- Se comprueban 63 selecciones predefinidas. Cada lado y línea necesita aprobación exacta; no se extrapola a toda una familia. Goles totales y ambos marcan no superan los controles actuales.
- No hay cuotas históricas verificadas suficientes para publicar beneficio o ROI. Reconstruir resultados por fecha no demuestra qué información estaba disponible en el pasado.
- 100 noticias RSS y Qwen local comprobado con material real. Se abstuvo de inventar bajas. El feed no ofrece noticias de los últimos dos días; la cobertura actual de contexto se declara incompleta.

## Cuotas y panel

La consulta real obtuvo **20 partidos y 500 cuotas**, con 460 selecciones compatibles con los mercados matemáticamente implementados. Se archivó la respuesta y se excluyó una cuota con horas incoherentes, sin fingir que el proveedor la hubiera suspendido. Un fallo de una selección se aísla; una respuesta global fuera de orden o un precio cambiado sin fecha coherente invalida el lote.

Se contrastaron siete selecciones de Athletic–Espanyol en la página pública de Bet365 España: resultado, goles 2,5 y ambos marcan. URL, hora y precios constan en **config/region-audit.json**. No se accedió a la cuenta del usuario ni se seleccionaron apuestas. El contraste solo sirve para esas selecciones con el mismo precio durante 24 horas; no se extiende al resto de mercados ni se renueva con otra consulta al proveedor.

El navegador comprobó conexión, filtros, límite de 20 observaciones, noticias, evaluación, registro separado y creación de copia. No se observaron errores de consola. Si caduca una cuota o se pierde la conexión, el panel pone su importe en 0 €.

La etiqueta **Gran oportunidad · experimental** exige todos los controles, importe positivo y valor esperado estimado de al menos 8 %. Ese umbral no es un intervalo de confianza ni acredita beneficio. El saldo y el mínimo de cuenta los confirma el usuario; los límites son 1 % por selección y 5 % conjunto, con controles adicionales de partido, equipo y exposición ya registrada.

## Comprobaciones

**111 pruebas** de configuración, datos, identidad, fusión de fuentes, calidad, fechas, noticias, IA, modelos, mercados, valor, importes, registro, persistencia, monitor, fallos y HTTP.

El recorrido HTTP prueba en una carpeta temporal: 100 € → registro de 2 € → corrección a 3 € → liquidación ganadora a cuota 2 → 103 €, repitiendo solicitudes sin duplicar dinero. Comprueba también la simulación separada y los rechazos de sesión, origen y formularios inválidos. No se realiza ninguna apuesta externa.

El registro de uso diario permanece sin apuestas ficticias y sin saldo confirmado. La copia real creada desde el panel se abrió en una carpeta aislada: integridad SQLite correcta, referencias a capturas consultables, reconstrucción de ambos libros y huellas del manifiesto correctas. No se sustituyó la base de uso diario.

## Aceptaciones pendientes

**T02:** ampliar y sostener el contraste regional, reglas, disponibilidad y cobertura gratuita. La página pública no acredita todas las condiciones de una cuenta concreta.

**T05:** completar series observadas de cambios, suspensiones y retiradas reales y demoras medidas. Las pruebas controladas pasan; comparar capturas de días diferentes no se presenta como una medición de latencia continua.

Córners, tarjetas, faltas, jugadores, porteros, temporada, directo y combinadas necesitan datos, reglas, modelos y evaluación propios. Conservan su alcance y no se presentan como analizados.

## Funcionamiento elegido

Solo el panel, sin hora fija y sin mensajes externos. Datos y noticias se revisan periódicamente con caché; el modelo se rehace al cambiar sus entradas o envejecer. La vigilancia usa contador persistente, respeta reintentos y se detiene antes de superar el margen gratuito. No se instala una automatización de Codex ni una tarea de inicio de Windows.

**Iniciar bot.cmd** abre el panel; **Detener bot.cmd** cierra el bot completo. Cerrar la pestaña conserva el servidor en ejecución. Tras reiniciar el equipo hay que volver a abrir el bot. Las copias requieren esta misma versión del proyecto y Node.js 24 para recuperar el funcionamiento.

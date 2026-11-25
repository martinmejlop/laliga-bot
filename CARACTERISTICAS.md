# Bot de oportunidades de LaLiga — lista de implementación

Versión inicial: 11 de noviembre de 2026.

Objetivo: vigilar automáticamente las cuotas de LaLiga en Bet365 y avisar cuando aparezcan oportunidades, actualizándolas o retirándolas cuando dejen de cumplir los criterios. Entregar además un informe diario con análisis deportivo amplio, probabilidades, cuota vigente, justificación e importe propuesto sobre un presupuesto inicial de 100 €. El usuario decide y realiza manualmente todas las apuestas. La rentabilidad debe medirse; no se presume por disponer de más datos o de una IA.

Alcance confirmado: asistente de análisis y recomendaciones, exclusivamente para Bet365 por ahora. La automatización abarca recogida de datos, análisis, informes y seguimiento. No se implementarán depósitos, retiradas, transferencias, envío de apuestas ni control automático de la cuenta de Bet365. Preferencia confirmada: consulta continua en el panel, sin hora fija ni avisos externos. No hay una tarea de entrega programada.

Coste de datos autorizado: **0 €; solo fuentes gratuitas**. Se excluyen suscripciones y pruebas de pago o renovación automática. Se ha probado acceso público gratuito de MoviOdds, pendiente de contraste con Bet365 España y medición de cambios reales.

Estado actual de implementación y comprobación: 16 de 18 tareas en [PROGRESO.md](PROGRESO.md). Las funciones de este catálogo tienen una numeración distinta. Los modelos y su valor esperado son experimentales; las familias incompletas y las validaciones regionales pendientes siguen identificadas.

## Cómo avanzaremos

- Implementaremos y verificaremos un punto cada vez, manteniendo esta lista actualizada.
- Completaremos una familia de mercados antes de activar la siguiente. El orden de las familias es una propuesta revisable, sin excluir las posteriores.
- Cada punto se marcará como terminado con evidencia de funcionamiento. Las funciones que dependan de datos no disponibles se identificarán expresamente.
- La primera cartera será de 100 € simulados. Los posibles costes de datos se presupuestarán aparte; este plan no contrata servicios ni autoriza apuestas reales.
- El diseño final permitirá registrar las apuestas que el usuario haga manualmente. Una recomendación nunca se contabilizará como apuesta realizada por el hecho de aparecer en el informe.

## Base compartida

- [x] **01. Proyecto y configuración.** Crear un proyecto independiente del bot cripto, configurar LaLiga, Bet365 como única casa de ejecución manual, zona horaria Europe/Madrid, moneda EUR y saldo inicial de 100 €. Terminado cuando arranque, lea su configuración y muestre su estado y carácter de asistente sin capacidad de mover dinero.
- [ ] **02. Identificación de partidos, equipos y jugadores.** Unificar nombres e identificadores entre fuentes y mantener calendario, horarios y cambios de fecha. Terminado cuando podamos unir estadísticas, noticias y cuotas al partido correcto sin coincidencias ambiguas.
- [ ] **03. Catálogo real de mercados de Bet365.** Comprobar cobertura automática de Bet365 para LaLiga, mercados, líneas, mínimos y reglas aplicables a la cuenta/región del usuario. Validar precios, fechas de origen, recepción, suspensión y demora con datos reales. La entrada manual está descartada como fuente operativa. No automatizar apuestas ni sortear restricciones de acceso; los mercados sin cuota vigente no generarán una recomendación accionable.
- [x] **04. Archivo de datos y cuotas con fechas.** Conservar fuente, hora de publicación, hora de recepción y cambios de cuotas, sin sobrescribir el historial. Terminado cuando podamos reconstruir qué sabía el bot en un momento anterior al partido. Implementado en T03: capturas, versiones y consultas con corte temporal, con comprobaciones de duplicados, conflictos y persistencia. [Evidencia y límites](docs/ALMACENAMIENTO.md). La recogida continua y la validación de precios actuales siguen en sus propias tareas.
- [x] **05. Históricos y contexto deportivo.** Recopilar resultados, estadísticas, forma reciente, nivel del rival, localía, descansos, calendario y, según cobertura, xG, alineaciones y minutos. Terminado cuando la cobertura y los datos ausentes estén medidos; ausencia de información no significará cero lesiones o cero actividad.
- [x] **06. Comparación con el mercado.** Calcular probabilidades implícitas, estimar márgenes y comparar la cuota de Bet365 con el modelo. Otras casas, cuando haya datos, solo servirán de referencia analítica. Terminado cuando se distingan correctamente jugador, periodo, línea y reglas, y las recomendaciones utilicen el precio realmente disponible en Bet365; el consenso del mercado será una referencia, no la verdad.
- [x] **07. Gestión común del presupuesto.** Proponer importes sobre el saldo actual confirmado por el usuario, partiendo de 100 €, mediante una política configurable con límites por apuesta, partido y exposición conjunta. Considerar capital comprometido, correlaciones, mínimos y redondeos, y repartir el presupuesto del informe como un conjunto. Mostrar total recomendado y dinero libre; no tratar los 100 € como una cantidad que deba gastarse cada día. Terminado cuando el cálculo pueda justificar un importe o devolver 0 €; una apuesta mínima excesiva se descartará y un saldo sin confirmar se identificará como tal.
- [x] **08. Registro manual y simulación separados.** Conservar cada recomendación y permitir que el usuario marque realizada, omitida, modificada o pendiente. Registrar importe y cuota realmente aceptados en Bet365, con posibilidad de corrección y conciliación del saldo. Gestionar ganadas, perdidas, nulas, devoluciones y liquidaciones parciales, diferenciando resultado previsto y confirmado. Mantener por separado la cartera de prueba. Terminado cuando se reconstruya cada movimiento sin suponer que se apostaron todas las recomendaciones.

## Qwen y noticias

- [ ] **09. Recolección de noticias deportivas.** Incorporar fuentes oficiales y medios seleccionados, con enlaces, fechas, actualización y eliminación de duplicados. Terminado cuando se conserve el material que realmente recibió el bot.
- [x] **10. Extracción de hechos con Qwen local.** Adaptar Qwen3 8B mediante Ollama para extraer lesiones, sanciones, convocatorias, rotaciones, límites de minutos y declaraciones tácticas. Exigir evidencia textual, entidades, partido afectado e incertidumbres. Terminado cuando una muestra revisada permita medir errores y omisiones; Qwen podrá abstenerse.
- [ ] **11. Contraste y vigencia de la información.** Separar rumores, informaciones periodísticas y confirmaciones oficiales, detectar contradicciones y corregir hechos desactualizados. Terminado cuando varias copias de la misma noticia no se cuenten como fuentes independientes ni la confianza declarada por Qwen equivalga a verificación.
- [ ] **12. Medición de la aportación de las noticias.** Convertir hechos extraídos en variables de cada modelo y comparar resultados con y sin ellas. No permitir ajustes numéricos arbitrarios dictados por Qwen. Terminado cuando podamos medir si estas variables mejoran pronósticos futuros frente a su coste y errores. Compartir Ollama mediante una cola que coordine el trabajo con el bot cripto.

## Validación antes de activar familias

- [x] **13. Evaluación reproducible.** Separar entrenamiento, validación y prueba por fechas; utilizar únicamente datos disponibles al emitir la recomendación. Medir calibración, error probabilístico, beneficio neto, rentabilidad sobre lo apostado, exposición y caída máxima del saldo, con incertidumbre y tamaño de muestra. Comparar con las cuotas de mercado y controlar falsos hallazgos al probar muchas estrategias. El uso de Qwen en históricos se limitará a extraer evidencia del material proporcionado, evitando usar su memoria de resultados.

## Familias de apuestas — una a una

Cada familia debe completar el mismo recorrido: datos y reglas → modelo probabilístico → comparación con cuotas → evaluación histórica cuando existan cuotas y datos adecuados → recomendaciones simuladas antes del evento → liquidación y seguimiento. Si faltan históricos de cuotas, empezará a recogerlos y no afirmará una rentabilidad retrospectiva que no pueda reproducirse. Las probabilidades se evaluarán por mercado y línea; las devoluciones y medias ganancias/pérdidas tendrán su cálculo específico.

- [ ] **14. Resultados y hándicaps.** 1X2, doble oportunidad, empate no válido y hándicaps europeos y asiáticos, incluidas líneas de cuarto de gol.
- [ ] **15. Goles.** Totales, goles por equipo, ambos marcan, porterías a cero y marcadores exactos, con las líneas realmente ofrecidas.
- [ ] **16. Mitades e intervalos.** Resultados, goles y otros mercados por periodo; descanso/final y tramos temporales cuando haya datos suficientes.
- [ ] **17. Córners.** Totales, por equipo, hándicaps, comparación entre equipos y periodos; considerar estilo, centros y situación de partido si aportan mejora medible.
- [ ] **18. Tarjetas.** Totales, por equipo, jugador amonestado y expulsiones; contemplar árbitro, posición, minutos previstos, faltas y reglas de cómputo de cada casa.
- [ ] **19. Faltas y fueras de juego.** Mercados por equipo o jugador, con atención al rival, posición, estilo y definición del proveedor de estadísticas.
- [ ] **20. Goleadores y asistencias.** Goleador en cualquier momento, primero/último, múltiples goles y asistencias; estimar titularidad, minutos, penaltis y balón parado, con sus incertidumbres.
- [ ] **21. Remates de jugadores.** Tiros totales y a puerta, líneas alternativas y, si se ofrecen, mercados por equipo; incorporar minutos, función táctica y rival.
- [ ] **22. Otras estadísticas de jugadores.** Pases, entradas, recuperaciones y otras acciones disponibles, modeladas y validadas por separado según cobertura y reglas.
- [ ] **23. Porteros.** Paradas y otros mercados específicos disponibles; tener en cuenta volumen y calidad de tiros rivales, minutos y posibilidad de cambio de portero.
- [ ] **24. Temporada.** Campeón, descenso, clasificación europea y premios individuales disponibles; actualizar probabilidades con resultados, calendario y plantillas, considerando el capital comprometido a largo plazo.
- [ ] **25. Apuestas en directo.** Recalcular con marcador, minuto, expulsiones, cambios y eventos recientes. Medir retraso real de datos y cuotas y el tiempo necesario para que el usuario lea y realice manualmente la apuesta en Bet365. Rechazar precios obsoletos y evaluar el recorrido completo antes de activar recomendaciones; el informe diario podrá indicar partidos que conviene vigilar, sin tratar una cuota de directo como válida durante todo el día.
- [ ] **26. Combinadas y mercados relacionados.** Evaluar probabilidades conjuntas, reglas y precio final. No multiplicar probabilidades como si las selecciones fueran independientes; limitar la concentración de riesgo y contrastar con apuestas simples.
- [ ] **27. Movimientos y calidad del precio de Bet365.** Seguir cambios de sus cuotas, detectar cuándo aparece o desaparece el valor y, si hay datos, contrastar con otras casas como referencia. Estimar una cuota mínima aceptable y evitar duplicar avisos. El arbitraje entre varias casas queda fuera del alcance actual, limitado a apuestas manuales en Bet365.

## Uso diario y seguimiento

- [x] **28. Oportunidades actualizadas e informe diario.** Vigilar los precios automáticamente y recalcular oportunidades con los modelos ya disponibles. Ordenar por valor esperado neto, incertidumbre, vigencia y exposición conjunta; avisar cuando aparecen y retirar las que caducan, se suspenden o pierden valor. Entregar además el informe diario detallado, con fuentes, importes, riesgos, precio mínimo y condiciones. No duplicar exposición ni forzar apuestas.
- [x] **29. Panel, confirmación manual y avisos.** Mostrar el informe diario, saldo confirmado, capital comprometido, candidatos descartados, fuentes y rendimiento por familia. Facilitar que el usuario registre qué apostó, cuánto y a qué cuota, y recalcular las recomendaciones restantes si cambian las condiciones. Configurar el canal y la hora de entrega cuando se definan; ninguna notificación ni botón enviará apuestas o moverá fondos.
- [ ] **30. Funcionamiento continuo y mantenimiento.** Programar recogidas y análisis, vigilar fallos y datos antiguos, guardar copias y permitir detener el sistema. Versionar modelos, instrucciones de Qwen y reglas para poder explicar recomendaciones anteriores. Las tareas de IA no bloquearán la actualización de cuotas; una caída de Qwen se mostrará como información ausente.

## Contenido del informe diario

1. Fecha y hora de generación, partidos revisados, familias cubiertas y limitaciones de cobertura.
2. Saldo confirmado, dinero comprometido, importe total propuesto y cantidad que se conservaría libre. Las cantidades se calculan conjuntamente para evitar sobreexposición.
3. Lista priorizada de selecciones: partido, hora, mercado y línea exactos en Bet365, jugador cuando corresponda, cuota observada y momento de captura, importe en euros y porcentaje del saldo.
4. Para cada selección, análisis amplio: históricos relevantes, forma ajustada al rival, localía, calendario, descanso, alineaciones/minutos, lesiones, sanciones, noticias contrastadas y factores específicos del mercado, únicamente cuando existan datos. Incluir argumentos a favor y en contra, con fuentes y fechas.
5. Probabilidad estimada por el modelo, incertidumbre y calidad de su validación en esa familia. Mostrar referencia del mercado, valor esperado calculado con las reglas de liquidación correctas y explicación del importe. Las explicaciones de Qwen deben apoyarse en hechos extraídos y cálculos reproducibles.
6. Cuota mínima a la que sigue teniendo sentido la selección, validez temporal y hechos que obligan a revisarla, como alineaciones pendientes. Si el usuario encuentra otra cuota o cambia el importe, permitir recalcular antes de apostar.
7. Riesgos compartidos entre recomendaciones, alternativas descartadas relevantes y motivos para esperar o no apostar. Si no hay partidos o ventaja suficiente, indicarlo sin inventar selecciones.
8. Seguimiento posterior de lo recomendado y lo que el usuario confirmó haber apostado, con cuota e importe reales. Comparar ambos registros sin confundir el rendimiento teórico con el obtenido por el usuario.

## Validación para el uso de las recomendaciones

El funcionamiento técnico y la simulación no demuestran rentabilidad. Revisaremos por familia la calidad de probabilidades, las cuotas de Bet365 efectivamente disponibles, la muestra prospectiva, costes y caídas del saldo. El informe identificará los modelos experimentales y las limitaciones de evidencia. La decisión de apostar y todos los movimientos de dinero pertenecen al usuario; la ejecución automática no forma parte del proyecto.

## Próximo paso

El orden de ejecución y las pruebas de aceptación están en [TAREAS.md](TAREAS.md) y el resumen visual en [PROGRESO.md](PROGRESO.md). Solo T01 está completada. **T02 se ha reabierto para validar cuotas automáticas de Bet365**; la decisión manual anterior no cumple el requisito. Se han probado reglas comunes de vigencia para T05, sin dar por completado el monitor. Ver docs/CUOTAS_AUTOMATICAS.md. Los números de características y tareas son listas distintas.


## Comprobación de la primera entrega — 15/11/2026

El panel y el recorrido integrado están comprobados. Las funciones marcadas se aplican únicamente a la cobertura implementada y a las selecciones que superan sus controles; no habilitan automáticamente nuevas líneas ni familias. La identificación de jugadores, la cobertura exhaustiva de noticias, la evaluación del aporte de noticias, nuevas familias y la aceptación regional completa siguen pendientes. La vigilancia técnica funciona; no se declara resuelta su aceptación externa continuada. Comprobantes en docs/ENTREGA.md.

# Plan de trabajo — LaLiga y Champions

Actualizado el 23 de noviembre de 2026. LaLiga y Champions emiten propuestas experimentales bajo controles por selección y presupuesto conjunto. Se mantienen 16 de 18 tareas de acreditación ampliada comprobadas; T02 y T05 conservan su evidencia histórica pendiente. Vista resumida en [PROGRESO.md](PROGRESO.md); integración de Champions en [CHAMPIONS.md](docs/CHAMPIONS.md).

## Objetivo de hoy

Completar una primera versión que analice una familia de apuestas de LaLiga, use cuotas verificadas de Bet365, genere un informe detallado con importes sobre 100 € y permita registrar las apuestas que el usuario haga manualmente. El informe distinguirá probabilidades experimentales, hechos confirmados y datos ausentes.

La entrega de hoy depende de conseguir históricos y cuotas utilizables y de superar las pruebas. La cobertura de todas las familias y una ventaja rentable demostrada no se pueden dar por terminadas al construir el programa. Las siguientes familias se incorporarán una a una.

Primera familia propuesta: **resultados y hándicaps de partido**, según la cobertura real de datos. En T02 se fijará un catálogo explícito de mercados y líneas para aceptar esta primera entrega; el panel distinguirá ese catálogo de sus ampliaciones pendientes. Terminar la primera entrega no significa haber cubierto todas las variantes posibles de la familia. Las demás familias conservan todo el alcance del documento CARACTERISTICAS.md.

Alcance: recomendaciones para **Bet365**, saldo inicial de **100 €**, decisiones y apuestas manuales. Sin acceso a fondos, sin depósitos, sin retiradas y sin envío automático de apuestas. No hace falta proporcionar las credenciales de la cuenta de Bet365.

Restricción confirmada: **solo fuentes gratuitas, presupuesto de datos 0 €**. No activar servicios, pruebas de pago ni suscripciones con renovación automática. Conector público gratuito probado con MoviOdds; validación completa de T02 pendiente. Ver docs/PRUEBA_CUOTAS_GRATUITAS.md.

## Comprobaciones ya realizadas para preparar este plan

- La carpeta de LaLiga contenía únicamente CARACTERISTICAS.md antes de redactar este plan. Actualización: ya se ha implementado y comprobado la base T01; el análisis deportivo aún está pendiente.
- Node.js 24.19.0 y npm 11.17.0 responden en este equipo. Ollama está instalado.
- El proyecto cripto documenta Qwen3 8B y una prueba anterior satisfactoria. Actualización T01: Ollama estaba cerrado, se inició en segundo plano y Qwen3 8B respondió correctamente a la prueba local el 11/11/2026 a las 18:39 (Madrid). Evidencia en docs/COMPROBACION_T01.md.
- Actualización T02: entrada manual y proveedores de pago descartados por el usuario. MoviOdds respondió sin clave en tres capturas: 20 partidos y 60 selecciones por captura. Falta contraste regional y observar cambios reales; acceso técnico no equivale a recomendación validada. No se ha contratado ningún servicio. Ver docs/PRUEBA_CUOTAS_GRATUITAS.md.
- The Odds API no sirve como proveedor asumido de Bet365 para LaLiga: el catálogo consultado solo anuncia Bet365 AU para AFL y NRL. Véase su [cobertura de casas](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html).
- Football-data.co.uk publica una restricción expresa para productos de entrenamiento y uso automatizado/IA. Su integración automática no se dará por autorizada por el mero hecho de que los archivos sean públicos. Hay que resolver una fuente adecuada o permiso específico. Véase su [página de datos](https://www.football-data.co.uk/data.php).
- Football-data.org incluye LaLiga en su cobertura gratuita, pero los campos y el acceso al histórico deben verificarse en la cuenta y plan concretos. No se supondrá que el plan gratuito proporciona lesiones, xG o diez temporadas. Véanse [cobertura](https://www.football-data.org/coverage) y [planes](https://www.football-data.org/pricing).

## Cómo se ejecuta la lista

Se completan las tareas por orden y se anota el resultado de su prueba antes de marcarlas. Una tarea que dependa de una fuente no disponible queda pendiente, con su alternativa visible; nunca se rellena con datos inventados.

Requisito corregido por el usuario: las cuotas deben obtenerse automáticamente y vigilarse durante el día. Se mantiene el informe diario, acompañado de actualización de oportunidades y avisos al aparecer o desaparecer el valor. La entrada manual no permite dar por terminada T02/T05. Ver docs/CUOTAS_AUTOMATICAS.md.

Las tareas de cada etapa permiten trabajo independiente por dentro, pero la aceptación y los cambios en configuración o datos se comprobarán de forma ordenada.

## Tareas de la primera entrega

### T01 — Crear y comprobar la base del proyecto

- [x] **Entregable:** proyecto independiente en laliga-bot, instrucciones Windows, configuración EUR/Europe-Madrid/LaLiga/Bet365/100 € y comandos de arranque, estado y comprobación.
- **Dependencia:** ninguna.
- **Aceptación:** arranca en una sesión nueva, valida su configuración, muestra el modo de recomendaciones manuales y no cambia archivos ni procesos del bot cripto. Una consulta de prueba comprueba si Qwen responde actualmente; si no responde, el estado lo explica sin simular un análisis.

### T02 — Resolver las fuentes y la cobertura real

- [ ] **Entregable:** tabla de fuentes gratuitas para históricos, calendario, noticias y cuotas automáticas de Bet365, con cobertura regional, actualización y antigüedad. Históricos/noticias investigados y conector MoviOdds probado; contraste regional y cambios reales pendientes.
- **Dependencia:** T01.
- **Aceptación:** se obtiene una muestra real de cada fuente seleccionada. Para Bet365, verificar correspondencia de varios mercados contra la cuenta/región del usuario, observar series de precios y medir demora, cambios, suspensiones y consumo. Un ejemplo archivado o una entrada manual no cierran esta tarea. Solo opciones gratuitas; ninguna prueba de pago o renovación automática.

### T03 — Guardar datos con un historial trazable

- [x] **Entregable:** almacenamiento de equipos, partidos, estadísticas, noticias, cuotas, versiones de modelos e informes; identidades unificadas y fechas de publicación, recepción y vigencia. Implementado y comprobado; ver [ALMACENAMIENTO.md](docs/ALMACENAMIENTO.md).
- **Dependencia:** T01 y formatos identificados en T02.
- **Aceptación:** importar dos veces la misma muestra no duplica partidos; una cuota nueva conserva la anterior; una noticia se vincula al equipo correcto; los datos originales se pueden consultar para explicar una recomendación. Los errores de correspondencia quedan visibles.

### T04 — Cargar históricos y próximos partidos

- [x] **Entregable:** datos reales disponibles de temporadas anteriores y de la actual, calendario próximo y un resumen de cobertura, huecos y anomalías.
- **Dependencia:** T02 y T03.
- **Aceptación:** fechas, resultados, equipos y partidos aplazados se interpretan correctamente; los eventos futuros no contienen resultados; se distingue lo que estaba disponible antes del encuentro. Si el volumen no permite entrenar y evaluar el modelo, se informa de que falta histórico y no se considera resuelta la predicción.

### T05 — Vigilar automáticamente cuotas de Bet365

- [ ] **Entregable:** conector al proveedor validado, consultas periódicas dentro del límite gratuito y registro de cambios. Campos: partido, mercado, periodo, selección, línea, precio, fecha de origen y recepción, suspensión y reglas. El informe y los avisos se actualizan con los cambios. Reglas comunes de vigencia implementadas; conector y vigilancia real pendientes.
- **Dependencia:** T02 y T03.
- **Aceptación:** probar cambios reales, suspensiones, desaparición de mercados, fallos, reintentos limitados y respuestas antiguas. Cambiar el precio invalida o recalcula recomendaciones; un fallo no mantiene oportunidades viejas. Medir demora de origen y recepción. No iniciar sesión para apostar ni enviar apuestas.

### T06 — Calcular variables deportivas anteriores al partido

- [x] **Entregable:** fuerza de equipos, localía, forma reciente ajustada al rival, ataque/defensa y descanso, usando solo campos disponibles. Catálogo de variables con definición y ventana temporal.
- **Dependencia:** T04.
- **Aceptación:** cambiar el resultado de un encuentro futuro no cambia las variables de partidos anteriores; un equipo ascendido o con pocas observaciones recibe un tratamiento explícito. Lesiones, xG y otros campos ausentes se marcan como desconocidos.

### T07 — Construir el primer modelo probabilístico

- [x] **Entregable:** modelo inicial de ataque/defensa con corrección de marcadores bajos y ponderación temporal, más una referencia sencilla para compararlo. Guardar fecha límite de entrenamiento, parámetros y versión. Derivar mercados compatibles de una distribución coherente de marcadores.
- **Dependencia:** T04 y T06.
- **Aceptación:** produce distribuciones válidas y repetibles con los mismos datos. Los resultados, hándicaps y devoluciones que se activen se calculan de esa distribución; los mercados no implementados siguen pendientes y nunca se presentan como analizados.

### T08 — Evaluar probabilidades y resultados históricos

- [x] **Entregable:** evaluación cronológica fuera del entrenamiento: error probabilístico, calibración, muestra y comparación con referencias. Calcular rentabilidad histórica solo para cuotas de Bet365 con procedencia y momento de captura adecuados.
- **Dependencia:** T07; histórico de cuotas de T02 cuando exista.
- **Aceptación:** los parámetros se eligen sin utilizar el periodo final de prueba; el informe muestra también resultados malos. Si solo hay cuotas de cierre, la simulación se identifica como tal y no se atribuye al informe de la mañana. Si faltan precios históricos, no se publica un beneficio retrospectivo inventado.

### T09 — Recoger noticias y contexto de los partidos

- [x] **Entregable:** recogida de fuentes seleccionadas para los equipos de los próximos partidos; guardar titulares, texto disponible, enlaces y fechas, agrupando copias de una misma información.
- **Dependencia:** T02, T03 y T04.
- **Aceptación:** se distingue noticia reciente de antigua, rumor de comunicado y ausencia de noticias de ausencia de bajas. No se afirma haber leído un artículo completo si solo se recibió un titular o resumen.

### T10 — Adaptar Qwen al análisis deportivo

- [x] **Entregable:** extracción de lesiones, dudas, sanciones, convocatorias, rotaciones y límites de minutos, con evidencia textual, fuente y fecha. Resumen de factores a favor y en contra para cada partido.
- **Dependencia:** T01 y T09.
- **Aceptación:** revisar una muestra de noticias reales más ejemplos controlados de rumor, contradicción y ausencia de información. Las citas deben existir en el texto de entrada, los nombres deben corresponder y Qwen debe poder abstenerse. El contenido de las noticias se trata como datos, no como instrucciones. Limitar la frecuencia y concurrencia de las nuevas peticiones y comprobar su convivencia con el bot cripto sin modificar ese proyecto; una cola compartida completa puede incorporarse después.
- **Límite de esta entrega:** Qwen aporta contexto documentado; los cambios numéricos por noticias solo se incorporan si existe una evaluación que los respalde. La opinión de Qwen no altera por sí sola una probabilidad ni el importe.

### T11 — Calcular valor y cuota mínima aceptable

- [x] **Entregable:** para cada mercado activo, comparar su distribución estimada con la cuota real de Bet365, incluyendo el tratamiento de devoluciones y liquidaciones parciales cuando proceda. Calcular valor esperado, precio mínimo y estado del candidato.
- **Dependencia:** T05, T07 y T08.
- **Aceptación:** cálculos contrastados con casos de ganancia, pérdida, devolución y medias liquidaciones. Un precio antiguo o sin verificar no produce una recomendación accionable. No se confunde una alta probabilidad de acierto con una apuesta de valor.

### T12 — Distribuir el presupuesto de 100 €

- [x] **Entregable:** política explícita y configurable para importes, usando saldo confirmado, límites por selección/partido/jornada, capital comprometido y dependencia entre apuestas. Mostrar porcentaje, total propuesto y dinero libre.
- **Dependencia:** T11 y formato de posiciones manuales de T03.
- **Aceptación:** recomendaciones simultáneas respetan conjuntamente el presupuesto; no se cuentan como independientes mercados equivalentes o relacionados. Se contemplan mínimos y redondeos de Bet365. Datos insuficientes, valor no acreditado o saldo desactualizado pueden dar 0 €. Los importes experimentales se etiquetan; no se usa la confianza de Qwen como probabilidad calibrada.

### T13 — Registrar las apuestas hechas por el usuario

- [x] **Entregable:** marcar una recomendación como realizada, omitida, modificada o pendiente; introducir cuota e importe aceptados. Registrar resultados, devoluciones y ajustes de saldo, con un historial de correcciones. Libro de simulación separado del registro manual.
- **Dependencia:** T03, T05 y T12.
- **Aceptación:** generar un informe no descuenta dinero; confirmar una apuesta lo compromete una sola vez; editarla deja registro; liquidarla actualiza el saldo sin duplicar movimientos. El usuario puede conciliarlo con el saldo que ve en Bet365.

### T14 — Generar el informe diario detallado

- [x] **Entregable:** informe local que se abre en el navegador y conserva una copia fechada. Resumen de selecciones e importes, seguido de un análisis amplio por partido y apuesta: datos, modelo, noticias, fuentes, factores contrarios, precio observado, probabilidad experimental, valor esperado, incertidumbre, cuota mínima y condiciones pendientes.
- **Dependencia:** T08, T10, T11, T12 y T13.
- **Aceptación:** cada cifra se puede rastrear al dato o cálculo que la produjo; Qwen no inventa estadísticas ni cambia cantidades al redactar. El informe indica cobertura real, datos ausentes, hora de cálculo y vigencia. Si no hay partidos o ventaja suficiente, lo explica sin forzar selecciones.

### T15 — Unificar el uso diario en una pantalla sencilla

- [x] **Entregable:** una pantalla local para revisar saldo, ver cuotas automáticas, actualizar datos, generar el informe y registrar lo apostado. Acceso directo de Windows e instrucciones breves.
- **Dependencia:** T05, T13 y T14.
- **Aceptación:** se completa el uso ordinario sin editar archivos de configuración ni escribir comandos. La pantalla actualiza cuotas y oportunidades automáticamente, muestra su vigencia y retira las caducadas. El registro de apuestas realizadas sigue siendo manual; ningún control envía apuestas o mueve fondos.

### T16 — Probar el recorrido completo y los fallos importantes

- [x] **Entregable:** pruebas y evidencia del recorrido datos → modelo → cuota → importe → informe → confirmación manual → liquidación.
- **Dependencia:** T15.
- **Aceptación:** probar sin partidos, sin cuotas, con datos insuficientes, Qwen no disponible, cambio de cuota, apuesta omitida, apuesta modificada y devolución. Añadir una muestra real y una operación de prueba aislada para comprobar que el saldo se conserva correctamente. Las simulaciones nunca se mezclan con el registro real del usuario.

### T17 — Emitir el primer informe y entregar el modo de uso

- [x] **Entregable:** primer informe con datos reales disponibles y ficha de entrega: familia activa, mercados cubiertos, validación del modelo, limitaciones y pasos para el día siguiente. Incluir cómo registrar cuota/importe reales y cómo actualizar si cambian alineaciones o precios.
- **Dependencia:** T16.
- **Aceptación:** al menos una selección de Bet365 se recorre con precio verificado, aunque termine descartada y con importe 0 €. Si no hay partidos próximos con cuotas, se separa la demostración con datos reales archivados de las recomendaciones actuales. Sin datos suficientes no se declara listo para recomendar apuestas accionables.

### T18 — Dejar preparado el ciclo diario

- [x] **Entregable:** actualización e informe repetibles, registro de ejecución y errores, y copia recuperable de configuración/datos. Definir con el usuario hora y canal antes de programar entregas automáticas.
- **Dependencia:** T17.
- **Aceptación:** repetir la ejecución no duplica recomendaciones ni apuestas; los errores se ven y no reutilizan información caducada como si fuera nueva; se comprueba una recuperación en carpeta aislada. Vigilar cuotas e invalidar oportunidades automáticamente durante el periodo configurado. La entrega automática solo se marca terminada cuando existe la programación y se ha comprobado su resultado; preparar un comando o acceso directo no equivale a programarla.

## Qué significa estar listo para empezar

- Proyecto y primera familia funcionando con datos reales y pruebas superadas.
- Cuotas automáticas de Bet365 con precio, selección y marcas de origen/recepción verificadas; cambios y suspensión probados con datos reales. La carga manual no satisface este criterio.
- Informe legible que explica qué apostar, cuánto, por qué, bajo qué condiciones y qué evidencia falta; puede recomendar no apostar.
- Saldo inicial de 100 € y registro manual reconciliable; el programa no realiza movimientos.
- Una forma sencilla de repetir el proceso y consultar resultados.
- Modelo y sugerencias identificados como experimentales mientras la evidencia no justifique otra calificación. Empezar a recopilar resultados hoy no demuestra rentabilidad hoy.

## Familias siguientes: misma plantilla, una a una

Después de la primera entrega, cada familia tendrá cinco tareas propias: **F1** verificar estadísticas/cuotas/reglas; **F2** construir variables y modelo; **F3** evaluar probabilidades y precio; **F4** integrar importes, informe y liquidación; **F5** probar con datos reales y empezar su seguimiento independiente. No se marcará completa solo por añadir un nombre al panel.

Orden propuesto, revisable según cobertura:

1. Goles y marcadores.
2. Mitades e intervalos.
3. Córners.
4. Tarjetas y expulsiones.
5. Faltas y fueras de juego.
6. Goleadores y asistencias.
7. Remates y tiros a puerta.
8. Pases, entradas y otras acciones de jugadores.
9. Paradas y mercados de porteros.
10. Mercados de temporada.
11. Apuestas en directo, incluyendo demora y tiempo para apostar manualmente.
12. Combinadas y probabilidades conjuntas.

El seguimiento de movimientos de cuota y el ranking común se amplían al incorporar cada familia. Todas las recomendaciones siguen limitadas a Bet365.

## Registro de avance

| Tarea | Estado | Evidencia y observaciones |
|---|---|---|
| Preparación del plan | Hecha | Alcance, requisitos, recursos básicos y dependencias revisados; no es implementación del bot. |
| T01 | Hecha | Arranque y configuración comprobados, 7 pruebas correctas y respuesta real de Qwen3 8B. Ver docs/COMPROBACION_T01.md. |
| T02 | En validación | Once muestras iniciales y tres capturas gratuitas de 20 partidos/60 cuotas mediante MoviOdds. Falta contraste regional y cambios reales. Ver docs/PRUEBA_CUOTAS_GRATUITAS.md. |
| T03 | Hecha | Historial local y correspondencias explícitas; 20 partidos, 180 observaciones de cuotas y una noticia en base aislada, reimportación sin duplicados. 32 pruebas correctas, 13 de almacenamiento. Ver docs/ALMACENAMIENTO.md. |
| T04 y T06–T18 | Comprobadas | Implementación integrada, pruebas y navegador. Ver docs/ENTREGA.md. |
| T05 | En validación externa | Vigilancia implementada y probada con ejemplos controlados; aceptación con cambios y suspensiones reales continuados pendiente. |

Implementación integrada y comprobada. Permanecen abiertas las aceptaciones externas de T02/T05. Goles totales y ambos marcan no superan su evaluación actual; las siguientes familias se incorporarán una a una.


## Preferencia y resultado actual — 15/11/2026

El usuario elige consultar el panel sin hora fija ni avisos en el chat. T18 se acepta mediante el ciclo continuo del bot local, sin programar entregas. Las marcas completadas acreditan los entregables comprobados, no una declaración de rentabilidad ni la aceptación externa pendiente de T02/T05. El primer informe real es experimental y mantiene 0 € cuando falla cualquier condición. Véase docs/ENTREGA.md.

## Avance del 20/11/2026

- [x] Consulta directa gratuita por partido integrada; el filtro de partido dirige la vigilancia.
- [x] Separar lectura, último cambio desconocido, falta de reconfirmación y suspensión explícita.
- [x] Conservar capturas y cambios tras reiniciar; presupuesto de consultas persistente.
- [x] Introducir la clave gratuita del proveedor desde el panel, sin publicarla en informes ni respuestas.
- [x] 132 pruebas correctas, incluidas lecturas directas, aislamiento de fechas y protección de la clave.
- [x] Volver a abrir Bet365 España y archivar precios públicos actuales de Athletic–Espanyol.
- [x] Clave gratuita configurada por el usuario y conexión autenticada comprobada: 536 cuotas de 20 partidos.
- [ ] Completar contraste simultáneo proveedor/España y aceptación externa de suspensiones y retiradas reales.

Se mantienen 16/18 tareas aceptadas; los subpasos terminados no sustituyen las dos aceptaciones externas. Ver [avance y bloqueo](docs/AVANCE_2026-11-20.md).

### Conexión comprobada tras guardar la clave

- [x] Autenticación y recuperación de cuotas sin mostrar la clave.
- [x] Doce selecciones de cinco mercados contrastadas con la página pública española de Athletic–Espanyol; compatibilidad muestral exacta con caducidad de 24 horas.
- [x] Adaptación al origen cache de /quotes sin renovar artificialmente las horas del mercado; 133 pruebas correctas.
- [ ] Confirmar saldo libre y mínimo real de cuenta en el panel, por el usuario.
- [ ] Ampliar muestras de otros partidos y completar suspensiones/retiradas reales y medición de demoras.

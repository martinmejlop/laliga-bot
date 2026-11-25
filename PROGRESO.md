# Progreso del bot de LaLiga

**16 de 18 tareas comprobadas. Actualizado el 23/11/2026.** Recomendaciones manuales experimentales de LaLiga habilitadas con controles actuales por apuesta. T02 y T05 mantienen su acreditación histórica ampliada abierta; no se declara cobertura universal ni rentabilidad demostrada.

- [x] **01. Base del proyecto.** LaLiga, Bet365, EUR, Europe/Madrid, 100 € iniciales y Qwen local.
- [ ] **02. Fuentes y cobertura real.** Contraste público de siete selecciones en tres mercados de Bet365 España. Falta ampliar y sostener el contraste regional, las reglas y la disponibilidad real.
- [x] **03. Almacenamiento e historial.** Fuentes, capturas, versiones, identidades explícitas y recuperación sin duplicados.
- [x] **04. Históricos y calendario.** 2.280 partidos, 2.019 resultados, 29 clubes y 19 próximos encuentros con UTC; suspensión de Rayo–Athletic documentada.
- [ ] **05. Vigilancia automática de cuotas.** Servicio funcionando, límite gratuito, reintentos, caducidad e historial. Pruebas controladas correctas; aceptación externa con cambios y suspensiones observados de forma continuada pendiente.
- [x] **06. Variables deportivas.** Localía, ataque/defensa, forma ajustada al rival y descanso; datos ausentes explícitos.
- [x] **07. Modelo predictivo.** Poisson regularizado, ponderación temporal, corrección de marcadores bajos y parámetros versionados.
- [x] **08. Evaluación cronológica.** Entrenamiento, validación y prueba separados, referencias y controles por selección/línea. Sin ROI inventado.
- [x] **09. Noticias.** 100 entradas RSS con enlaces, fechas, extractos y duplicados; antigüedad visible.
- [x] **10. Qwen deportivo.** Extracción con citas literales, rumores y abstención. Inferencia real comprobada; sus opiniones no cambian números.
- [x] **11. Valor y cuota mínima.** Devoluciones y medias liquidaciones; precios caducados o sin verificar reciben 0 €.
- [x] **12. Importe y exposición.** Límites conjuntos, céntimos, un candidato por partido y saldo/mínimo confirmado.
- [x] **13. Registro manual.** Apuestas realizadas, decisiones omitidas/pendientes, correcciones, liquidaciones y simulación separada.
- [x] **14. Informe detallado.** Análisis por partido, noticias, fuentes, precios, valor, evaluación y motivos de descarte.
- [x] **15. Panel local.** Filtros, 20 observaciones por página, noticias, registro, progreso y copia. Comprobado en navegador.
- [x] **16. Recorrido completo y fallos.** Datos, matemáticas, registro y HTTP en archivos temporales; ninguna apuesta ficticia en tu registro.
- [x] **17. Primer informe real.** 20 partidos y 500 cuotas recibidas; 460 selecciones con correspondencia matemática. Propuestas de 0 € si falta cualquier control.
- [x] **18. Funcionamiento desde el panel.** Arranque/cierre con doble clic, actualización sin hora fija ni avisos y copia recuperable comprobada.

**Uso:** abre **Iniciar bot.cmd**, confirma tú el saldo libre y el mínimo que admite tu cuenta, y consulta el panel. Cerrar la pestaña no cierra el bot; **Detener bot.cmd** lo cierra. No se instala una tarea de inicio de Windows.

Goles totales y ambos marcan se calculan, pero no superan los controles actuales. Córners, tarjetas, jugadores, directo y combinadas siguen pendientes de datos y modelos propios. Todas las familias conservan su alcance en [CARACTERISTICAS.md](CARACTERISTICAS.md).

Comprobantes y límites: [ENTREGA.md](docs/ENTREGA.md), [DATOS_NOTICIAS.md](docs/DATOS_NOTICIAS.md), [MODELO.md](docs/MODELO.md) y [REGISTRO.md](docs/REGISTRO.md).

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

- [x] Corregido el archivo de respuestas cuyo reloj de servidor se adelanta ligeramente; las confirmaciones de cuotas mantienen sus controles estrictos.


- [x] Revisados panel, saldo, mínimo, porcentajes, vigencia y consumo gratuito; auditoría en docs/REVISION_CONFIG_2026-11-20.md.
- [ ] Mejoras de la revisión: ampliar contraste español, estudiar calibración, separar controles y añadir presupuesto diario independiente; parámetros conservados durante la auditoría.

## Aceptación comprobada — 23/11/2026

- [x] Catálogo inicial y reglas oficiales documentados.
- [x] 19 selecciones regionales admitidas, con discrepancias excluidas y originales archivados.
- [x] 210 lecturas nuevas; 102 cambios coherentes y 14 retiradas de fuente en el conjunto auditado.
- [x] Monitor corregido, pruebas y comprobación desde el panel; reevaluación periódica y caducidad explícita.
- [ ] Suspensión explícita real dentro del catálogo inicial: todavía no observada. Este único criterio mantiene T02 y T05 abiertos (4/5 y 6/7).

Detalle: [ACEPTACION_FUENTES_Y_CUOTAS.md](docs/ACEPTACION_FUENTES_Y_CUOTAS.md).

- [x] Copia real de la base grande comprobada con lectura por bloques; integridad SQLite y recuperación aislada correctas.
# Ampliación Champions · 23/11/2026

- [x] Comprobar acceso con la clave gratuita: catálogo real de 18 partidos de UEFA Champions League.
- [x] Incorporar partidos y cuotas al panel, con captura separada y sin consultas adicionales en cada ciclo del catálogo.
- [x] Mantener Champions fuera del entrenamiento, las propuestas y los controles acreditados de LaLiga.
- [x] Comprobar caducidad, suspensiones, tiempos e identidad; 179 pruebas superadas.
- [x] Históricos y modelo propios de Champions: 825 resultados reglamentarios.
- [x] Modelo evaluado por fechas y por mercado: 170 partidos de prueba final.
- [x] Contraste español de diez selecciones de dos partidos de Champions; otras selecciones conservan importe cero.

Champions integrada: 18 partidos analizados y propuestas sujetas a validación y vigencia; no acredita cobertura permanente. LaLiga conserva sus 18 tareas y su estado de aceptación independiente.


## Operación manual comprobada · 23/11/2026

- [x] Corregidos los ocho resultados recientes que seguían guardados como fichas previas.
- [x] Modelo recalculado y 16 selecciones contrastadas en Bet365 España, en dos partidos.
- [x] Propuesta real comprobada: Elche–Atlético, Elche a 5,75, importe 0,65 €; experimental y sujeta a vigencia.
- [x] Panel con recomendaciones vigentes, análisis, actualización de cuotas, enlace a Bet365 y guía de uso.
- [x] 187 pruebas superadas; ningún movimiento ni apuesta externa.
- [x] Modelo, evaluación y contraste propios de Champions integrados en el presupuesto conjunto.

La acreditación histórica ampliada de T02/T05 sigue visible. La política actual por apuesta se documenta en docs/OPERACION_MANUAL.md; no se afirma que la suspensión real pendiente se haya observado.

## LaLiga y Champions operativas · 23/11/2026

- [x] Modelos y evaluaciones independientes, cuotas y propuestas en la misma lista con filtro por competición.
- [x] El registro permanece sin apuestas: ninguna ejecución externa ni movimiento de dinero.
- [x] Actualización automática de ambas competiciones y consulta directa de un partido conservando sus tiempos originales.
- [x] Copia recuperable ampliada a datos, modelo y catálogo de Champions.

- [x] 196 pruebas superadas, incluida restauración de la copia con las referencias de Champions.

## Uso simplificado del panel · 23/11/2026

- [x] Recorrido en tres pasos: comprobar precio, abrir Bet365 y anotar solo lo ya apostado.
- [x] Tarjetas centradas en cuota, importe y probabilidad; precio mínimo visible y cálculo completo desplegable.
- [x] Filtros, informe, fuentes y acciones secundarias conservados en apartados desplegables.
- [x] Comprobación real de precios, filtros de ambas competiciones, detalles y apertura del formulario sin registrar apuestas.
- [x] 196 pruebas superadas; modelos, saldo y límites conservados.

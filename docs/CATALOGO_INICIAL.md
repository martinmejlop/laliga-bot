# Catálogo inicial y aceptación por evidencia

Revisión: 22/11/2026. Archivo operativo: `config/market-catalog.json`. Funciones: `catalogSelectionAllowed` y `evaluateAcceptance` en `src/odds/acceptance.ts`.

## Alcance de la primera entrega

| Mercado | Grupo de la fuente | Selecciones | Periodo |
|---|---|---|---|
| Resultado final | 40 | Local, empate y visitante | Encuentro reglamentario |
| Doble oportunidad | 10114 | Local/empate, empate/visitante y local/visitante | Encuentro reglamentario |
| Resultado sin empate | 10544 | Local y visitante | Encuentro reglamentario |

Se declara este subconjunto para que la primera entrega tenga una aceptación comprobable. Los hándicaps asiáticos de grupos 938 y 178002, el lado local del hándicap europeo 171, goles y ambos marcan conservan su implementación y su investigación. Las siguientes familias mantienen su alcance. Estar en investigación no autoriza una apuesta ni acredita cobertura regional o validación del modelo.

La inclusión exacta exige grupo, tipo, periodo, lado y línea. No se amplía por parecido de nombre o por equivalencia matemática. Después siguen siendo necesarios el contraste regional exacto, la vigencia, el estado del partido, el modelo, el saldo y los límites conjuntos.

## Referencias de reglas

Consultadas sin sesión el 22/11/2026:

- [Reglas de resultado y doble oportunidad](https://help.bet365.es/s/es-es/sportsrules/soccer/result-event-half-time).
- [Definiciones de mercados de fútbol](https://help.bet365.es/s/es-es/sports/football-betting-markets).
- [Reglas de hándicap asiático](https://help.bet365.es/s/es-es/sportsrules/soccer/asian-handicap).

El catálogo recoge las reglas reglamentarias pertinentes. Para resultado sin empate se utiliza la correspondencia matemática con la devolución del hándicap cero, explicitada como correspondencia y no como cita de una regla independiente de ese nombre. Debe contrastarse además la etiqueta pública exacta del mercado. No se presuponen promociones, cuotas mejoradas, pagos anticipados, reglas de una cuenta o condiciones particulares.

La liquidación de encuentros abandonados, interrumpidos o reanudados exige revisión específica. Este catálogo no permite tratar una reanudación como un partido nuevo de noventa minutos.

## Qué comprueba la aceptación dinámica

`evaluateAcceptance` no lee un campo `done`: devuelve criterios individuales y tareas `complete` o `partial`. La función comprueba estructura, cifras y relaciones temporales de la evidencia que recibe. La procedencia y la veracidad dependen del productor de la auditoría y del acceso a las capturas referenciadas; una huella aislada no certifica el contenido de una fuente externa.

**T02** exige:

- Catálogo acotado y reglas oficiales españolas revisadas en los últimos noventa días.
- Capturas gratuitas identificadas por `captureId` y SHA-256 para históricos, calendario, noticias y cuotas, recibidas en las últimas veinticuatro horas. Se revisa la recepción; no se confunde con la actualidad del contenido de una noticia.
- Perfil regional v2 público y vigente, con todos los mercados iniciales y todos sus lados en al menos dos partidos. El perfil no se generaliza a otros encuentros. Las cifras españolas deben corresponder al precio observado o a un truncado/redondeo legítimo.
- Evidencia de series reales con cambios, suspensión explícita, ventana continua, tiempos medidos y consumo gratuito. Abrir una clave o consultar una cuota una vez no satisface estos criterios.

**T05** exige:

- Cambios de precio, suspensiones explícitas y retiradas comparables de muestras reales referenciadas. `stale` no reemplaza la suspensión explícita. Las retiradas se comparan dentro del mismo alcance completo de consulta; no se convierten diferencias de filtros o endpoints en cierres del operador.
- Una ventana observada de al menos una hora y veintiuna capturas, con un hueco máximo de tres minutos. Este es un criterio operativo escogido y publicado para esta entrega, no una cita del plan original. Se admite cualquier ventana que lo cumpla; las pausas del bot fuera de esa ventana son legítimas y no invalidan la prueba.
- Duración HTTP y edad de confirmación de mercado medidas, contador dentro del máximo conservador de 4.800 consultas y solo acceso gratuito.
- Pruebas controladas recientes, sin fallos, con casos de cambio/recalculo, suspensión, retirada, caída, `Retry-After`, respuesta antigua, reinicio y límite de consultas. La evidencia controlada no sustituye los eventos reales anteriores.

Medir la propagación independiente desde el operador español se informa aparte como una mejora. Una duración HTTP o edad de confirmación no se etiqueta como propagación. Una comparación puntual de precios tampoco fija el instante exacto del cambio del operador.

La aceptación técnica de este catálogo no demuestra una ventaja rentable, disponibilidad continua o cobertura universal. La caducidad regional puede devolver T02 a `partial`: aceptar una muestra no garantiza futuras muestras.

## Contrato para integrar el productor de evidencias

La función recibe un objeto con:

```ts
{
  now, catalog, regionalAudit,
  sourceSamples: [
    {role: 'history'|'calendar'|'news'|'odds', captureId, sha256, receivedAt, free: true}
  ],
  monitorEvidence: {
    captures, priceChanges, explicitSuspensions, comparableWithdrawals,
    firstReceivedAt, lastReceivedAt, maxGapMs,
    evidenceRefs: [{captureId, sha256}],
    continuousWindow: {
      firstReceivedAt, lastReceivedAt, captures, maxGapMs,
      evidenceRefs: [{captureId, sha256}]
    },
    httpDurationMs: {count, p95, max},
    confirmationAgeMs: {count, p95, max},
    usage: {used, limit: 4800, freeOnly: true},
    regionalDelaySamples: [
      {eventId, marketId, bookmakerObservedAt, providerReceivedAt, evidenceRef: {captureId, sha256}}
    ]
  },
  controlledChecks: {
    checkedAt, passed, failed: 0,
    cases: [
      'price-change-recalculation', 'suspension', 'withdrawal',
      'provider-failure', 'retry-after', 'stale-response', 'restart', 'budget-limit'
    ],
    evidenceRef: {captureId, sha256}
  }
}
```

Las fechas son milisegundos UTC y los tiempos son milisegundos. `continuousWindow` y `regionalDelaySamples` son opcionales; sin ventana específica se prueba la ventana global. Los contadores deben proceder de la auditoría real, no de los casos de prueba. `evidenceRefs` exige al menos dos capturas distintas con huellas SHA-256. Las pruebas controladas caducan en siete días para esta comprobación de entrega.

El resultado contiene `tasks.T02`, `tasks.T05`, `checks`, `regionalSummary` y `enhancements.bookmakerToProviderDelay`. El panel puede mostrar directamente qué criterio falta; completar la tarea no se puede lograr cambiando un checkbox.

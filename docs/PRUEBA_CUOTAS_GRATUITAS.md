# Cuotas gratuitas: prueba de MoviOdds

11/11/2026. Requisito del usuario: solo fuentes gratuitas. No se ha creado una cuenta, activado un periodo de prueba ni introducido una tarjeta. El adaptador solo consulta un endpoint público de lectura.

## Qué se ha comprobado

- Dos peticiones iniciales al catálogo y cuotas: 20 partidos identificados exactamente como Spain La Liga. La primera prueba usaba la variante australiana por defecto y se conserva como diagnóstico, sin tratarla como equivalente a España.
- Se repitió la prueba con **site=com explícito**, obteniendo 20 partidos y sus precios.
- El adaptador implementado realizó tres capturas de la variante com: **20 partidos y 60 selecciones 1X2 en cada una**. No se observaron cambios de precio durante el intervalo. Sí avanzó la marca de confirmación del mercado.
- Pruebas de la base, adaptador y reglas: **19 correctas**. Se excluyen otras ligas y e-soccer, respuestas antiguas y variantes de sitio incorrectas. Los errores HTTP y Retry-After se conservan como condiciones de espera.
- No se activa ninguna recomendación: el programa conserva `regionVerified: false` porque la muestra no se ha contrastado con la cuenta de Bet365 España.

| Captura | Hora UTC | Partidos | Selecciones | Cambios de precio observados |
|---|---|---:|---:|---:|
| 1 | 18:47:37 | 20 | 60 | Sin referencia previa |
| 2 | 18:47:53 | 20 | 60 | 0 |
| 3 | 18:48:08 | 20 | 60 | 0 |

Originales: `data/free-odds-checks/2026-11-11T18-47-36.518Z/sample-1.json` a `sample-3.json`. Resumen preservado en [free-odds-evidence.json](free-odds-evidence.json). Las capturas solo prueban acceso y datos recibidos, no igualdad con la cuenta del usuario ni rentabilidad.

## Lo que publica el proveedor

[Documentación](https://moviodds.com/doc), [plan gratuito](https://moviodds.com/pricing/) y [condiciones](https://moviodds.com/terms/) consultados. Se presenta como independiente de Bet365 y admite uso en aplicaciones propias; no garantiza exactitud o continuidad. El acceso público sin clave funciona actualmente. Bet Builder es de pago y queda excluido.

El origen predeterminado es bet365.com.au; `site=com` selecciona bet365.com. Esto no confirma automáticamente la oferta de bet365.es. Para vigencia se usa `group_status.polled_at`: `ts` indica el último cambio de precio, y el `polled_at` del partido no acredita que todos sus mercados se hayan releído. Los mercados suspendidos o sin confirmación fiable no se presentan como oportunidades.

## Limitaciones pendientes

- La fuente anuncia `refresh_s: 1800` para estos encuentros lejanos: consultar cada 15 segundos no asegura que el origen se relea cada 15 segundos. En los dos primeros partidos muestreados se vio avanzar la confirmación, pero no se ha medido aún un retraso de cambio contra Bet365.
- Falta comprobar varios mercados con la cuenta regional, observar cambios de precio reales y probar la conexión de actualizaciones en funcionamiento prolongado. T02 permanece sin marcar.
- Este primer adaptador comprueba solo el grupo de resultado final, para validar el transporte. No reduce el alcance acordado de las familias posteriores.
- No hay aún modelos deportivos, cálculo de valor o importe ni avisos conectados. El comando es una comprobación acotada; no se deja ejecutando permanentemente.
- Otra opción investigada, Odds-API.io, [ha pausado nuevas claves gratuitas](https://odds-api.io/pricing/free); sus referencias antiguas a alta gratuita no bastan para seleccionarla.

## Uso

`npm.cmd run odds:check` obtiene una captura. `npm.cmd run odds:check -- --samples=3` obtiene tres, con pausas de 15 segundos. Requiere Internet y guarda muestras locales. Un fallo termina la comprobación sin conservar precios previos como si siguieran vigentes.

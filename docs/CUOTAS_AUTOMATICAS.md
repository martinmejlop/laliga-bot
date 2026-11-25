# Requisito corregido: vigilancia automática de Bet365

11/11/2026. La carga manual de cuotas ha sido rechazada por el usuario. Requisito adicional: **solo fuentes gratuitas, presupuesto de datos 0 €; descartadas las pruebas de pago o de renovación automática**. T02 sigue abierta. Se ha encontrado y probado [MoviOdds sin clave ni registro](PRUEBA_CUOTAS_GRATUITAS.md); falta contraste con la región del usuario y observación de cambios reales. Los candidatos de pago de la investigación inicial se conservan debajo como descartados.

El informe diario se mantiene como resumen, acompañado por vigilancia continua y actualización de oportunidades cuando cambien precios, alineaciones o hechos relevantes. El usuario realiza todas las apuestas. El bot no mueve dinero.

## Recorrido requerido

1. Obtener automáticamente los partidos y mercados activos de LaLiga en el proveedor seleccionado.
2. Consultar los precios según la cuota de peticiones y medir la demora entre la fuente y la recepción. La cadencia de nuestras consultas no demuestra la frecuencia real de actualización del proveedor.
3. Guardar cada cambio con identidad del partido, periodo, mercado, selección, línea y marcas de tiempo.
4. Recalcular el valor y el importe sobre modelos ya calculados; Qwen no debe bloquear la actualización de precios.
5. Emitir un aviso solo al superar los criterios y límites del presupuesto. Un movimiento de cuota por sí solo no significa oportunidad.
6. Si el precio cae por debajo del mínimo aceptable, se suspende el mercado, falta una selección o falla la fuente, retirar o caducar la recomendación. Volver a comprobar vigencia al mostrarla al usuario.
7. Mostrar precio observado, hora, caducidad, cuota mínima, importe y razones; registrar después la cuota e importe que el usuario consiguió al apostar manualmente.

## Candidatos consultados

| Proveedor | Acceso publicado | Precio publicado consultado | Lo que falta comprobar |
|---|---|---|---|
| [BetsAPI](https://betsapi.com/docs/bet365/) | Próximos partidos y mercados previos mediante API Bet365; clave requerida | [Prueba Bet365 de un día: 1 USD; plan 150 USD/mes](https://betsapi.com/mm/pricing_table). 1.800 y 3.600 peticiones/hora respectivamente | Eventos/mercados de LaLiga en una cuenta con acceso; correspondencia de región, precio, reglas, marcas de tiempo y demora real |
| [OddsAPI.dev](https://www.oddsapi.dev/odds/la-liga) | Anuncia Bet365/LaLiga, con API REST y clave | [Desde 50 USD/mes, prueba anunciada de siete días](https://www.oddsapi.dev/) | Misma verificación; las muestras públicas no sustituyen la prueba con una clave y contra la cuenta del usuario |

Son servicios independientes. No se ha comprado ni activado ninguno y quedan descartados por la preferencia gratuita del usuario. La prueba gratuita posterior se documenta por separado; su acceso técnico comprobado todavía no acredita todos los requisitos operativos.

BetsAPI [distingue las cuotas previas de las de directo](https://betsapi.com/docs/bet365/): el precio previo deja de actualizarse al empezar el partido. Su tarifa publica actualizaciones de directo cada 3–5 segundos; no se atribuye esa frecuencia a todos los mercados previos ni se considera una latencia ya medida. Para directo habrá que usar su endpoint específico y realizar las pruebas correspondientes de T25.

## Prueba que cierra T02

Con una clave del servicio elegido y acceso adecuado, seleccionar varios partidos de LaLiga, comprobar mercados contra Bet365 del usuario y capturar series de precios con fechas reales. Medir cambios, antigüedad, fallos, suspensión y consumo. Si no hay cambios observados, la prueba no acredita detección real de cambios aunque las peticiones devuelvan HTTP 200. Definir una cadencia dentro del plan y documentar el límite de demora. No marcar T02/T05 completas con ejemplos archivados o precios introducidos a mano.

## Trabajo implementado en esta corrección

`src/odds/freshness.ts` implementa reglas comunes de vigencia e identificación y un seguidor de cambios por partido, sin conexión de red. Prueba precios nuevos/cambiados, retiradas, suspensión, duplicados, respuestas fuera de orden y envejecimiento. **No es un conector activo ni un detector de apuestas rentables.**

La política de ensayo usa como límites 60 s desde la última confirmación del mercado, 30 s desde recepción y 10 s de duración de petición. Se separa expresamente la última modificación del precio de su última confirmación: un precio estable puede seguir vigente. Son límites de prueba, no una garantía de poder apostar al precio mostrado. No se inventa una fecha de confirmación a partir de la recepción local.

Pruebas actuales: **19 correctas**. Adaptador y tres capturas reales gratuitas comprobados. Pendientes: contraste regional, cambios reales y monitor continuo con cálculo de oportunidades.

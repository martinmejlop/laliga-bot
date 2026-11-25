# Modelos, mercados y distribución del presupuesto

Implementación local sin paquetes externos. Las probabilidades y los importes son cálculos reproducibles; Qwen extrae contexto y no modifica cifras por opinión.

## Modelo de goles y variables

`fitModel` ajusta intensidades Poisson de ataque y vulnerabilidad defensiva de cada equipo, una media de liga y ventaja de campo. Usa descenso por gradiente sobre la verosimilitud ponderada con regularización; los partidos pierden peso con el tiempo y el histórico se limita a tres años por defecto. Los equipos con pocos datos se aproximan a la media. Después se ajusta una corrección de los cuatro marcadores bajos: es una aproximación en dos etapas inspirada en [Dixon y Coles (1997)](https://academic.oup.com/jrsssc/article-abstract/46/2/265/6990546), no una reproducción exacta de su optimización conjunta.

La distribución conjunta contiene marcadores de 0 a 16 goles por equipo. Se conserva la masa truncada, se normaliza la matriz y se acota la corrección para impedir probabilidades negativas. Con las intensidades permitidas, la cola omitida es inferior al 0,1 %; cada predicción indica su valor real.

El informe puede mostrar fuerza ofensiva/defensiva, cinco últimos resultados, puntos, goles, diferencia de goles ajustada al rival y descanso. Forma y descanso son contexto descriptivo; no introducen multiplicadores arbitrarios sin evaluación. Lesiones, alineaciones y xG desconocidos son `null`, no cero. Las probabilidades actuales no incorporan ajustes numéricos por noticias.

`fitModel` exige que el resultado sea anterior al corte y, en el modo ordinario `observed`, que su recepción también lo sea. Un partido sin hora se incorpora desde el día siguiente, nunca durante el mismo día. Una predicción requiere inicio posterior al corte. La preparación para recomendar falla si hay menos de 60 partidos de entrenamiento, algún equipo tiene menos de ocho observaciones efectivas o el último resultado del entrenamiento supera 45 días de antigüedad.

## Evaluación cronológica

Se separa aproximadamente 60 % entrenamiento, 20 % validación y 20 % prueba, manteniendo días completos separados. Se elige entre tres configuraciones predefinidas únicamente por el log-loss de validación. El periodo final no selecciona parámetros. Durante cada periodo se reajusta cada 45 días usando solo resultados anteriores al reajuste: evaluación progresiva, no un ajuste retrospectivo con todos los resultados.

El histórico descargado hoy no demuestra que sus correcciones estuvieran disponibles años atrás. Por eso esta evaluación se etiqueta como **reconstrucción por fecha del resultado**. No constituye una auditoría causal de qué habría recibido entonces la fuente. Tampoco incluye cuotas históricas verificadas: `roi` es siempre `null`; no se inventan beneficios.

Se informa de log-loss, Brier multiclase, exactitud, tamaños y periodos. La calibración agrupa las probabilidades de todas las categorías en intervalos de 0,1, con frecuencia observada. El ECE es la diferencia absoluta ponderada entre las probabilidades y frecuencias de esos intervalos; no es una medida de rentabilidad. La referencia es la frecuencia histórica de resultados disponible en cada reajuste, con suavizado.

### Evaluación por mercado

Existen comprobaciones predefinidas para 63 selecciones: 1X2, doble oportunidad, empate no válido, hándicaps asiáticos y europeos, goles totales, goles por equipo y ambos marcan. La evaluación de cada selección trata correctamente ganancias, medias ganancias, devoluciones, medias pérdidas y pérdidas. El diagnóstico de liquidación usa una cuota teórica de 2 para comparar la liquidación esperada con la observada: **no es beneficio apostado ni simulado a cuotas reales**.

Cada combinación de lado, línea y equipo tiene su propio resultado. Para pasar exige al menos 100 partidos de prueba, mejor log-loss que la referencia tanto en validación como en prueba, ECE no superior a 0,10 y mejora Brier cuyo límite prudente `media − 3,5 × error estándar` sea positivo. Este umbral orientativo considera múltiples comprobaciones; la aproximación normal, los partidos relacionados y los huecos de datos impiden interpretarlo como garantía estadística de una ventaja rentable.

`marketGateFor(evaluation, selection)` devuelve la comprobación exacta. Que una familia tenga alguna línea aprobada nunca aprueba sus otras líneas. Córners, tarjetas, jugadores, mitades, directo y combinadas permanecen fuera de este modelo: necesitan estadísticas y evaluación propias.

En la comprobación del archivo de 2.019 resultados, el periodo final incluyó 404 partidos entre el 26/10/2025 y el 08/11/2026. Log-loss: 0,96756 frente a 1,05180 de referencia; Brier: 0,57286 frente a 0,63386; exactitud: 53,96 %; ECE: 0,03472. La selección de parámetros fue semivida 365 días y regularización 8. Estos números describen esa versión del archivo y cambiarán al actualizarlo.

En esa comprobación pasaron 1X2, doble oportunidad, empate no válido y las líneas asiáticas evaluadas entre −1 y +1. Solo parte de las líneas europeas y goles del equipo local a 1,5 pasaron; **goles totales y ambos marcan no pasaron**. El programa debe conservar esos resultados desfavorables y bloquear las selecciones que fallen. Una fuente regional sin contrastar sigue bloqueada aunque el modelo pase.

## Valor y liquidación

El valor esperado por euro es `P(ganar)×(cuota−1) + P(media ganancia)×(cuota−1)/2 − P(perder) − P(media pérdida)/2`. La cuota de equilibrio contempla esas porciones y las devoluciones. Una alta probabilidad de acierto puede tener valor negativo.

El hándicap asiático expresa la línea desde el equipo elegido: visitante +0,5 suma 0,5 al visitante. El hándicap europeo utiliza una línea aplicada al **local** y tres posibles resultados; su empate no devuelve la apuesta. Los cuartos dividen la apuesta entre las dos medias líneas contiguas. La referencia de reglas es la [ayuda de Bet365 sobre hándicap asiático](https://help.bet365.com/s/en-gb/sportsrules/soccer/asian-handicap); la adaptación regional y del mercado concreto debe validarse antes de apostar.

La aritmética admite las familias de resultados y goles compatibles con la matriz. Admitir un cálculo no implica disponer de precio actual, reglas regionales contrastadas o una evaluación favorable de esa selección.

## Importes sobre 100 €

`allocateStakes` recibe patrimonio total confirmado, parte comprometida y exposición manual. No lee ni mueve dinero de Bet365. Restar la parte comprometida una sola vez da el dinero libre. Un saldo sin confirmar o de más de 24 horas produce cero.

El criterio Kelly se resuelve sobre los cinco posibles retornos, incluidos los parciales. Por defecto se utiliza el 25 % de Kelly y se reduce otra vez a la mitad como margen experimental. Límites: 1 % por apuesta, 2 % por partido, 3 % por equipo y 5 % total, incluyendo exposición comprometida. Se admite una sola selección nueva por partido para limitar correlaciones. Se redondea hacia abajo a céntimos.

El mínimo de Bet365 no se supone: debe indicarse el de la cuenta. Si falta, el resultado es cero. También son cero las selecciones no accionables, de valor inferior al 3 %, con datos incoherentes o cuyo importe prudente no alcance el mínimo. El sistema no intenta gastar los 100 € cada día.

## Verificación

`node --test test/model.test.ts test/value.test.ts` supera 14 pruebas. Cubren fuga de resultados futuros, disponibilidad observada frente a reconstruida, separación de validación y prueba, normalización y cola, equipos con pocos datos, líneas exactas, liquidaciones parciales, cuota mínima, límites de saldo/exposición, duplicados de partido y abstención con precios o saldo sin verificar. Los ejemplos controlados no se mezclan con los datos reales del usuario.

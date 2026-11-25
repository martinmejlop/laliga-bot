# Champions integrada · 23/11/2026

- [x] Partidos y cuotas de UEFA Champions League incluidos en el proveedor gratuito.
- [x] 825 resultados reglamentarios: cinco temporadas OpenFootball y 72 resultados de la temporada actual de ESPN. Identidades explícitas, originales archivados y fechas de recepción conservadas.
- [x] Modelo propio y evaluación cronológica: 489 partidos de entrenamiento, 161 de validación y 170 de prueba final. Las cinco finales neutrales se excluyen del ajuste. Brier de prueba 0,523 frente a 0,593 de referencia; no demuestra rentabilidad.
- [x] Marcadores de 90 minutos identificados en encuentros con prórroga o penaltis; las repeticiones de un mismo cruce en fechas diferentes no se borran. Si el tanteo reglamentario no se conoce, se conserva como desconocido y bloquea los equipos afectados.
- [x] Contraste público de diez selecciones de resultado final y sin empate en Real Madrid–PSV y Club Brugge–Liverpool. Doble oportunidad sin precios visibles no se acredita ni genera importe.
- [x] Propuestas, actualización de cuotas, filtros, análisis y registro manual integrados con LaLiga. Saldo y límites conjuntos, sin realizar apuestas externas.

Se comprobó el cálculo de los importes en ambas competiciones. La selección con mayor valor estimado por partido recibe presupuesto; otras selecciones del mismo encuentro se descartan por correlación.

Los modelos y las puertas por mercado son independientes. El catálogo inicial de ambas competiciones permite estudiar 1X2, doble oportunidad y sin empate; solo cada lado que pase sus propias pruebas, vigencia y contraste regional puede recibir dinero. La fuerza de Champions se estima con sus propios encuentros, no con todos los partidos domésticos. Nuevos participantes con historial insuficiente quedan sin importe. Las finales neutrales, clasificación de eliminatoria, prórroga y penaltis necesitan otro modelo.

Con el panel activo, una misma consulta del catálogo renueva ambas competiciones usando una sola unidad del límite gratuito conservador de 4.800 al mes. «Comprobar cuota ahora» consulta el partido elegido. La lectura caduca en 30 segundos; el origen puede tener como máximo 60 segundos hasta 24 horas antes del inicio, cinco minutos entre 24 y 48 horas, y quince minutos si faltan más de 48 horas. Suspensiones, stale, fallos y tiempos incoherentes bloquean la selección. Las horas de otros partidos nunca se renuevan al consultar uno solo.

El contraste español es puntual, por identidad exacta y como máximo 24 horas; no existe cobertura regional universal o comprobación continua de la cuenta del usuario. Revisar siempre el mismo mercado, periodo, selección y cuota antes de apostar. Si cambia la cuota, actualizar antes de utilizar el importe.

Las capturas se guardan en el archivo común con formatos propios de Champions, sin insertar clubes europeos como fixtures de LaLiga. La copia recuperable incluye su snapshot, modelo, evaluación y catálogos. Los informes conservan las referencias de entrenamiento de la competición que produjo cada pronóstico.

Fuentes: [OpenFootball Champions League](https://github.com/openfootball/champions-league), [ESPN Champions](https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard), [documentación MoviOdds](https://moviodds.com/docs/sports/). El RSS de Champions aporta titulares y resúmenes; la cobertura de lesiones, alineaciones y xG continúa incompleta y no altera las probabilidades por opinión de Qwen.

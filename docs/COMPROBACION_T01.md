# Comprobación de T01

Fecha: 11 de noviembre de 2026. Resultado: **completada**.

- Proyecto independiente, sin paquetes externos ni instalación adicional. Node.js 24.19.0 y npm 11.17.0.
- Arranque comprobado mediante `npm.cmd start`, con LaLiga, Bet365, EUR, Europe/Madrid, presupuesto inicial 100 € y ejecución manual. Se distingue presupuesto configurado de saldo registrado.
- Prueba automatizada de arranque desde otra carpeta en una sesión de Node nueva, encontrando la configuración por ubicación del programa.
- Siete pruebas automatizadas correctas: arranque fuera de carpeta, restricciones de configuración/presupuesto, descubrimiento sin inferencia, inferencia válida, fallos de conexión/modelo remoto, respuestas incompletas/inválidas y límites de respuesta/HTTP.
- El primer intento de IA no obtuvo respuesta. La comprobación posterior encontró el servicio cerrado; se abrió `ollama serve` en segundo plano, sin descargar modelos ni modificar el proyecto cripto.
- Prueba real de Qwen terminada a las **18:39:25 Madrid** (17:39:25 UTC). Modelo `qwen3:8b`, digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`. Duración observada: 10.893 ms, incluyendo descubrimiento y la respuesta de prueba.
- Qwen devolvió el objeto esperado `{"status":"ok"}`; respuesta completa, modelo esperado y sin llamadas de herramientas.
- El servicio local se dejó abierto para poder utilizarlo. No se instaló inicio automático ni se cambiaron ajustes globales de Ollama.

La consulta mínima comprueba conexión e inferencia, no precisión deportiva ni rentabilidad. Fuentes de cuotas, modelo deportivo, noticias, cartera e informes todavía están pendientes. Los únicos archivos modificados para esta entrega están en laliga-bot; no se cambiaron archivos ni procesos del bot cripto.

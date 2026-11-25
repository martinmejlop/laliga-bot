# Observatorio de LaLiga y Champions

Panel local para analizar LaLiga y UEFA Champions League con modelos y evaluaciones propios, vigilar cuotas automáticas de Bet365 y consultar propuestas experimentales. Ambas competiciones comparten saldo y límites. El usuario decide y apuesta manualmente; el programa no accede a fondos ni necesita credenciales de Bet365.

## Abrir y cerrar

1. Abre **Iniciar bot.cmd**. Arranca el bot en segundo plano y abre **http://127.0.0.1:3210**. Repetirlo no crea otro servidor.
2. En **Mi registro**, confirma el saldo libre que ves en Bet365 y el mínimo que admite tu cuenta. El presupuesto inicial no se considera un saldo confirmado.
3. Consulta oportunidades y condiciones. Un candidato sin validar, caducado o sin ventaja suficiente tiene importe 0 €. Puedes filtrar por partido, mercado y estado.
4. Registra únicamente las apuestas que tú hayas realizado. La simulación tiene un libro separado. Una recomendación no descuenta dinero.
5. **Detener seguimiento** pausa las cuotas. **Detener bot.cmd** cierra el servidor completo. Cerrar la pestaña no cierra el bot.

No hay hora fija ni avisos en el chat: el panel es el punto de consulta, según tu preferencia. El bot no se instala como tarea de inicio de Windows; vuelve a abrirlo después de reiniciar el equipo.

Requiere Node.js 24 y no necesita instalar paquetes. Qwen utiliza Ollama con el modelo qwen3:8b; si falla, se indica contexto IA ausente y las cuotas siguen su propio ciclo. Para activar el contexto con IA, instala Ollama y descarga el modelo indicado.

## Qué contiene

- Históricos y calendario: 2.280 partidos, 2.019 resultados y 19 próximos encuentros con UTC en la muestra del 15/11/2026; huecos y suspensión oficial identificados.
- Modelo experimental, evaluación cronológica y controles por selección/línea. Resultado, doble oportunidad y determinadas líneas de hándicap superan los controles actuales. Goles totales y ambos marcan permanecen bloqueados por evaluación insuficiente.
- Noticias RSS y Qwen con citas presentes en el material recibido. No hay cobertura exhaustiva de lesiones, xG ni alineaciones.
- Cuotas automáticas, vigencia, precio mínimo, propuestas limitadas conjuntamente, registro, informe fechado y copia recuperable.

**La fuente de cuotas sigue en validación externa.** Se contrastaron siete selecciones de tres mercados en la página pública española, sin iniciar sesión. El contraste solo se aplica a esas selecciones, con el mismo precio y durante 24 horas; no se extrapola al resto ni se renueva al recibir datos. Lo no contrastado conserva importe 0 €.

Solo opciones gratuitas. El proveedor anuncia 5.000 consultas mensuales y mercados principales, con cambios de límites pendientes; el bot aplica un tope conservador de 4.800 y respeta reintentos. [Condiciones actuales](https://moviodds.com/pricing/). Con el panel abierto consulta más; sin visitas reduce la frecuencia. No se promete tiempo real. Una cuota antigua nunca se rejuvenece con la hora de consulta.

## Comprobar y recuperar

La suite tiene **196 pruebas**, incluidas tres de HTTP completo en carpetas y puertos temporales. En entornos que restringen conexiones locales hay que permitir esa conexión de prueba; no utilizan servicios externos.

**Crear copia de seguridad** copia SQLite, referencias, configuración y registro a data/backups y comprueba su restauración en esa carpeta aislada. El manifiesto contiene integridad y huellas. Para recuperar datos, conserva una copia del estado actual, detén el bot y restaura una copia verificada usando esta misma versión del proyecto. La comprobación nunca sustituye la base de uso diario.

Comandos opcionales: **npm.cmd start**, **npm.cmd stop**, **npm.cmd run status**, **npm.cmd run refresh**, **npm.cmd run doctor -- --probe**, **npm.cmd run storage:status**, **npm.cmd test**.

El avance y las dos aceptaciones pendientes están en [PROGRESO.md](PROGRESO.md). Esta entrega no acredita rentabilidad ni completa jugadores, córners, tarjetas, directo o combinadas; se añadirán una a una.

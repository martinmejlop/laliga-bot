# Registro manual y panel local

El registro conserva por separado las apuestas que el usuario ya ha realizado y las simulaciones. Ninguna operación de este módulo inicia sesión en Bet365, envía una apuesta o mueve fondos.

## Dinero y confirmación

Los dos libros parten de un presupuesto contable de 100 €. El libro real empieza **sin saldo confirmado**: antes de registrar una apuesta real, el usuario confirma el **dinero libre** que ve en Bet365. Las apuestas pendientes ya registradas se contabilizan aparte.

`bankrollEur` es capital libre más importes comprometidos; `availableEur` y `balanceEur` son dinero libre. Una confirmación de saldo registra una conciliación explícita y conserva el ajuste como tal: no lo cuenta como beneficio de apuestas.

Anotar una apuesta compromete su importe una sola vez. Liquidarla libera el compromiso y suma su beneficio o pérdida. Ganancia, pérdida, devolución, media ganancia y media pérdida se calculan en céntimos; también se puede anotar la devolución total realmente cobrada. La devolución incluye el importe recuperado, no solo el beneficio.

Una corrección de cuota, selección, mercado o importe se permite mientras la apuesta está pendiente y requiere un motivo. La anotación original permanece en el historial. Después de liquidar, los ajustes posteriores se reflejan conciliando el saldo disponible; no se reescribe una liquidación anterior.

## Persistencia

`src/ledger/service.ts` exporta `Ledger`. Utiliza su propio archivo SQLite (`data/ledger.sqlite`, decidido por el servicio principal), con identificador de aplicación, versión y eventos que impiden modificaciones y borrados. Cada operación se ejecuta en una transacción inmediata y requiere `idempotencyKey`. Repetir exactamente la misma petición devuelve el resultado guardado; reutilizar la clave con otros datos se rechaza.

Las operaciones disponibles son `confirmBalance`, `recordBet`, `correctBet`, `settleBet`, `snapshot`, `integrity` y `close`. `recordBet` requiere `mode: 'manual' | 'simulation'`. Los saldos, posiciones y beneficios de cada libro permanecen separados.

## Panel

El panel en `src/ui` muestra oportunidades, partidos, evaluación, noticias y evidencia, saldo, registro y lista de avance. Consulta el estado local cada diez segundos y vuelve a comprobar la vigencia visual de las cuotas. Un importe solo se muestra si el servidor lo habilita y la cuota tiene región contrastada, tiempos coherentes, confirmación reciente y partido futuro. El distintivo «Gran oportunidad» exige además la condición explícita del servicio principal.

Las acciones son revisar análisis, actualizar noticias, iniciar o detener el seguimiento, consultar el informe, conciliar saldo, anotar una apuesta ya realizada, corregirla, liquidarla y solicitar una copia de seguridad. Las actualizaciones se presentan **solo en el panel**, mientras el programa está abierto; no hay horario fijo ni avisos a otros chats.

El usuario también indica el mínimo de apuesta que admite su cuenta. Mientras ese dato no esté confirmado, no se supone un mínimo de Bet365 ni se proponen importes positivos. Las acciones del panel usan el identificador de sesión recibido del servicio local para impedir que otra página envíe operaciones a ciegas.

Las pruebas aisladas de `test/ledger.test.ts` verifican separación de libros, saldo sin confirmar, duplicados, conflictos, liquidaciones, conciliación, corrección, límites de dinero, céntimos, persistencia y protección del historial. Ninguna prueba registra operaciones en el libro real.

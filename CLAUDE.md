# Restricción del equipo (portátil ajeno)
- No instalar nada global en el sistema: ni Android SDK, ni Android Studio, ni otro JDK, ni `npm i -g`.
- Solo dependencias del proyecto (`npm install` dentro de `mny/`, quedan en `node_modules`). Herramientas CLI con `npx`.
- **No servir nada en la red** (ni LAN ni `--tunnel`): el usuario trabaja en redes ajenas.
  - Previsualizar solo en el propio portátil: `npx expo start --web --localhost`.
  - Al móvil solo vía la nube de Expo: APK con EAS Build (`npx eas-cli build -p android --profile preview`), una vez; los cambios posteriores con EAS Update (`npx eas-cli update`).

# Reglas de despliegue de subagentes

Al delegar con la herramienta Agent, pasa siempre el parámetro `model` según la tarea:

| Tarea | `model` |
|-------|---------|
| Razonar, planificar, revisar código, decidir y delegar (orquestación) | `opus` |
| Buscar en internet (WebSearch / WebFetch, documentación, research) | `haiku` |
| Programar: escribir, editar, refactorizar código, arreglar builds/tests | `sonnet` |
| Escalado: el modelo asignado no llega | `fable` |

## Escalado a `fable`
Relanza la tarea con `model: "fable"` cuando el subagente asignado:
- falla dos veces la misma tarea o devuelve un resultado incorrecto/incompleto tras revisión,
- se atasca en un bug o diseño que no consigue resolver,
- o la tarea es claramente de máxima dificultad (arquitectura compleja, razonamiento profundo).

Al escalar, incluye en el prompt qué intentó el subagente anterior y por qué falló.

## Flujo
1. El agente principal (opus) razona y divide el trabajo.
2. Búsquedas web → subagentes `haiku`; código → subagentes `sonnet`.
3. Opus revisa cada resultado antes de darlo por bueno; si no pasa, escala a `fable`.

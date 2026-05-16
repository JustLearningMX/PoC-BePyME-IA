# Implementación de Card Final con Qlik Embed

## Descripción
Se ha implementado una funcionalidad que convierte el resultado final de los agentes en una tarjeta visualmente atractiva con un gráfico de Qlik embebido.

## Cambios Realizados

### 1. Estilos CSS (`src/styles/customAIChat.css`)
Se agregaron nuevos estilos para la tarjeta final:
- `.assistant-final-card`: Contenedor principal con gradiente verde suave y sombra
- `.assistant-final-card-title`: Título con un checkmark verde (✓)
- `.assistant-final-card-content`: Área de contenido con borde izquierdo verde
- `.assistant-final-card-embed`: Contenedor para el Qlik embed

### 2. JavaScript (`src/scripts/customAIChat.js`)

#### Nueva función: `getQlikAssistantId()`
```javascript
async function getQlikAssistantId() {
    const cfg = await qlikConfigPromise;
    return cfg.QLIK_ASSISTANT_ID || null;
}
```
Obtiene el QLIK_ASSISTANT_ID del backend para usarlo como `app-id` en el embed de Qlik.

#### Nueva función: `createFinalCard(content, objectId = "ZxDKp")`
```javascript
function createFinalCard(content, objectId = "ZxDKp") {
    // Crea una tarjeta HTML que incluye:
    // 1. Un título con checkmark verde
    // 2. El contenido del resultado final (con soporte para **negrita**)
    // 3. Un componente Qlik embed con:
    //    - ui="analytics/chart"
    //    - app-id = QLIK_ASSISTANT_ID
    //    - object-id = ID extraído del contenido o ZxDKp por defecto
    //    - disable-cell-padding="true"
}
```

#### Modificación en `processTextChunk()`
Cuando se detecta un tag `<final>`:
1. Extrae el object-id del contenido (UUID en formato estándar)
2. Crea la tarjeta usando `createFinalCard()`
3. La agrega directamente al chat-body
4. Scrollea automáticamente para mostrar el resultado

## Ejemplo de Uso

### Input (desde el agente)
```html
<final>Tienes **1,860 clientes** registrados en el sistema CRM BePyME. <chart id="791ef0ba-7071-4bfb-828b-1a282fb241f1"></chart> <statement>El total de clientes únicos registrados en tu sistema CRM BePyME es de 1,860[791ef0ba-7071-4bfb-828b-1a282fb241f1]</statement></final>
```

### Output (Renderizado)
Una tarjeta con:
1. **Título**: "Resultado Final" con checkmark verde
2. **Contenido**: "Tienes **1,860 clientes** registrados en el sistema CRM BePyME."
3. **Chart**: Un Qlik embed que muestra un gráfico/tabla con:
   - app-id: 47461ad6-1685-4ed6-a00a-e0f6224b3b0d (QLIK_ASSISTANT_ID)
   - object-id: 791ef0ba-7071-4bfb-828b-1a282fb241f1 (extraído del content)

## Características

✅ **Detección automática de UUID**: Extrae el ID del gráfico del contenido final
✅ **Soporte para markdown**: Convierte `**texto**` a `<strong>texto</strong>`
✅ **Integración con Qlik**: Usa el app-id del QLIK_ASSISTANT_ID del .env
✅ **Diseño responsive**: Se adapta al ancho del chat
✅ **Estilos visuales**: Gradiente verde suave con sombra y checkmark

## Notas

- El object-id por defecto es "ZxDKp" si no se encuentra un UUID en el contenido
- El app-id siempre es el QLIK_ASSISTANT_ID del backend (47461ad6-1685-4ed6-a00a-e0f6224b3b0d)
- La tarjeta se renderiza como un mensaje del asistente (alineado a la izquierda)
- El CSS incluye animación suave para la transición de estilos


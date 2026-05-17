# Qlik Answers Chat UI — Especificación de Implementación

## Contexto

Construir un chat frontend que consuma el stream de Qlik Answers y muestre en tiempo real:
1. Los agentes trabajando (con su razonamiento expandible)
2. La conclusión final como Adaptive Card con KPI
3. Preguntas sugeridas

El backend ya existe en Node.js (Express + node-fetch) y expone un endpoint `/stream-answers?question=...` que hace proxy al API de Qlik.

---

## Stack

- **Frontend:** HTML/JS puro.
- **Backend:** Node.js ya existente
- **Estilos:** CSS variables nativas

---

## Arquitectura del stream

El endpoint `/stream-answers` devuelve SSE con esta estructura por evento:

```
data: {"params": {"op": "add/replace", "path": "/content/0/card/body/0/steps/N/...", "value": {...}}, "context": {}}
data: {"params": {"op": "add/replace", "path": "...", "value": "texto parcial"}, "context": {}}
...muchos eventos de patch incremental...
data: {"method": "message", "params": {"content": [...], "context": {...}, "followUpActions": [...], "summary": "..."}, "context": {}}
```

El evento final `method: "message"` contiene la respuesta completa consolidada.

### Tipos de eventos relevantes

| Evento | Cómo identificarlo | Qué hacer |
|--------|-------------------|-----------|
| Nuevo agente aparece | `params.op === "add"` y `params.value.displayName` existe | Agregar agente a la lista con spinner |
| Step del agente cambia | `params.value.isSubtle === true` y `params.value.text` | Mostrar como subtítulo del agente activo |
| Texto de razonamiento | `params.path` incluye `toggleContent` y `params.value` es string | Acumular en el razonamiento del agente |
| Respuesta final | `params.method === "message"` | Renderizar Adaptive Card con conclusión |
| Agente completa | Cuando llega el siguiente agente | Marcar el anterior con ✓ |

---

## Estructura de componentes

Actualizarlo al estado actual del proyecto.

---

## Fase 1 — Leer y parsear el stream

### 1.1 Conectar al SSE desde el frontend

```javascript
async function streamQuestion(question, onEvent, onDone) {
  const res = await fetch(`/stream-answers?question=${encodeURIComponent(question)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) { onDone(); break; }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // guardar línea incompleta

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const json = JSON.parse(line.replace(/^data:\s*/, ""));
        onEvent(json);
      } catch(e) { /* chunk parcial */ }
    }
  }
}
```

### 1.2 Extraer datos de cada evento

```javascript
function processEvent(event, state) {
  const p = event.params;

  // Evento final completo
  if (event.method === "message") {
    const content = p.content?.[0];
    const card = content?.card;
    return {
      type: "FINAL",
      conclusion: card?.body?.find(b => b.text && !b.type?.includes("Action")),
      kpi: extractKPI(card),
      followUps: content?.followUpActions || [],
      summary: p.summary || ""
    };
  }

  // Nuevo agente
  if (p?.op === "add" && p?.value?.displayName) {
    return {
      type: "NEW_AGENT",
      name: p.value.displayName,  // "Answers Agent" | "Data Analyst Agent"
      title: p.value.title
    };
  }

  // Cambio de step del agente (subtítulo)
  if (p?.value?.isSubtle === true && p?.value?.text) {
    return {
      type: "AGENT_STEP",
      step: p.value.text  // "Understanding intent", "Searching fields", etc.
    };
  }

  // Texto de razonamiento incremental
  if (p?.path?.includes("toggleContent") && typeof p?.value === "string") {
    return {
      type: "REASONING_CHUNK",
      text: p.value
    };
  }

  return null;
}

function extractKPI(card) {
  // El snapshot viene en body[2] generalmente
  const snapshot = card?.body?.find(b => b.snapshot);
  if (!snapshot) return null;
  const matrix = snapshot.snapshot?.data?.qHyperCube?.qDataPages?.[0]?.qMatrix;
  const val = matrix?.[0]?.[0];
  return {
    value: val?.qNum,
    text: val?.qText,
    title: snapshot.snapshot?.title || "",
    expression: snapshot.snapshot?.object_properties?.qHyperCubeDef?.qMeasures?.[0]?.qDef?.qDef || ""
  };
}
```

---

## Fase 2 — Estado de la UI

### 2.1 Estructura del estado

```javascript
const initialState = {
  isStreaming: false,
  agents: [],
  // agents tiene esta forma:
  // {
  //   id: "agent-0",
  //   name: "Answers Agent",
  //   status: "active" | "done",
  //   currentStep: "Understanding intent",
  //   reasoning: ""   // texto acumulado del razonamiento
  // }
  conclusion: null,
  // conclusion: {
  //   text: "Tienes 1,860 clientes...",
  //   kpi: { value: 1860, text: "1860", title: "Total de Clientes", expression: "Count(distinct [ID_CLIENTE])" }
  //   followUps: [{ text: "...", type: "question" }]
  // }
};
```

### 2.2 Reducer de eventos

```javascript
function reducer(state, event) {
  switch (event.type) {
    case "NEW_AGENT":
      // marcar el anterior como done
      const updatedAgents = state.agents.map((a, i) =>
        i === state.agents.length - 1 ? { ...a, status: "done" } : a
      );
      return {
        ...state,
        agents: [...updatedAgents, {
          id: `agent-${state.agents.length}`,
          name: event.name,
          status: "active",
          currentStep: "",
          reasoning: ""
        }]
      };

    case "AGENT_STEP":
      return {
        ...state,
        agents: state.agents.map((a, i) =>
          i === state.agents.length - 1
            ? { ...a, currentStep: event.step }
            : a
        )
      };

    case "REASONING_CHUNK":
      return {
        ...state,
        agents: state.agents.map((a, i) =>
          i === state.agents.length - 1
            ? { ...a, reasoning: a.reasoning + event.text }
            : a
        )
      };

    case "FINAL":
      return {
        ...state,
        isStreaming: false,
        agents: state.agents.map(a => ({ ...a, status: "done" })),
        conclusion: {
          text: event.conclusion?.text || "",
          kpi: event.kpi,
          followUps: event.followUps
        }
      };
  }
}
```

---

## Fase 3 — UI: AgentTimeline

### Diseño visual (replicar imagen de referencia)

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ● ─── Answers Agent              Show reasoning ▾  │
│  │     Understanding intent                         │
│  │                                                  │
│  ● ─── Data Analyst Agent         Show reasoning ▾  │
│  │     Building expressions                         │
│  │                                                  │
│  ◌ ─── Answers Agent              Show reasoning ▾  │
│         (spinner animado)                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Especificación de estilos del AgentStep

```css
/* Línea vertical conectora */
.agent-timeline-line {
  width: 2px;
  background: #e0e0e0;
  /* cuando el agente está done: #22c55e (verde) */
}

/* Círculo del agente */
.agent-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #22c55e;  /* done */
  /* active: spinner animado con border-top transparent */
  /* pending: border color gris */
}

/* Nombre del agente */
.agent-name {
  font-weight: 600;
  font-size: 15px;
}

/* Step actual */
.agent-step {
  font-size: 13px;
  color: #888;
  margin-top: 2px;
}

/* Botón Show reasoning */
.show-reasoning-btn {
  font-size: 13px;
  color: #555;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  margin-left: auto;
}
```

### Razonamiento expandible (Show reasoning)

Al hacer clic en "Show reasoning" mostrar un panel con el texto del razonamiento.
El texto viene con markdown — renderizarlo con `marked` o similar.
Limpiar tags internos de Qlik: `<plan>`, `<final>`, `<chart>`, `<statement>`, `<cite>`.

```javascript
function cleanReasoning(text) {
  return text
    .replace(/<plan>|<\/plan>|<final>|<\/final>|<chart[^>]*>|<\/chart>|<statement>|<\/statement>|<cite>|<\/cite>/g, "")
    .replace(/\\u003c[^\\u003e]*\\u003e/g, "")
    .trim();
}
```

---

## Fase 4 — UI: ConclusionCard

Mostrar solo cuando llega el evento `FINAL`. Replicar diseño de la imagen de referencia.

```
┌─────────────────────────────────────────────────────┐
│ Conclusion                                          │
│                                                     │
│ Tienes 1,860 clientes registrados en tu CRM ¹       │
│                                                     │
│         Total de Clientes                           │
│                                                     │
│              1,860                                  │
│                                                     │
│ ────────────────────────────────────────────────    │
│           □ View source                             │
└─────────────────────────────────────────────────────┘

  🔍 ¿Cuántos clientes han sido visitados...?     ↵
  🔍 ¿Cuáles son los saldos promedio...?          ↵
```

### Lógica del KPI display

- Si `kpi.value >= 1000` → mostrar como `1.27k` o `1,271` (según preferencia)
- El título del KPI viene en `kpi.title`
- La expresión viene en `kpi.expression` — mostrar en "View source"

---

## Fase 5 — Backend: modificar para soportar el stream real

El backend actual usa `for await (const chunk of invokeResponse.body)`.
Modificar para pasar los eventos **sin transformar** al cliente:

```javascript
app.get("/stream-answers", async (req, res) => {
  // ... crear thread igual que antes ...

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  // Pasar el stream de Qlik directo al cliente sin transformar
  const decoder = new TextDecoder();
  for await (const chunk of invokeResponse.body) {
    const text = decoder.decode(chunk);
    // Re-emitir cada línea data: tal cual
    res.write(text);
  }

  res.end();
});
```

---

## Fase 6 — Integración final

### Flujo completo

```
Usuario escribe pregunta
        │
        ▼
frontend llama GET /stream-answers?question=...
        │
        ▼
Mostrar AgentTimeline vacío con spinner
        │
        ▼ (por cada evento SSE)
processEvent() → reducer() → re-render AgentTimeline
        │
        ▼ (evento method:"message")
Ocultar spinner, mostrar ConclusionCard + FollowUps
        │
        ▼
Usuario hace clic en pregunta sugerida
        │
        ▼
Repetir flujo con nueva pregunta (nuevo thread cada vez)
```

Agrega soporte completo para Adaptive Cards usando los datos que ya vienen 
en el stream de Qlik, específicamente en el evento final `method: "message"`.

## Lo que trae el stream

El evento final tiene esta estructura en `params.content[0].card`:

```json
{
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "type": "AdaptiveCard",
  "version": "1.3",
  "body": [
    { "type": "TextBlock", "text": "Conclusion", "weight": "bolder", "size": "medium" },
    { "type": "TextBlock", "text": "Tienes **1,860 clientes**...", "wrap": true },
    { 
      "type": "Qlik.Snapshot",   <-- KPI/chart con datos reales
      "snapshot": {
        "data": { "qHyperCube": { "qDataPages": [...], "qMeasureInfo": [...] } },
        "title": "Total de Clientes",
        "visualization": "kpi",
        "object_properties": {
          "qHyperCubeDef": {
            "qMeasures": [{ "qDef": { "qDef": "Count(distinct [ID_CLIENTE])" } }]
          }
        }
      }
    },
    { "type": "TextBlock", "text": "El sistema muestra..." },
    { "type": "ActionSet", "actions": [{ "type": "Action.Submit", "title": "View source" }] }
  ],
  "citations": [...],
  "followUpActions": [
    { "text": "¿Cuántos clientes han sido visitados...?", "type": "question" }
  ]
}
```

## Lo que necesito

1. **Renderer de Adaptive Cards propio** — NO uses la librería oficial 
   `adaptivecards` de Microsoft porque no soporta los tipos custom de Qlik 
   (`Qlik.Snapshot`, `Qlik.Stepper`). Construye un renderer custom en React 
   que maneje estos elementos:

   | Tipo en el JSON | Cómo renderizarlo |
   |----------------|-------------------|
   | `TextBlock` con `weight: "bolder"` | Título de sección (h3) |
   | `TextBlock` normal con `wrap: true` | Párrafo con markdown (usa `marked`) |
   | `Qlik.Snapshot` con `visualization: "kpi"` | KPI grande: número + título + expresión |
   | `Qlik.Snapshot` con `visualization: "bar"` / `"pie"` | Chart.js con los datos de `qHyperCube` |
   | `ActionSet` con `verb: "view-source"` | Botón "View source" que expande los detalles del snapshot |
   | `Container` con `id: "detailsSection"` | Panel colapsable (oculto por default) |

2. **Extracción de datos del qHyperCube** para alimentar Chart.js:
   - `qDimensionInfo` → labels del eje X
   - `qMeasureInfo[0].qFallbackTitle` → label del dataset
   - `qDataPages[0].qMatrix` → filas de datos, cada celda tiene `qText` y `qNum`

3. **citations** — el card trae `citations` con referencias a charts. El 
   TextBlock que menciona la cita tiene `<citation data-index="0">1</citation>` 
   en su texto. Renderizar eso como un superíndice clickeable que resalta el 
   chart referenciado.

4. **followUpActions** — ya están en el card, úsalos directamente desde ahí 
   en lugar de buscarlos en otro lado.

5. El componente se llama `<AdaptiveCardRenderer card={card} />` y recibe el 
   objeto card completo del evento final. Lo usa `ConclusionCard` 
   internamente.

## View source y Citations

### Botón "View source"
El ActionSet con verb "view-source" debe mostrar/ocultar un panel 
debajo del KPI con estos datos del snapshot.source:
┌─────────────────────────────────────┐
│ Source                          ✕   │
│                                     │
│ App ID                              │
│ 0965781c-cbc1-40ee-937f-...         │
│                                     │
│ Expresión                           │
│ Count(distinct [ID_CLIENTE])        │
│                                     │
│ Proporciona una métrica clave del   │
│ tamaño de la base de clientes       │
└─────────────────────────────────────┘

Datos a mostrar:
- `snapshot.source.appId`
- `snapshot.source.measures[].expression` (en monospace)
- `snapshot.source.measures[].label`  
- `snapshot.source.reason`

Estado: toggle local con useState, oculto por default.

### Superíndice citation (el "1")

1. Al renderizar un TextBlock, buscar tags `<citation data-index="N">` 
   en el texto y reemplazarlos con un `<sup>` clickeable.

2. Al hacer clic, usar el índice N para buscar en `card.citations[N].sources[0].chart`
   que es un path tipo "/card/body/2" — el número final es el índice del 
   elemento en card.body que se debe resaltar.

3. Resaltar ese elemento: agregar un ref al Qlik.Snapshot correspondiente 
   y al hacer clic en el superíndice hacer scroll a él + aplicar un 
   highlight temporal (border azul por 2 segundos con transition).

Implementación sugerida:
- `const snapshotRefs = useRef({})` — un ref por cada índice de body
- En el superíndice: `onClick={() => highlightSource(citationIndex)}`
- `highlightSource(n)` resuelve el path, hace scroll y aplica clase CSS

## Botón "View source" — link a Qlik

En lugar de (o además de) mostrar el panel con los datos del source,
el botón "View source" debe abrir la app de Qlik en una nueva pestaña.

Los datos para construir la URL vienen del snapshot:

- TENANT: variable de entorno `VITE_QLIK_TENANT` 
  (ej: "https://dataiq-mexico.us.qlikcloud.com")
- APP_ID: `snapshot.source.appId`
  (ej: "0965781c-cbc1-40ee-937f-8431b662d86e")
- OBJECT_ID: `snapshot.data.qInfo.qId`
  (ej: "e9afb5b6-1949-432d-8aad-b680f2401485")

Construir la URL así:
```javascript
const qlikUrl = `${TENANT}/sense/app/${appId}/object/${objectId}`;
window.open(qlikUrl, "_blank");
```

Esto abre directo el objeto (KPI/chart) dentro de la app de Qlik.

Si el usuario no tiene sesión activa en Qlik, lo redirigirá al login 
automáticamente y después al objeto — ese comportamiento es correcto,
no hay que manejarlo.

Si `objectId` no está disponible, fallback a solo la app:
```javascript
const qlikUrl = `${TENANT}/sense/app/${appId}`;
```

El botón debe verse así:
- Ícono de libro o enlace externo
- Texto "View source" 
- Al hacer clic: abrir nueva pestaña con la URL de Qlik
- Tooltip: mostrar la URL al hacer hover

## Diseño visual esperado

Replicar el diseño de la imagen de referencia (Qlik Answers UI):
- Card con borde suave, fondo blanco
- Título "Conclusion" en bold arriba
- Texto de respuesta con el número en bold
- KPI centrado con número grande en azul (#1a7abf) y título arriba
- Línea divisora
- Botón "View source" centrado con ícono de libro
- Fuera de la card: preguntas sugeridas como filas con ícono circular 
  a la izquierda y flecha ↵ a la derecha

## Notas

- El texto de los TextBlock puede tener markdown (`**bold**`) — parsearlo.
- El valor del KPI está en `qDataPages[0].qMatrix[0][0].qNum` y formateado 
  en `qText` (puede ser "1860" o "1.27k" según el formato del app de Qlik).
- Usar el `qText` formateado que ya viene, no reformatear el número.
- Si `visualization` no es "kpi" ni un tipo conocido, ignorar ese elemento 
  y loguearlo en consola.
- El campo `reasoning` del card es para el AgentTimeline, no para 
  ConclusionCard — ignorarlo aquí.

### Archivos a crear

```
/src
  /components
    AgentTimeline.jsx     — lista de agentes con línea vertical
    AgentStep.jsx         — un agente: dot + nombre + step + reasoning
    ConclusionCard.jsx    — card final con KPI
    KPIDisplay.jsx        — número grande del KPI
    FollowUps.jsx         — preguntas sugeridas
    QuestionBar.jsx       — input + botón
  /hooks
    useQlikStream.js      — lógica de fetch + reducer + estado
  /utils
    parseEvents.js        — processEvent() + extractKPI() + cleanReasoning()
  App.jsx
  main.jsx
/server
  index.js               — backend Node.js existente (modificar Fase 5)
```

---

## Notas importantes para el agente de IA

1. **El API Key nunca va al frontend** — solo el backend lo usa.
2. **Crear un nuevo thread por cada pregunta** — no reutilizar threads.
3. **El evento `method:"message"` puede llegar partido en varios chunks** — acumular en buffer antes de parsear.
4. **Los eventos de patch intermedios tienen JSON anidado complejo** — no intentar reconstruir el Adaptive Card desde los patches, usar solo el evento final para la conclusión.
5. **El texto de razonamiento viene con unicode escapado** (`\u003c` = `<`) — usar `JSON.parse` lo decodifica automáticamente.
6. **Algunos eventos tienen `path` con índices de array** como `/content/0/card/body/0/steps/1/content/toggleContent/0/items/2/text` — el número después de `steps/` indica qué agente (0 = primero, 1 = segundo, etc.).
7. **El campo `displayName` del agente** es el nombre amigable ("Answers Agent", "Data Analyst Agent") — usar ese, no `title`.
8. **CORS:** si el frontend y backend no están en el mismo origen, configurar `cors()` en Express.

---

## Checklist de implementación

- [ ] Hook `useQlikStream` con fetch + reader + buffer + reducer
- [ ] `processEvent()` correctamente identifica los 4 tipos de eventos
- [ ] `AgentTimeline` muestra agentes en orden con línea conectora
- [ ] Spinner animado en el agente activo, ✓ verde en los completados
- [ ] "Show reasoning" expande/colapsa el texto del agente
- [ ] `ConclusionCard` aparece solo cuando llega `method:"message"`
- [ ] KPI formateado correctamente (toLocaleString)
- [ ] `FollowUps` disparan nueva pregunta al hacer clic
- [ ] Backend re-emite el stream de Qlik sin transformar
- [ ] Variables de entorno para API_KEY, TENANT, ASSISTANT_ID
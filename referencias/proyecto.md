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
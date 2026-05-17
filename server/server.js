import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Cargar variables de entorno desde .env
dotenv.config();

const app = express();
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5500";

// Middlewares
app.use(express.json());
app.use(cors({ origin: frontendOrigin, credentials: true }));

// Variables de entorno de Qlik
const QLIK_HOST = process.env.QLIK_HOST || "https://dataiq-mexico.us.qlikcloud.com";
const QLIK_TOKEN = process.env.QLIK_TOKEN;
const QLIK_ASSISTANT_ID = process.env.QLIK_ASSISTANT_ID;

// Endpoint de Health: Verifica si el servidor está en funcionamiento
app.get("/health", (_req, res) => {
  res.json({ ok: true, mensaje: "El servidor backend está funcionando correctamente." });
});

// Endpoint útil para debuggear y verificar la configuración
app.get("/debug/env", (_req, res) => {
  res.json({
    QLIK_HOST: QLIK_HOST || null,
    QLIK_ASSISTANT_ID: QLIK_ASSISTANT_ID || null,
    API_KEY_CONFIGURADA: !!QLIK_TOKEN
  });
});

// 1. Crear un thread
app.post("/api/threads", async (req, res) => {
  try {
    const question = req.body?.question || "Pregunta inicial";
    const assistantId = req.body?.assistantId || QLIK_ASSISTANT_ID;

    if (!QLIK_TOKEN) {
      return res.status(500).json({ error: "Falta configurar QLIK_TOKEN (ApiKey) en el archivo .env" });
    }

    const url = `${QLIK_HOST.replace(/\/$/, "")}/api/v1/cloud-assistants/threads`;

    const body = {
      name: `Assistan for ${question}`,
      context: {
        type: "assistant",
        id: assistantId,
        data: {
          embedded: true,
          route: "assistants"
        }
      },
      messages: []
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${QLIK_TOKEN}`,
        "Accept-Language": "es"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    console.log("Data: ", data);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Error al crear el thread en Qlik", details: data });
    }

    res.json(data);
  } catch (error) {
    console.error("Error en POST /api/threads:", error);
    res.status(500).json({ error: "Error interno del servidor", details: error.message });
  }
});

// 2. Crear y escuchar el stream (Soporta GET para EventSource y POST para fetch con body)
app.all("/api/stream", async (req, res) => {
  try {
    const question = req.method === "POST" ? req.body?.question : req.query.question;
    const threadId = req.method === "POST" ? req.body?.threadId : req.query.threadId;
    const assistantId = (req.method === "POST" ? req.body?.assistantId : req.query.assistantId) || QLIK_ASSISTANT_ID;

    if (!question || !threadId) {
      return res.status(400).json({ error: "Se requiere 'question' y 'threadId'" });
    }

    if (!QLIK_TOKEN) {
      return res.status(500).json({ error: "Falta configurar QLIK_TOKEN (ApiKey) en el archivo .env" });
    }

    const url = `${QLIK_HOST.replace(/\/$/, "")}/api/v1/cloud-assistants/${threadId}/actions/stream`;

    const requestBody = {
      context: {
        type: "assistant",
        id: assistantId,
        data: {
          embedded: true,
          route: "assistants"
        }
      },
      content: [{ text: String(question).trim() }]
    };

    const streamResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${QLIK_TOKEN}`,
        "Accept-Language": "es"
      },
      body: JSON.stringify(requestBody)
    });

    // Configurar los headers de SSE (Server-Sent Events) SIEMPRE primero
    // para que EventSource se conecte y podamos mandarle errores.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    if (!streamResponse.ok) {
      const errorData = await streamResponse.text();
      let parsedError = errorData;
      try { parsedError = JSON.parse(errorData); } catch (e) { /* ignore */ }

      console.error("Error desde Qlik Stream:", parsedError);
      res.write(`data: ${JSON.stringify({ kind: "error", error: "El stream de Qlik falló", details: parsedError })}\n\n`);
      res.write(`data: ${JSON.stringify({ kind: "done" })}\n\n`);
      res.end();
      return;
    }

    // Redirigir el flujo del servidor de Qlik directamente al cliente
    for await (const chunk of streamResponse.body) {
      res.write(chunk);
    }

    res.end();
  } catch (error) {
    console.error("Error en /api/stream:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno del servidor", details: error.message });
    } else {
      // Si ya se enviaron las cabeceras SSE, enviamos el error como un evento
      res.write(`data: ${JSON.stringify({ error: "Error interno", details: error.message })}\n\n`);
      res.end();
    }
  }
});

// Alias para retrocompatibilidad con la versión anterior si el frontend aún lo usa
app.get("/stream-answers", async (req, res) => {
  // Redirigimos el comportamiento al nuevo endpoint pasando los parámetros de query.
  // Es importante tener 'threadId' en el query, de otra forma fallará.
  req.url = "/api/stream";
  app._router.handle(req, res, () => { });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Backend escuchando en http://localhost:${port}`);
});

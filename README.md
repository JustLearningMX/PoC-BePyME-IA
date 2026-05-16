# Simple Answer Bot

Demo con frontend embebido de Qlik y backend Express para stream de Assistants (Answers 2.0 / Agentic AI) sin exponer token en el navegador.

## Requisitos
- Node.js 18+

## Archivos principales
- `src/index.html`
- `src/scripts/customAIChat.js`
- `server/server.js`
- `server/qlikClient.js`

## Configuración
Copia `.env.example` a `.env` y completa los valores reales:

```powershell
Copy-Item .env.example .env
```

Variables clave:
- `QLIK_HOST`
- `QLIK_ASSISTANT_ID`
- `QLIK_APP_ID`
- `CLOUD_ASSISTANT_ID`
- `QLIK_WEB_INTEGRATION_ID`
- OAuth: `QLIK_OAUTH_CLIENT_ID` (y opcionalmente `QLIK_OAUTH_CLIENT_SECRET`)
- Opcional dev fallback: `QLIK_TOKEN`

## Instalar dependencias
```powershell
npm install
```

## Ejecutar backend
```powershell
npm start
```

## Probar backend
```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3001/health"
Invoke-RestMethod -Method Get -Uri "http://localhost:3001/auth/status"
```

Smoke test rápido:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1
```

## Flujo actual (A + B + C)
1. Frontend abre SSE a `GET /stream-answers?question=...` con cookie de sesión.
2. Backend toma token en este orden:
   - sesión OAuth (`/auth/login` + `/auth/callback`),
   - fallback `QLIK_TOKEN`.
3. Backend llama **exactamente** al flujo embed cloud-assistant:
   - `POST /api/v1/cloud-assistants/{cloudAssistantId}/actions/stream`
   - body `context + content`.
4. Backend parsea SSE de Qlik y reemite eventos al frontend (`text`, `raw`, `error`, `done`).

## Endpoints útiles
- `GET /auth/login` (inicia OAuth)
- `GET /auth/callback` (callback OAuth)
- `GET /auth/status`
- `POST /auth/logout`
- `GET /debug/env`
- `GET /debug/assistant-sources`
- `POST /debug/forward`

## Checklist AA-002 (solo app como fuente, sin KB)
Si aparece `AA-002 Failed to retrieve data sources`:
1. Verifica en `GET /debug/assistant-sources` que `contents` incluya una fuente tipo app.
2. Confirma que el **usuario OAuth** (no solo API key) tiene acceso al app en el espacio correcto.
3. Revisa Section Access del app para ese usuario.
4. Asegura que `CLOUD_ASSISTANT_ID` corresponda al assistant correcto.
5. Si el embed oficial responde y el custom no, autentica con `/auth/login` para usar el mismo contexto de usuario.

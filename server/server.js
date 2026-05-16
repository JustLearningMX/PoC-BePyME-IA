import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createThread } from "./qlikClient.js";

// Load .env if present
dotenv.config();

// If some important vars are missing, try .env.example defaults (local dev convenience)
const exampleEnvPath = path.resolve(process.cwd(), ".env.example");
if (fs.existsSync(exampleEnvPath)) {
  try {
    const lines = fs.readFileSync(exampleEnvPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [k, ...rest] = trimmed.split("=");
      const key = k.trim();
      const val = rest.join("=").trim();
      const looksLikePlaceholder = /^replace-with-/i.test(val);
      if (!process.env[key] && val && !looksLikePlaceholder) {
        process.env[key] = val;
      }
    }
  } catch (e) {
    console.warn("Failed to read .env.example:", e.message);
  }
}

const app = express();
const oauthStates = new Map();
const oauthSessions = new Map();

const backendOrigin = process.env.BACKEND_ORIGIN || `http://localhost:${process.env.PORT || 3001}`;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:63343";
const oauthRedirectUri = process.env.QLIK_OAUTH_REDIRECT_URI || `${backendOrigin}/auth/callback`;

app.use(express.json());
app.use(cors({ origin: frontendOrigin, credentials: true }));

// Serve example reasoning/embed images (read-only)
const embedImagesDir = path.resolve(process.cwd(), 'referencias', 'Razonamiento-Embed');
if (fs.existsSync(embedImagesDir)) {
  app.use('/referencias-Razonamiento-Embed', express.static(embedImagesDir, { index: false }));
}

app.get('/debug/embed-images', (_req, res) => {
  try {
    if (!fs.existsSync(embedImagesDir)) return res.json({ images: [] });
    const files = fs.readdirSync(embedImagesDir).filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));
    res.json({ images: files.map(f => `/referencias-Razonamiento-Embed/${f}`) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeHost(rawHost) {
  if (!rawHost) return null;
  return String(rawHost).replace(/\/$/, "");
}

function parseCookies(cookieHeader) {
  const result = {};
  if (!cookieHeader) return result;
  const parts = String(cookieHeader).split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    result[k] = decodeURIComponent(rest.join("=") || "");
  }
  return result;
}

function setSidCookie(res, sid) {
  const cookie = `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
  res.setHeader("Set-Cookie", cookie);
}

function getOrCreateSid(req, res) {
  if (req.__sid) return req.__sid;

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.sid) {
    req.__sid = cookies.sid;
    return req.__sid;
  }

  const sid = crypto.randomBytes(24).toString("hex");
  if (!res.headersSent) {
    setSidCookie(res, sid);
  }
  req.__sid = sid;
  return req.__sid;
}

function maskToken(token) {
  if (!token) return null;
  if (token.length <= 8) return "****";
  return `****${token.slice(-8)}`;
}

function hasOauthConfig() {
  return Boolean(process.env.QLIK_OAUTH_CLIENT_ID && normalizeHost(process.env.QLIK_HOST));
}

function createPkceChallenge(verifier) {
  const hashed = crypto.createHash("sha256").update(verifier).digest("base64");
  return hashed.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildQlikAuthHeaders(req, includeJson = true) {
  const headers = {};
  if (includeJson) headers["Content-Type"] = "application/json";
  headers.Accept = "*/*";

  const origin = req.headers.origin || frontendOrigin;
  const referer = req.headers.referer || `${origin}/`;
  if (origin) headers.Origin = origin;
  if (referer) headers.Referer = referer;

  const webIntegrationId = process.env.QLIK_WEB_INTEGRATION_ID;
  if (webIntegrationId) {
    headers["qlik-web-integration-id"] = webIntegrationId;
    headers["x-qlik-web-integration-id"] = webIntegrationId;
  }

  return headers;
}

async function exchangeAuthCodeForToken(code, verifier, req) {
  const host = normalizeHost(process.env.QLIK_HOST);
  const tokenUrl = `${host}/oauth/token`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.QLIK_OAUTH_CLIENT_ID,
    code,
    redirect_uri: oauthRedirectUri,
    code_verifier: verifier
  });

  if (process.env.QLIK_OAUTH_CLIENT_SECRET) {
    body.set("client_secret", process.env.QLIK_OAUTH_CLIENT_SECRET);
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...buildQlikAuthHeaders(req, false)
    },
    body: body.toString()
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    const err = new Error(`OAuth token exchange failed (${response.status})`);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

async function refreshOauthToken(session, req) {
  if (!session?.refreshToken) return null;

  const host = normalizeHost(process.env.QLIK_HOST);
  const tokenUrl = `${host}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.QLIK_OAUTH_CLIENT_ID,
    refresh_token: session.refreshToken
  });

  if (process.env.QLIK_OAUTH_CLIENT_SECRET) {
    body.set("client_secret", process.env.QLIK_OAUTH_CLIENT_SECRET);
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...buildQlikAuthHeaders(req, false)
    },
    body: body.toString()
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) return null;

  session.accessToken = data.access_token;
  session.refreshToken = data.refresh_token || session.refreshToken;
  session.expiresAt = Date.now() + Math.max((data.expires_in || 3600) - 30, 60) * 1000;
  return session.accessToken;
}

async function resolveAccessToken(req, res) {
  const sid = getOrCreateSid(req, res);
  const session = oauthSessions.get(sid);

  if (session?.accessToken && session.expiresAt && session.expiresAt > Date.now()) {
    return { token: session.accessToken, mode: "oauth", sid };
  }

  if (session?.refreshToken && hasOauthConfig()) {
    const refreshed = await refreshOauthToken(session, req);
    if (refreshed) return { token: refreshed, mode: "oauth", sid };
  }

  if (process.env.QLIK_TOKEN) {
    return { token: process.env.QLIK_TOKEN, mode: "static", sid };
  }

  return { token: null, mode: "none", sid };
}

function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractTextCandidates(value, out = []) {
  if (value == null) return out;

  if (typeof value === "string") {
    const t = value.trim();
    if (t) out.push(t);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) extractTextCandidates(item, out);
    return out;
  }

  if (typeof value === "object") {
    const preferredKeys = ["text", "markdown", "output", "title", "subtitle", "message", "value"];
    for (const key of preferredKeys) {
      if (key in value) extractTextCandidates(value[key], out);
    }

    for (const v of Object.values(value)) {
      if (typeof v === "object") extractTextCandidates(v, out);
    }
  }

  return out;
}

function classifyCloudEvent(parsed) {
  if (!parsed || typeof parsed !== "object") return { kind: "raw", data: parsed };

  if (parsed.method === "error") {
    return {
      kind: "error",
      error: parsed?.params?.message || "Qlik cloud-assistant error",
      code: parsed?.params?.data?.error_code || parsed?.params?.code || null,
      data: parsed
    };
  }

  const params = parsed.params || {};
  const texts = extractTextCandidates(params, []);
  if (texts.length) {
    return {
      kind: "text",
      text: texts.join("\n").trim(),
      raw: parsed
    };
  }

  return { kind: "raw", data: parsed };
}

async function qlikApiFetch(req, res, qlikPath, init = {}) {
  const host = normalizeHost(process.env.QLIK_HOST);
  if (!host) {
    const err = new Error("QLIK_HOST is required");
    err.status = 500;
    throw err;
  }

  const auth = await resolveAccessToken(req, res);
  if (!auth.token) {
    const err = new Error("No token available. Use /auth/login or set QLIK_TOKEN.");
    err.status = 401;
    err.code = "auth_required";
    throw err;
  }

  const headers = {
    ...buildQlikAuthHeaders(req, true),
    ...(init.headers || {}),
    Authorization: `Bearer ${auth.token}`
  };

  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null || v === "") {
      delete headers[k];
    }
  }

  const url = `${host}${qlikPath.startsWith("/") ? "" : "/"}${qlikPath}`;
  return fetch(url, { ...init, headers });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/debug/env", (_req, res) => {
  res.json({
    QLIK_HOST: process.env.QLIK_HOST || null,
    QLIK_ASSISTANT_ID: process.env.QLIK_ASSISTANT_ID || null,
    CLOUD_ASSISTANT_ID: process.env.CLOUD_ASSISTANT_ID || null,
    QLIK_WEB_INTEGRATION_ID: process.env.QLIK_WEB_INTEGRATION_ID || null,
    QLIK_TOKEN: process.env.QLIK_TOKEN ? maskToken(process.env.QLIK_TOKEN) : null,
    QLIK_OAUTH_CLIENT_ID: process.env.QLIK_OAUTH_CLIENT_ID || null,
    QLIK_OAUTH_REDIRECT_URI: oauthRedirectUri,
    PORT: process.env.PORT || null
  });
});

app.get("/auth/status", async (req, res) => {
  const sid = getOrCreateSid(req, res);
  const session = oauthSessions.get(sid);
  const hasValidOauth = Boolean(session?.accessToken && session?.expiresAt > Date.now());

  res.json({
    authenticated: hasValidOauth,
    authMode: hasValidOauth ? "oauth" : (process.env.QLIK_TOKEN ? "static" : "none"),
    oauthConfigured: hasOauthConfig(),
    expiresAt: hasValidOauth ? session.expiresAt : null
  });
});

app.get("/auth/login", (req, res) => {
  if (!hasOauthConfig()) {
    return res.status(400).json({
      error: "OAuth is not configured",
      required: ["QLIK_HOST", "QLIK_OAUTH_CLIENT_ID"],
      optional: ["QLIK_OAUTH_CLIENT_SECRET", "QLIK_OAUTH_SCOPES", "QLIK_WEB_INTEGRATION_ID"]
    });
  }

  const sid = getOrCreateSid(req, res);
  const state = crypto.randomBytes(24).toString("hex");
  const codeVerifier = crypto.randomBytes(48).toString("hex");
  const codeChallenge = createPkceChallenge(codeVerifier);
  const returnTo = String(req.query.returnTo || `${frontendOrigin}/simple-answer-bot/src/index.html`);

  oauthStates.set(state, {
    sid,
    codeVerifier,
    returnTo,
    createdAt: Date.now()
  });

  const host = normalizeHost(process.env.QLIK_HOST);
  const scopes = process.env.QLIK_OAUTH_SCOPES || "openid profile email offline_access";
  const authorizeUrl = `${host}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: process.env.QLIK_OAUTH_CLIENT_ID,
    redirect_uri: oauthRedirectUri,
    scope: scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  }).toString()}`;

  res.redirect(authorizeUrl);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.status(400).send(`OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`);
  }

  if (!code || !state) {
    return res.status(400).send("Missing OAuth callback parameters: code/state");
  }

  const pending = oauthStates.get(String(state));
  if (!pending) {
    return res.status(400).send("Invalid or expired OAuth state");
  }

  oauthStates.delete(String(state));

  try {
    const tokenData = await exchangeAuthCodeForToken(String(code), pending.codeVerifier, req);
    oauthSessions.set(pending.sid, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresAt: Date.now() + Math.max((tokenData.expires_in || 3600) - 30, 60) * 1000
    });

    setSidCookie(res, pending.sid);
    res.redirect(pending.returnTo);
  } catch (err) {
    console.error("OAuth callback failed:", err);
    res.status(err.status || 500).json({ error: err.message, details: err.details || null });
  }
});

app.post("/auth/logout", (req, res) => {
  const sid = getOrCreateSid(req, res);
  oauthSessions.delete(sid);
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

app.get("/debug/assistant-sources", async (req, res) => {
  try {
    const assistantId = process.env.QLIK_ASSISTANT_ID;
    if (!assistantId) {
      return res.status(400).json({ error: "QLIK_ASSISTANT_ID is required" });
    }

    const [assistantResp, contentsResp] = await Promise.all([
      qlikApiFetch(req, res, `/api/v1/assistants/${assistantId}`, { method: "GET", headers: { "Content-Type": undefined } }),
      qlikApiFetch(req, res, `/api/v1/assistants/${assistantId}/contents`, { method: "GET", headers: { "Content-Type": undefined } })
    ]);

    const assistantText = await assistantResp.text();
    const contentsText = await contentsResp.text();

    res.status(200).json({
      assistantStatus: assistantResp.status,
      contentsStatus: contentsResp.status,
      assistant: tryParseJson(assistantText) || assistantText,
      contents: tryParseJson(contentsText) || contentsText,
      checks: [
        "Verifica que exista un item tipo app en contents.",
        "Verifica que el usuario OAuth tenga acceso al app (espacio y Section Access).",
        "Si hay AA-002, normalmente es permisos o conectividad de la fuente del assistant."
      ]
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Failed to inspect assistant sources",
      details: error.details || null,
      code: error.code || null
    });
  }
});

app.post("/api/threads", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    const { token } = await resolveAccessToken(req, res);
    if (!token) {
      return res.status(401).json({
        error: "No token available",
        code: "auth_required",
        loginUrl: `${backendOrigin}/auth/login`
      });
    }

    const thread = await createThread({
      host: process.env.QLIK_HOST,
      assistantId: process.env.QLIK_ASSISTANT_ID,
      token,
      name
    });

    res.json(thread);
  } catch (error) {
    console.error("POST /api/threads failed:", error);
    res.status(error.status || 500).json({
      error: error.message || "Internal server error",
      details: error.details || null
    });
  }
});

// Debug helper: forward arbitrary payloads to Qlik using current auth context
app.post("/debug/forward", async (req, res) => {
  try {
    const { path: forwardPath, method = "POST", body } = req.body || {};
    if (!forwardPath) return res.status(400).json({ error: "path is required" });

    const response = await qlikApiFetch(req, res, forwardPath, {
      method,
      body: body == null ? undefined : (typeof body === "string" ? body : JSON.stringify(body))
    });

    const text = await response.text();
    res.status(response.status).json({
      status: response.status,
      data: tryParseJson(text) || text
    });
  } catch (err) {
    console.error("debug/forward error", err);
    res.status(err.status || 500).json({
      error: err.message,
      details: err.details || null,
      code: err.code || null,
      loginUrl: err.code === "auth_required" ? `${backendOrigin}/auth/login` : null
    });
  }
});

// Stream answers via Server-Sent Events (SSE)
app.get("/stream-answers", async (req, res) => {
  const question = String(req.query.question || "").trim();
  if (!question) {
    res.status(400).send("No question provided");
    return;
  }

  try {
    // Ensure sid cookie is prepared before SSE headers are sent.
    getOrCreateSid(req, res);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const cloudAssistantId = process.env.CLOUD_ASSISTANT_ID || String(req.query.cloudAssistantId || "").trim();
    if (!cloudAssistantId) {
      writeSseEvent(res, {
        kind: "error",
        error: "CLOUD_ASSISTANT_ID is required to mimic embed flow.",
      });
      writeSseEvent(res, { kind: "done" });
      res.end();
      return;
    }

    const auth = await resolveAccessToken(req, res);
    if (!auth.token) {
      writeSseEvent(res, {
        kind: "auth_required",
        error: "No token available",
        loginUrl: `${backendOrigin}/auth/login`
      });
      writeSseEvent(res, { kind: "done" });
      res.end();
      return;
    }

    const assistantId = process.env.QLIK_ASSISTANT_ID || null;
    const requestBody = {
      context: {
        type: "assistant",
        id: assistantId,
        data: { embedded: true, route: "assistants" }
      },
      content: [{ text: question }]
    };

    const streamResponse = await qlikApiFetch(req, res, `/api/v1/cloud-assistants/${cloudAssistantId}/actions/stream`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!streamResponse.ok) {
      const errorData = await streamResponse.text();
      writeSseEvent(res, {
        kind: "error",
        error: `Qlik stream failed (${streamResponse.status})`,
        details: tryParseJson(errorData) || errorData
      });
      writeSseEvent(res, { kind: "done" });
      res.end();
      return;
    }

    const seenTexts = new Set();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    for await (const chunk of streamResponse.body) {
      sseBuffer += decoder.decode(chunk, { stream: true });

      let boundary = sseBuffer.indexOf("\n\n");
      while (boundary >= 0) {
        const eventBlock = sseBuffer.slice(0, boundary);
        sseBuffer = sseBuffer.slice(boundary + 2);

        const dataLines = eventBlock
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());

        if (dataLines.length) {
          const rawData = dataLines.join("\n");
          const parsed = tryParseJson(rawData);
          const payload = parsed ? classifyCloudEvent(parsed) : { kind: "text", text: rawData };

          if (payload.kind === "text" && payload.text) {
            if (!seenTexts.has(payload.text)) {
              seenTexts.add(payload.text);
              writeSseEvent(res, payload);
            }
          } else {
            writeSseEvent(res, payload);
          }

          if (payload.kind === "error") {
            writeSseEvent(res, { kind: "done" });
            res.end();
            return;
          }
        }

        boundary = sseBuffer.indexOf("\n\n");
      }
    }

    writeSseEvent(res, { kind: "done" });
    res.end();
  } catch (error) {
    writeSseEvent(res, { kind: "error", error: error.message, details: error.details || null });
    writeSseEvent(res, { kind: "done" });
    res.end();
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});


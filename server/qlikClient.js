export async function createThread({ host, assistantId, token, name }) {
  if (!host) throw new Error("QLIK_HOST is required");
  if (!assistantId) throw new Error("QLIK_ASSISTANT_ID is required");
  if (!token) throw new Error("QLIK_TOKEN is required");

  const url = `${host.replace(/\/$/, "")}/api/v1/assistants/${assistantId}/threads`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name })
  });

  const raw = await response.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    const err = new Error(`Qlik createThread failed with ${response.status} ${response.statusText}`);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}


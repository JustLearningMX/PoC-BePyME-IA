// import { createQlikApi } from '@qlik/api'

document.addEventListener("DOMContentLoaded", () => {
    const chatBody = document.getElementById("chat-body");
    const chatInput = document.getElementById("chat-input");
    const sendButton = document.getElementById("send-btn");
    const backendBaseUrl = "http://localhost:3001";

    function appendInfoMessage(title, message, linkUrl) {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message", "assistant");

        const bubbleDiv = document.createElement("div");
        bubbleDiv.classList.add("bubble");

        const titleP = document.createElement("p");
        titleP.style.fontWeight = "600";
        titleP.textContent = title;
        bubbleDiv.appendChild(titleP);

        const msgP = document.createElement("p");
        msgP.textContent = message;
        bubbleDiv.appendChild(msgP);

        if (linkUrl) {
            const a = document.createElement("a");
            a.href = linkUrl;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = "Iniciar sesión OAuth";
            bubbleDiv.appendChild(a);
        }

        messageDiv.appendChild(bubbleDiv);
        chatBody.appendChild(messageDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    async function checkAuthStatus() {
        try {
            const response = await fetch(`${backendBaseUrl}/auth/status`, { credentials: "include" });
            const data = await response.json();

            if (!data.authenticated && data.authMode === "none") {
                appendInfoMessage(
                    "Autenticación requerida",
                    "Para consultar el assistant con la app de Qlik, inicia sesión OAuth o configura QLIK_TOKEN en backend.",
                    `${backendBaseUrl}/auth/login`
                );
            }
        } catch (err) {
            console.warn("No fue posible validar auth/status:", err);
        }
    }

    function appendUserMessage(message) {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message", "user");
        const bubbleDiv = document.createElement("div");
        bubbleDiv.classList.add("bubble");
        bubbleDiv.innerHTML = `<p>${message}</p>`;
        messageDiv.appendChild(bubbleDiv);
        chatBody.appendChild(messageDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function createAssistantBubble() {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message", "assistant");
        const bubbleDiv = document.createElement("div");
        bubbleDiv.classList.add("bubble");
        bubbleDiv.innerHTML = `
            <div class="assistant-status">
                <span class="spinner" aria-hidden="true"></span>
                <span class="assistant-status-text">Pensando...</span>
            </div>
            <div class="assistant-content"></div>
        `;
        messageDiv.appendChild(bubbleDiv);
        chatBody.appendChild(messageDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
        return {
            bubble: bubbleDiv,
            status: bubbleDiv.querySelector(".assistant-status"),
            content: bubbleDiv.querySelector(".assistant-content")
        };
    }

    function appendTextBlock(container, text) {
        const p = document.createElement("p");
        p.className = "assistant-text-block";
        p.textContent = text;
        container.appendChild(p);
    }

    function appendObjectBlock(container, label, obj) {
        const block = document.createElement("div");
        block.className = "assistant-object-block";
        if (label) {
            const h5 = document.createElement("h5");
            h5.textContent = label;
            block.appendChild(h5);
        }
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(obj, null, 2);
        block.appendChild(pre);
        container.appendChild(block);
    }

    function appendChartBlock(container, chartLike) {
        const block = document.createElement("div");
        block.className = "assistant-chart-block";

        const title = document.createElement("h5");
        title.textContent = chartLike?.title || chartLike?.name || "Chart";
        block.appendChild(title);

        if (chartLike?.imageUrl || chartLike?.src) {
            const img = document.createElement("img");
            img.className = "assistant-chart-image";
            img.alt = title.textContent;
            img.src = chartLike.imageUrl || chartLike.src;
            block.appendChild(img);
        } else if (chartLike?.iframeUrl) {
            const iframe = document.createElement("iframe");
            iframe.className = "assistant-chart-iframe";
            iframe.src = chartLike.iframeUrl;
            iframe.loading = "lazy";
            block.appendChild(iframe);
        } else {
            const pre = document.createElement("pre");
            pre.textContent = JSON.stringify(chartLike, null, 2);
            block.appendChild(pre);
        }

        container.appendChild(block);
    }

    function appendSourcesBlock(container, sources) {
        if (!sources || !sources.length) return;

        const block = document.createElement("div");
        block.className = "assistant-object-block";

        const h5 = document.createElement("h5");
        h5.textContent = "Sources";
        block.appendChild(h5);

        const ul = document.createElement("ul");
        ul.style.margin = "0";
        ul.style.paddingLeft = "18px";

        for (const source of sources) {
            const li = document.createElement("li");
            li.textContent = typeof source === "string" ? source : JSON.stringify(source);
            ul.appendChild(li);
        }

        block.appendChild(ul);
        container.appendChild(block);
    }

    function renderAssistantPayload(ui, payload) {
        if (!payload) return;

        if (typeof payload === "string") {
            appendTextBlock(ui.content, payload);
            return;
        }

        if (payload.kind === "done") {
            ui.status?.remove();
            return;
        }

        if (payload.kind === "auth_required") {
            ui.status?.remove();
            appendInfoMessage(
                "Sesión requerida",
                payload.error || "Debes autenticarte para consultar el assistant.",
                payload.loginUrl || `${backendBaseUrl}/auth/login`
            );
            return;
        }

        if (payload.kind === "error") {
            ui.status?.remove();
            appendObjectBlock(ui.content, "Error", {
                error: payload.error,
                code: payload.code || null,
                details: payload.details || null
            });
            return;
        }

        if (ui.status && ui.status.isConnected) {
            ui.status.remove();
        }

        if (payload.kind === "text" && payload.text) {
            appendTextBlock(ui.content, payload.text);
            if (payload.charts) {
                const charts = Array.isArray(payload.charts) ? payload.charts : [payload.charts];
                charts.forEach((chart) => appendChartBlock(ui.content, chart));
            }
            if (payload.sources) {
                appendSourcesBlock(ui.content, Array.isArray(payload.sources) ? payload.sources : [payload.sources]);
            }
            return;
        }

        if (payload.kind === "chart" || payload.charts || payload.type === "chart") {
            const charts = payload.chart || payload.charts || payload;
            (Array.isArray(charts) ? charts : [charts]).forEach((chart) => appendChartBlock(ui.content, chart));
            if (payload.sources) {
                appendSourcesBlock(ui.content, Array.isArray(payload.sources) ? payload.sources : [payload.sources]);
            }
            return;
        }

        if (payload.sources || payload.object || payload.items || payload.type || payload.imageUrl || payload.src) {
            appendObjectBlock(ui.content, payload.title || payload.type || "Objeto", payload);
            return;
        }

        appendObjectBlock(ui.content, "Respuesta", payload);
    }

    async function sendQuestion() {
        const question = chatInput.value.trim();
        if (!question) return;

        appendUserMessage(question);
        chatInput.value = "";

        const assistantUI = createAssistantBubble();

        const evtSource = new EventSource(
            `${backendBaseUrl}/stream-answers?question=${encodeURIComponent(question)}`,
            { withCredentials: true }
        );

        evtSource.onmessage = (event) => {
            if (!event.data) return;

            let payload = event.data;
            try {
                payload = JSON.parse(event.data);
            } catch {
                payload = { kind: "text", text: event.data };
            }

            renderAssistantPayload(assistantUI, payload);
            chatBody.scrollTop = chatBody.scrollHeight;

            if (payload?.kind === "done") {
                evtSource.close();
            }
        };

        evtSource.onerror = (err) => {
            console.error("EventSource error:", err);
            renderAssistantPayload(assistantUI, { kind: "error", error: "Error receiving stream" });
            try { evtSource.close(); } catch (_e) {}
        };
    }

    checkAuthStatus();
    sendButton.addEventListener("click", sendQuestion);
    chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendQuestion();
        }
    });
});
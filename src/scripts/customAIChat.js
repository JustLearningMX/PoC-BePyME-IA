// import { createQlikApi } from '@qlik/api'

document.addEventListener("DOMContentLoaded", () => {
    const chatBody = document.getElementById("chat-body");
    const chatInput = document.getElementById("chat-input");
    const sendButton = document.getElementById("send-btn");
    const backendBaseUrl = "http://localhost:3001";
    const qlikConfigPromise = fetch(`${backendBaseUrl}/debug/env`, { credentials: "include" })
        .then((response) => response.ok ? response.json() : {})
        .catch(() => ({}));

    async function getQlikAppId() {
        const cfg = await qlikConfigPromise;
        return cfg.QLIK_APP_ID || null;
    }

    async function getQlikAssistantId() {
        const cfg = await qlikConfigPromise;
        return cfg.QLIK_ASSISTANT_ID || null;
    }

    async function createClassicChartEmbed(objectId) {
        const appId = await getQlikAppId();
        if (!appId || !objectId) return null;

        const embed = document.createElement('qlik-embed');
        embed.setAttribute('ui', 'classic/chart');
        embed.setAttribute('app-id', appId);
        embed.setAttribute('object-id', objectId);
        embed.setAttribute('language', 'es');
        return embed;
    }

    function createFinalCard(content, objectId = "ZxDKp", hasChart = false) {
        console.log("createFinalCard called with objectId:", objectId, "hasChart:", hasChart);

        // Extract the main text (remove any HTML tags)
        const plainText = content.replace(/<[^>]*>/g, '').trim();
        console.log("Plain text (first 100 chars):", plainText.slice(0, 100));

        const cardDiv = document.createElement('div');
        cardDiv.className = 'message assistant';
        
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'bubble';
        
        const cardContent = document.createElement('div');
        cardContent.className = 'assistant-final-card';
        
        // Title with checkmark
        const title = document.createElement('div');
        title.className = 'assistant-final-card-title';
        title.textContent = hasChart ? 'Conclusión con Análisis' : 'Resultado Final';
        cardContent.appendChild(title);
        
        // Content text (preserve markdown formatting)
        const textDiv = document.createElement('div');
        textDiv.className = 'assistant-final-card-content';
        // Convert **text** to <strong>text</strong>
        textDiv.innerHTML = plainText
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        cardContent.appendChild(textDiv);
        
        // Only add Qlik embed if there's a chart
        if (hasChart) {
            const embedDiv = document.createElement('div');
            embedDiv.className = 'assistant-final-card-embed';

            // Create Qlik embed dynamically
            getQlikAssistantId().then((assistantId) => {
                console.log("getQlikAssistantId returned:", assistantId);

                if (!assistantId) {
                    console.error("No assistant ID");
                    const errorMsg = document.createElement('div');
                    errorMsg.style.cssText = 'color: #d32f2f; padding: 12px; font-size: 12px;';
                    errorMsg.textContent = 'No se pudo cargar el gráfico (ID del asistente no configurado)';
                    embedDiv.appendChild(errorMsg);
                    return;
                }

                console.log("Creating qlik-embed with app-id:", assistantId, "object-id:", objectId);

                const qlikEmbed = document.createElement('qlik-embed');
                qlikEmbed.setAttribute('ui', 'analytics/snapshot');
                qlikEmbed.setAttribute('app-id', assistantId);
                qlikEmbed.setAttribute('object-id', objectId);
                qlikEmbed.setAttribute('disable-cell-padding', 'true');

                // Force rendering with explicit style
                qlikEmbed.style.width = '100%';
                qlikEmbed.style.minHeight = '300px';
                qlikEmbed.style.display = 'block';

                // Add error handler
                qlikEmbed.addEventListener('error', (e) => {
                    console.error('Qlik embed error:', e);
                    embedDiv.innerHTML = '<div style="color: #d32f2f; padding: 12px; font-size: 12px;">Error al cargar el gráfico. Verifica que el object-id existe.</div>';
                });

                embedDiv.appendChild(qlikEmbed);
                console.log("qlik-embed appended to embedDiv");
            }).catch(err => {
                console.error('Error getting assistant ID:', err);
                const errorMsg = document.createElement('div');
                errorMsg.style.cssText = 'color: #d32f2f; padding: 12px; font-size: 12px;';
                errorMsg.textContent = 'Error al obtener ID del asistente';
                embedDiv.appendChild(errorMsg);
            });

            cardContent.appendChild(embedDiv);
        }

        bubbleDiv.appendChild(cardContent);
        cardDiv.appendChild(bubbleDiv);
        
        console.log("Final card DOM structure created");
        return cardDiv;
    }

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
                <div class="fancy-spinner">
                    <div class="dot"></div>
                    <div class="dot"></div>
                    <div class="dot"></div>
                </div>
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

    // Stateful processor that accumulates text fragments and joins content inside tag pairs
    function processTextChunk(ui, chunk, mainUi = null) {
        // mainUi is used when processing panel content so we can store final tags in the main bubble
        const storageUi = mainUi || ui;

        ui._textBuffer = ui._textBuffer || "";
        ui._textBuffer += chunk;
        storageUi._finalTags = storageUi._finalTags || [];  // Store all <final> tags in main UI

        const pairRegex = /<([a-zA-Z0-9_-]+)[^>]*>([\s\S]*?)<\/\1>/g;
        let match;
        let found = false;
        while ((match = pairRegex.exec(ui._textBuffer)) !== null) {
            found = true;
            const full = match[0];
            const tag = match[1];
            let inner = match[2] || "";

            // if this is a final tag, store it in main UI and show visual block
            if (tag.toLowerCase() === 'final') {
                storageUi._finalTags.push({ content: inner, timestamp: Date.now() });
                console.log("Stored final tag. Total final tags:", storageUi._finalTags.length);

                // Still render visual block for the <final> tag so user can see something is happening
                const block = document.createElement('div');
                block.className = 'assistant-final-block';

                const open = document.createElement('span');
                open.className = 'assistant-tag-marker';
                open.textContent = `<${tag}>`;
                block.appendChild(open);

                const p = document.createElement('p');
                p.className = 'assistant-text-block';
                // Show full content, don't truncate
                const cleanContent = inner.replace(/<[^>]*>/g, '').trim();
                p.textContent = ' ' + cleanContent + ' ';
                block.appendChild(p);

                const close = document.createElement('span');
                close.className = 'assistant-tag-marker';
                close.textContent = `</${tag}>`;
                block.appendChild(close);

                ui.content.appendChild(block);

                // Mark agent as done
                try {
                    const agent = ui._currentAgent;
                    if (agent && ui._agentPanels && ui._agentPanels[agent]) {
                        const panel = ui._agentPanels[agent];
                        if (panel.spinner) panel.spinner.style.display = 'none';
                        if (panel.check) panel.check.style.display = 'inline-block';
                        if (panel.wrap) panel.wrap.classList.add('assistant-agent-done');
                    }
                } catch (e) {}
                ui._currentAgent = null;

                // Remove processed part and reset regex
                ui._textBuffer = ui._textBuffer.replace(full, '');
                pairRegex.lastIndex = 0;
                continue;
            }

            // Extract <cite> blocks and replace with placeholders so collapsing whitespace won't break them
            const cites = [];
            inner = inner.replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, (m) => {
                const i = cites.length;
                cites.push(m);
                return `__CITE_${i}__`;
            });

            // Collapse whitespace
            let collapsed = inner.replace(/\s+/g, ' ').trim();

            // Restore cites
            for (let i = 0; i < cites.length; i++) {
                collapsed = collapsed.replace(`__CITE_${i}__`, cites[i]);
            }

            // Escape HTML, but allow <cite> tags
            const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            let safe = escapeHtml(collapsed);
            // unescape allowed <cite> and </cite>
            safe = safe.replace(/&lt;(\/)?cite([^&]*)&gt;/gi, (m, p1, p2) => `<${p1 || ''}cite${p2 || ''}>`);

            const block = document.createElement('div');
            block.className = 'assistant-tag-block';

            const open = document.createElement('span');
            open.className = 'assistant-tag-marker';
            open.textContent = `<${tag}>`;
            block.appendChild(open);

            const p = document.createElement('p');
            p.className = 'assistant-text-block';
            p.innerHTML = ' ' + safe + ' ';
            block.appendChild(p);

            const close = document.createElement('span');
            close.className = 'assistant-tag-marker';
            close.textContent = `</${tag}>`;
            block.appendChild(close);

            ui.content.appendChild(block);

            // Remove processed part and reset regex
            ui._textBuffer = ui._textBuffer.replace(full, '');
            pairRegex.lastIndex = 0;
        }

        // If no tag pairs found and buffer has no tag start or is too long, flush as plain text
        if (!found) {
            if (!ui._textBuffer.includes('<') || ui._textBuffer.length > 2000) {
                const flush = ui._textBuffer.replace(/\s+/g, ' ').trim();
                if (flush) appendTextBlock(ui.content, flush);
                ui._textBuffer = '';
            }
        }
    }

    // Process final tags when stream is done:
    // - Use the one with ** (formatted) for text content
    // - Use the one with <chart> for the chart
    function renderFinalTag(ui) {
        console.log("renderFinalTag called. _finalTags:", ui._finalTags?.length || 0);

        if (!ui._finalTags || ui._finalTags.length === 0) {
            console.log("No final tags to process");
            return;
        }

        // Find the last tag with <chart> for chart rendering
        let chartContent = null;
        let chartIndex = -1;
        for (let i = ui._finalTags.length - 1; i >= 0; i--) {
            if (ui._finalTags[i].content.includes('<chart')) {
                chartContent = ui._finalTags[i].content;
                chartIndex = i;
                console.log("Found final tag with <chart> at index:", i);
                break;
            }
        }

        // Find the last tag with ** (formatted text) for text content
        let textContent = null;
        let textIndex = -1;
        for (let i = ui._finalTags.length - 1; i >= 0; i--) {
            if (ui._finalTags[i].content.includes('**')) {
                textContent = ui._finalTags[i].content;
                textIndex = i;
                console.log("Found final tag with ** at index:", i);
                break;
            }
        }

        // If no formatted text found, use the one with chart
        if (!textContent && chartContent) {
            textContent = chartContent;
            textIndex = chartIndex;
            console.log("Using chart tag also for text (no ** found)");
        }

        // If still nothing, use the last one
        if (!textContent) {
            textContent = ui._finalTags[ui._finalTags.length - 1]?.content || "";
            textIndex = ui._finalTags.length - 1;
            console.log("Using last final tag for text");
        }

        if (!textContent?.trim()) {
            console.log("Text content is empty");
            return;
        }

        // Extract object ID for chart (from chartContent if available)
        let objectId = 'ZxDKp'; // default
        if (chartContent) {
            const chartMatch = chartContent.match(/<chart[^>]*id=["']([^"']+)["']/i);
            if (chartMatch) {
                objectId = chartMatch[1];
                console.log("Extracted object-id from chart id attribute:", objectId);
            }
        }

        try {
            // Extract plain text and format
            const plainText = textContent
                .replace(/<[^>]*>/g, '')  // Remove all tags
                .replace(/\[[^\]]*\]/g, '')  // Remove [citation] markers
                .trim();

            console.log("Plain text (first 200 chars):", plainText.slice(0, 200));

            if (plainText) {
                const finalCard = createFinalCard(plainText, objectId, chartContent !== null);
                chatBody.appendChild(finalCard);
                chatBody.scrollTop = chatBody.scrollHeight;
                console.log("Final card rendered successfully");
            } else {
                console.log("Plain text is empty after processing");
            }
        } catch (e) {
            console.warn("Error rendering final tag:", e);
        }
    }

    // Client-side version of extractTextCandidates (recursively finds plausible text fields)
    function extractTextCandidates(value, out = []) {
        if (value == null) return out;
        if (typeof value === 'string') {
            const t = value.trim(); if (t) out.push(t); return out;
        }
        if (Array.isArray(value)) { for (const it of value) extractTextCandidates(it, out); return out; }
        if (typeof value === 'object') {
            const preferredKeys = ['text','markdown','output','title','subtitle','message','value'];
            for (const k of preferredKeys) if (k in value) extractTextCandidates(value[k], out);
            for (const v of Object.values(value)) if (typeof v === 'object') extractTextCandidates(v, out);
        }
        return out;
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
        const mediaWrap = document.createElement("div");
        mediaWrap.className = "assistant-chart-media";

        if (chartLike?.imageUrl || chartLike?.src) {
            const img = document.createElement("img");
            img.className = "assistant-chart-image";
            img.alt = title.textContent;
            img.src = chartLike.imageUrl || chartLike.src;
            mediaWrap.appendChild(img);
            // allow clicking to open a larger preview
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', () => openImageModal(img.src, title.textContent));
        } else if (chartLike?.iframeUrl) {
            const iframeWrap = document.createElement("div");
            iframeWrap.className = "assistant-chart-iframe-wrap";
            const iframe = document.createElement("iframe");
            iframe.className = "assistant-chart-iframe";
            iframe.src = chartLike.iframeUrl;
            iframe.loading = "lazy";
            iframeWrap.appendChild(iframe);
            mediaWrap.appendChild(iframeWrap);
        } else if (chartLike?.title || chartLike?.name) {
            const note = document.createElement("p");
            note.textContent = chartLike.title || chartLike.name;
            mediaWrap.appendChild(note);
        }

        block.appendChild(mediaWrap);

        container.appendChild(block);
    }

    // --- Image modal (one instance) ---
    const imageModal = document.createElement('div');
    imageModal.className = 'assistant-image-modal';
    imageModal.innerHTML = `
        <div class="assistant-image-modal-backdrop"></div>
        <div class="assistant-image-modal-content">
            <button class="assistant-image-modal-close" aria-label="Cerrar">×</button>
            <img class="assistant-image-modal-img" alt="preview" />
            <div class="assistant-image-modal-caption"></div>
        </div>
    `;
    document.body.appendChild(imageModal);

    const modalBackdrop = imageModal.querySelector('.assistant-image-modal-backdrop');
    const modalClose = imageModal.querySelector('.assistant-image-modal-close');
    const modalImg = imageModal.querySelector('.assistant-image-modal-img');
    const modalCaption = imageModal.querySelector('.assistant-image-modal-caption');

    function openImageModal(src, caption) {
        modalImg.src = src;
        modalCaption.textContent = caption || '';
        imageModal.classList.add('open');
    }

    function closeImageModal() {
        imageModal.classList.remove('open');
        modalImg.src = '';
    }

    modalBackdrop.addEventListener('click', closeImageModal);
    modalClose.addEventListener('click', closeImageModal);

    // --- Sources modal (one instance) ---
    const sourcesModal = document.createElement('div');
    sourcesModal.className = 'assistant-sources-modal';
    sourcesModal.innerHTML = `
        <div class="assistant-sources-backdrop"></div>
        <div class="assistant-sources-content">
            <button class="assistant-sources-close" aria-label="Cerrar">×</button>
            <h3>Sources</h3>
            <div class="assistant-sources-body"><em>Loading...</em></div>
        </div>
    `;
    document.body.appendChild(sourcesModal);
    const sourcesBackdrop = sourcesModal.querySelector('.assistant-sources-backdrop');
    const sourcesClose = sourcesModal.querySelector('.assistant-sources-close');
    const sourcesBody = sourcesModal.querySelector('.assistant-sources-body');

    function openSourcesModal() {
        sourcesBody.innerHTML = '<em>Loading...</em>';
        sourcesModal.classList.add('open');
        fetch(`${backendBaseUrl}/debug/assistant-sources`).then(r => r.json()).then(data => {
            sourcesBody.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
        }).catch(err => {
            sourcesBody.innerHTML = `<div class="error">${String(err)}</div>`;
        });
    }
    function closeSourcesModal(){ sourcesModal.classList.remove('open'); }
    sourcesBackdrop.addEventListener('click', closeSourcesModal);
    sourcesClose.addEventListener('click', closeSourcesModal);

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

    function markAgentDone(uiContext, agentName) {
        if (!uiContext || !agentName || !uiContext._agentPanels || !uiContext._agentPanels[agentName]) return;
        const panel = uiContext._agentPanels[agentName];
        try {
            if (panel.spinner) panel.spinner.style.display = 'none';
            if (panel.wrap) panel.wrap.classList.add('assistant-agent-done');
        } catch (e) {}
    }

    function cleanReasoning(text) {
        if (!text) return "";
        return text
            .replace(/<plan>|<\/plan>|<final>|<\/final>|<chart[^>]*>|<\/chart>|<statement>|<\/statement>|<cite>|<\/cite>/g, "")
            .replace(/\\u003c[^\\u003e]*\\u003e/g, "")
            .trim();
    }

    function extractKPI(card) {
        const snapshot = card?.body?.find(b => b.snapshot);
        if (!snapshot) return null;
        const matrix = snapshot.snapshot?.data?.qHyperCube?.qDataPages?.[0]?.qMatrix;
        const val = matrix?.[0]?.[0];
        return {
            value: val?.qNum,
            text: val?.qText,
            title: snapshot.snapshot?.title || "",
            expression: snapshot.snapshot?.object_properties?.qHyperCubeDef?.qMeasures?.[0]?.qDef?.qDef || "",
            objectId: snapshot.snapshot?.id || null
        };
    }

    function processEvent(event) {
        if (!event) return null;
        
        // Evento final completo
        if (event.method === "message") {
            const p = event.params || {};
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

        const p = event.params;
        if (!p) return null;

        // 1. Nuevo agente (a través de steps de un stepper o directo)
        const firstAgent = p.value?.content?.[0]?.card?.body?.[0]?.steps?.[0];
        if (p.op === "add" && firstAgent && firstAgent.displayName) {
            return {
                type: "NEW_AGENT",
                name: firstAgent.displayName,
                title: firstAgent.title || firstAgent.displayName
            };
        }

        if (p.op === "add" && p.value && p.value.displayName) {
            return {
                type: "NEW_AGENT",
                name: p.value.displayName,
                title: p.value.title || p.value.displayName
            };
        }

        // 2. Cambio de step del agente
        if (p.value?.isSubtle === true && p.value?.text) {
            return {
                type: "AGENT_STEP",
                step: p.value.text
            };
        }

        // 3. Razonamiento chunk
        if (p.path && (p.path.includes("toggleContent") || p.path.includes("text")) && typeof p.value === "string") {
            return {
                type: "REASONING_CHUNK",
                text: p.value
            };
        }

        return null;
    }

    function createAgentPanel(ui, agentName) {
        ui._agentPanels = ui._agentPanels || {};
        if (ui._agentPanels[agentName]) return ui._agentPanels[agentName];

        const panelWrap = document.createElement('div');
        panelWrap.className = 'assistant-agent-panel';

        const dot = document.createElement('div');
        dot.className = 'agent-dot';

        const header = document.createElement('div');
        header.className = 'assistant-agent-header';
        
        const title = document.createElement('strong');
        title.className = 'agent-name';
        title.textContent = agentName;

        const statusWrap = document.createElement('div');
        statusWrap.className = 'assistant-agent-status';

        const spinner = document.createElement('span');
        spinner.className = 'assistant-agent-spinner spinner';
        spinner.style.display = 'inline-block';
        spinner.style.width = '14px';
        spinner.style.height = '14px';
        spinner.style.marginLeft = '6px';
        spinner.style.borderTopColor = '#007aff';

        const check = document.createElement('span');
        check.style.display = 'none';

        statusWrap.appendChild(spinner);

        const toggle = document.createElement('button');
        toggle.className = 'assistant-agent-toggle';
        toggle.innerHTML = 'Show reasoning ▾';

        header.appendChild(title);
        header.appendChild(statusWrap);
        header.appendChild(toggle);

        const content = document.createElement('div');
        content.className = 'assistant-agent-content';
        content.style.display = 'none';

        toggle.addEventListener('click', () => {
            const open = content.style.display === 'block';
            content.style.display = open ? 'none' : 'block';
            toggle.innerHTML = open ? 'Show reasoning ▾' : 'Hide reasoning ▴';
        });

        panelWrap.appendChild(dot);
        panelWrap.appendChild(header);
        panelWrap.appendChild(content);
        ui.content.appendChild(panelWrap);

        ui._agentPanels[agentName] = { wrap: panelWrap, header, content, spinner, check, toggle };
        return ui._agentPanels[agentName];
    }

    async function sendQuestion() {
        const question = chatInput.value.trim();
        if (!question) return;

        appendUserMessage(question);
        chatInput.value = "";

        const assistantUI = createAssistantBubble();

        try {
            // Paso 1: Crear el thread
            const threadResponse = await fetch(`${backendBaseUrl}/api/threads`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question })
            });

            if (!threadResponse.ok) {
                const errData = await threadResponse.json().catch(() => ({}));
                console.error("Error creating thread:", errData);
                if (assistantUI.status) assistantUI.status.remove();
                appendTextBlock(assistantUI.content, errData.error || "Error al crear el thread de conversación.");
                return;
            }

            const threadData = await threadResponse.json();
            const threadId = threadData.id || (threadData.data && threadData.data.id);

            if (!threadId) {
                if (assistantUI.status) assistantUI.status.remove();
                appendTextBlock(assistantUI.content, "La API no devolvió un ID de thread válido.");
                return;
            }

            // Paso 2: Conectar al stream usando el threadId (Usando el endpoint estándar `/api/stream`)
            const evtSource = new EventSource(
                `${backendBaseUrl}/api/stream?question=${encodeURIComponent(question)}&threadId=${encodeURIComponent(threadId)}`,
                { withCredentials: true }
            );

            const state = {
                activeAgentPanel: null,
                agentsList: []
            };

            evtSource.onmessage = (event) => {
                if (!event.data) return;

                let parsedEvent;
                try {
                    parsedEvent = JSON.parse(event.data);
                } catch (e) {
                    console.warn("Error parseando SSE:", e, event.data);
                    return;
                }

                // Capturar errores del proxy o Qlik
                if (parsedEvent.kind === "error" || parsedEvent.error) {
                    if (assistantUI.status) assistantUI.status.remove();
                    appendTextBlock(assistantUI.content, `Error: ${parsedEvent.error || "El stream de Qlik falló."}`);
                    evtSource.close();
                    return;
                }

                const action = processEvent(parsedEvent);
                if (!action) return;

                console.log("Acción del stream procesada:", action);

                switch (action.type) {
                    case "NEW_AGENT": {
                        // Ocultar spinner fancy inicial
                        if (assistantUI.status && assistantUI.status.isConnected) {
                            assistantUI.status.remove();
                        }

                        // Si había un agente activo, marcarlo como finalizado
                        if (state.activeAgentPanel) {
                            state.activeAgentPanel.wrap.classList.add("assistant-agent-done");
                            state.activeAgentPanel.spinner.style.display = "none";
                        }

                        // Crear y agregar nuevo agente
                        const panel = createAgentPanel(assistantUI, action.name);
                        state.activeAgentPanel = panel;
                        state.agentsList.push(panel);
                        break;
                    }
                    case "AGENT_STEP": {
                        if (state.activeAgentPanel) {
                            let stepTextEl = state.activeAgentPanel.wrap.querySelector(".agent-step-text");
                            if (!stepTextEl) {
                                stepTextEl = document.createElement("div");
                                stepTextEl.className = "agent-step-text";
                                stepTextEl.style.fontSize = "13px";
                                stepTextEl.style.color = "#888";
                                stepTextEl.style.marginTop = "2px";
                                state.activeAgentPanel.header.appendChild(stepTextEl);
                            }
                            stepTextEl.textContent = action.step;
                        }
                        break;
                    }
                    case "REASONING_CHUNK": {
                        if (state.activeAgentPanel) {
                            state.activeAgentPanel.reasoningText = (state.activeAgentPanel.reasoningText || "") + action.text;
                            state.activeAgentPanel.content.innerHTML = cleanReasoning(state.activeAgentPanel.reasoningText).replace(/\n/g, "<br>");
                        }
                        break;
                    }
                    case "FINAL": {
                        // Marcar último agente activo como finalizado
                        if (state.activeAgentPanel) {
                            state.activeAgentPanel.wrap.classList.add("assistant-agent-done");
                            state.activeAgentPanel.spinner.style.display = "none";
                        }

                        // Quitar spinner fancy si sigue ahí
                        if (assistantUI.status && assistantUI.status.isConnected) {
                            assistantUI.status.remove();
                        }

                        // Renderizar conclusión final
                        if (action.conclusion?.text) {
                            const hasChart = !!action.kpi;
                            const objectId = action.kpi?.objectId || "ZxDKp";
                            const finalCard = createFinalCard(action.conclusion.text, objectId, hasChart);
                            
                            if (action.kpi) {
                                console.log("Inyectando KPI a conclusión:", action.kpi);
                                const kpiVal = action.kpi.text || String(action.kpi.value);
                                const kpiTitle = action.kpi.title || "Indicador";
                                const kpiHtml = `
                                    <div class="kpi-display-container" style="text-align: center; margin: 15px 0; padding: 10px; border: 1px solid rgba(76, 175, 80, 0.2); border-radius: 8px; background: #fff;">
                                        <div style="font-size: 13px; color: #718096; text-transform: uppercase; font-weight: bold;">${kpiTitle}</div>
                                        <div style="font-size: 2.2rem; font-weight: 800; color: #4caf50; margin: 5px 0;">${kpiVal}</div>
                                    </div>
                                `;
                                const contentEl = finalCard.querySelector(".assistant-final-card-content");
                                if (contentEl) {
                                    contentEl.innerHTML = kpiHtml + contentEl.innerHTML;
                                }
                            }

                            assistantUI.content.appendChild(finalCard);
                        } else if (action.summary) {
                            // Si no hay conclusión formal pero hay summary
                            const finalCard = createFinalCard(action.summary, "ZxDKp", false);
                            assistantUI.content.appendChild(finalCard);
                        }

                        // Renderizar preguntas sugeridas (Follow-Ups)
                        if (action.followUps && action.followUps.length) {
                            const followUpsContainer = document.createElement("div");
                            followUpsContainer.className = "assistant-followups-container";
                            followUpsContainer.style.marginTop = "12px";
                            followUpsContainer.style.display = "flex";
                            followUpsContainer.style.flexDirection = "column";
                            followUpsContainer.style.gap = "6px";

                            action.followUps.forEach(act => {
                                if (act.title || act.label) {
                                    const btn = document.createElement("button");
                                    btn.className = "suggested-question-btn";
                                    btn.style.cssText = "text-align: left; padding: 8px 12px; background: #f0f4f8; border: 1px solid #d2dbe5; border-radius: 8px; cursor: pointer; font-size: 13px; color: #2b6cb0; transition: background 0.2s;";
                                    btn.textContent = act.title || act.label;
                                    btn.addEventListener("mouseenter", () => btn.style.background = "#e2e8f0");
                                    btn.addEventListener("mouseleave", () => btn.style.background = "#f0f4f8");
                                    btn.addEventListener("click", () => {
                                        chatInput.value = btn.textContent;
                                        sendQuestion();
                                    });
                                    followUpsContainer.appendChild(btn);
                                }
                            });
                            assistantUI.content.appendChild(followUpsContainer);
                        }

                        evtSource.close();
                        break;
                    }
                }
                chatBody.scrollTop = chatBody.scrollHeight;
            };

            evtSource.onerror = (err) => {
                console.error("EventSource error:", err);
                if (assistantUI.status) assistantUI.status.remove();
                appendTextBlock(assistantUI.content, "Error recibiendo el stream de Qlik.");
                try { evtSource.close(); } catch (_e) {}
            };
        } catch (error) {
            console.error("Error en sendQuestion:", error);
            if (assistantUI.status) assistantUI.status.remove();
            appendTextBlock(assistantUI.content, "Error de conexión con el backend.");
        }
    }

    sendButton.addEventListener("click", sendQuestion);
    chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendQuestion();
        }
    });

    // Debug helper: accessible from browser console
    window.debugQlikEmbed = {
        testEmbed: async function(objectId = "ZxDKp") {
            const appId = await getQlikAppId();
            const assistantId = await getQlikAssistantId();
            console.log("=== Qlik Embed Debug ===");
            console.log("App ID:", appId);
            console.log("Assistant ID:", assistantId);
            console.log("Object ID:", objectId);
            
            if (!assistantId) {
                console.error("No assistant ID configured");
                return;
            }
            
            const testDiv = document.createElement('div');
            testDiv.style.cssText = 'position: fixed; bottom: 20px; right: 20px; width: 400px; height: 300px; background: white; border: 2px solid red; z-index: 9999; padding: 10px;';
            
            const label = document.createElement('div');
            label.textContent = `Test Embed (assistant: ${assistantId.slice(0, 8)}..., object: ${objectId})`;
            label.style.cssText = 'font-weight: bold; margin-bottom: 10px; font-size: 12px;';
            testDiv.appendChild(label);
            
            const embed = document.createElement('qlik-embed');
            embed.setAttribute('ui', 'analytics/snapshot');
            embed.setAttribute('app-id', assistantId);
            embed.setAttribute('object-id', objectId);
            embed.style.cssText = 'width: 100%; height: 100%;';
            
            embed.addEventListener('load', () => console.log('Embed loaded successfully'));
            embed.addEventListener('error', (e) => console.error('Embed error:', e));
            
            testDiv.appendChild(embed);
            document.body.appendChild(testDiv);
            
            console.log("Test embed created. Should appear in bottom-right corner.");
            console.log("Close it with: document.body.removeChild(document.body.lastChild)");
        }
    };
});
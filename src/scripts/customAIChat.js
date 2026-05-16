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

    // Stateful processor that accumulates text fragments and joins content inside tag pairs
    function processTextChunk(ui, chunk) {
        ui._textBuffer = ui._textBuffer || "";
        ui._textBuffer += chunk;

        const pairRegex = /<([a-zA-Z0-9_-]+)[^>]*>([\s\S]*?)<\/\1>/g;
        let match;
        let found = false;
        while ((match = pairRegex.exec(ui._textBuffer)) !== null) {
            found = true;
            const full = match[0];
            const tag = match[1];
            let inner = match[2] || "";

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
            // final tag gets special highlight
            block.className = tag.toLowerCase() === 'final' ? 'assistant-final-block' : 'assistant-tag-block';

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

            // if this was a final tag, mark current agent as done and clear routing so final shows normally
            if (tag.toLowerCase() === 'final') {
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
            }
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
        } else {
            const pre = document.createElement("pre");
            pre.textContent = JSON.stringify(chartLike, null, 2);
            mediaWrap.appendChild(pre);
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

    function renderAssistantPayload(ui, payload) {
        if (!payload) return;

        if (typeof payload === "string") {
            processTextChunk(ui, payload);
            return;
        }

        if (payload.kind === "done") {
            ui.status?.remove();
            // mark any agent panels as finished (hide spinner, show check)
            if (ui._agentPanels) {
                Object.keys(ui._agentPanels).forEach((name) => {
                    try {
                        const p = ui._agentPanels[name];
                        if (p.spinner) p.spinner.style.display = 'none';
                        if (p.check) p.check.style.display = 'inline-block';
                        if (p.wrap) p.wrap.classList.add('assistant-agent-done');
                    } catch (e) {}
                });
            }

            // Build a consolidated, fancy final block (image + per-agent content)
            try {
                const fancy = document.createElement('div');
                fancy.className = 'assistant-fancy-final';

                const left = document.createElement('div');
                left.className = 'assistant-fancy-left';
                const img = document.createElement('img');
                img.className = 'assistant-fancy-image';
                img.alt = 'Summary image';
                img.src = `${backendBaseUrl}/referencias-Razonamiento-Embed/img_5.png`;
                img.addEventListener('click', () => openImageModal(img.src, 'Final summary'));
                left.appendChild(img);

                const right = document.createElement('div');
                right.className = 'assistant-fancy-right';

                const title = document.createElement('h4');
                title.textContent = 'Final consolidated answer';
                right.appendChild(title);

                if (ui._agentPanels) {
                    Object.keys(ui._agentPanels).forEach((name) => {
                        const sec = document.createElement('div');
                        sec.className = 'assistant-fancy-section';
                        const h5 = document.createElement('h5'); h5.textContent = name; sec.appendChild(h5);
                        const body = document.createElement('div');
                        body.className = 'assistant-fancy-section-body';
                        // clone node content to preserve events
                        body.innerHTML = ui._agentPanels[name].content.innerHTML || '';
                        sec.appendChild(body);
                        right.appendChild(sec);
                    });
                }

                fancy.appendChild(left);
                fancy.appendChild(right);
                ui.content.appendChild(fancy);
            } catch (e) {}

            ui._currentAgent = null;
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
            ui._currentAgent = null;
            appendObjectBlock(ui.content, "Error", {
                error: payload.error,
                code: payload.code || null,
                details: payload.details || null
            });
            return;
        }

        // Handle agent markers: create agent panels for 'Answers Agent' and 'Data Analyst Agent'
        function createAgentPanel(agentName) {
            ui._agentPanels = ui._agentPanels || {};
            if (ui._agentPanels[agentName]) return ui._agentPanels[agentName];

            const panelWrap = document.createElement('div');
            panelWrap.className = 'assistant-agent-panel';

            const header = document.createElement('div');
            header.className = 'assistant-agent-header';
            const title = document.createElement('strong');
            title.textContent = agentName;

            const statusWrap = document.createElement('div');
            statusWrap.className = 'assistant-agent-status';

            const spinner = document.createElement('span');
            spinner.className = 'assistant-agent-spinner';
            spinner.textContent = 'Pensando...';
            spinner.style.display = 'inline-block';

            const check = document.createElement('span');
            check.className = 'assistant-agent-check';
            check.style.display = 'none';
            check.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M7 13l3 3 7-7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

            statusWrap.appendChild(spinner);
            statusWrap.appendChild(check);

            const toggle = document.createElement('button');
            toggle.className = 'assistant-agent-toggle';
            toggle.textContent = 'Show';

            header.appendChild(title);
            header.appendChild(statusWrap);
            header.appendChild(toggle);

            const content = document.createElement('div');
            content.className = 'assistant-agent-content';
            content.style.display = 'none';

            toggle.addEventListener('click', () => {
                const open = content.style.display === 'block';
                content.style.display = open ? 'none' : 'block';
                toggle.textContent = open ? 'Mostrar' : 'Ocultar';
            });

            panelWrap.appendChild(header);
            panelWrap.appendChild(content);
            ui.content.appendChild(panelWrap);

            ui._agentPanels[agentName] = { wrap: panelWrap, header, content, spinner, check, toggle };
            return ui._agentPanels[agentName];
        }

        function markAgentDone(agentName) {
            if (!ui._agentPanels || !ui._agentPanels[agentName]) return;
            const panel = ui._agentPanels[agentName];
            try {
                panel.spinner.style.display = 'none';
                panel.check.style.display = 'inline-block';
                panel.wrap.classList.add('assistant-agent-done');
            } catch (e) {}
        }

        // route payloads to current open agent if set
        ui._currentAgent = ui._currentAgent || null;

        // Detect agent markers in text payloads
        if (payload.kind === 'text' && payload.text) {
            const txt = String(payload.text || '').trim();
            if (/Answers Agent\s*Answers Agent/i.test(txt)) {
                ui._currentAgent = 'Answers Agent';
                const panel = createAgentPanel('Answers Agent');
                // show spinner while agent is writing
                panel.spinner.style.display = 'inline-block';
                return;
            }
            if (/Data Analyst Agent\s*Data Analyst Agent/i.test(txt)) {
                ui._currentAgent = 'Data Analyst Agent';
                const panel = createAgentPanel('Data Analyst Agent');
                panel.spinner.style.display = 'inline-block';
                return;
            }
        }

        // When a final tag arrives, reset currentAgent so final shows normally
        if (payload.kind === 'raw' && payload.data && payload.data.params && payload.data.params.path && payload.data.params.path.includes('/content') && payload.data.params.path.includes('/text') ) {
            // heuristics — do nothing special here
        }

        // If currentAgent is set, route content to its panel unless payload is 'done' or 'error' or final
        if (ui._currentAgent && payload.kind !== 'done' && payload.kind !== 'error') {
            const panel = createAgentPanel(ui._currentAgent);
            // Prefer to feed text fragments through processTextChunk so tags (<plan>, <final>, etc.) are reassembled
            if (payload.kind === 'text' && payload.text) {
                // Use a lightweight UI-like object for the panel so processTextChunk stores buffer per-panel
                const panelUi = { content: panel.content, _textBuffer: panel._textBuffer || '' };
                processTextChunk(panelUi, payload.text);
                panel._textBuffer = panelUi._textBuffer || '';
                return;
            }

            if (payload.kind === 'raw' && payload.data) {
                // Try to extract textual candidates from raw chunk and feed into reassembler if found.
                const params = payload.data.params || payload.data;
                const texts = extractTextCandidates(params, []);
                if (texts.length) {
                    const joined = texts.join('\n');
                    const panelUi = { content: panel.content, _textBuffer: panel._textBuffer || '' };
                    processTextChunk(panelUi, joined);
                    panel._textBuffer = panelUi._textBuffer || '';
                    return;
                }
                // otherwise fallthrough: let the generic raw/adaptive-card handlers below process this payload
            }
        }

        // Handle raw adaptive card fragments or full card
        if (payload.kind === 'raw' && payload.data) {
            // Try to extract an Adaptive Card JSON
            try {
                const params = payload.data.params || payload.data;
                // Common locations where the embed places card JSON
                const maybeCard = (params.value && params.value.card) || (params.value && params.value.$schema ? params.value : null) || null;

                if (maybeCard) {
                    // store/merge last card per UI bubble
                    ui._adaptiveCard = ui._adaptiveCard || {};
                    ui._adaptiveCard.json = maybeCard;
                    renderAdaptiveCard(ui, maybeCard);
                    return;
                }
            } catch (e) {
                // fallback to showing raw
            }
        }

        if (ui.status && ui.status.isConnected) {
            ui.status.remove();
        }

        if (payload.kind === "text" && payload.text) {
            processTextChunk(ui, payload.text);
            if (payload.charts) {
                const charts = Array.isArray(payload.charts) ? payload.charts : [payload.charts];
                if (charts.length > 1) {
                    const gallery = document.createElement('div');
                    gallery.className = 'assistant-gallery';
                    charts.forEach((chart) => {
                        const thumb = document.createElement('img');
                        thumb.className = 'assistant-chart-image';
                        thumb.alt = chart?.title || 'chart';
                        thumb.src = chart?.imageUrl || chart?.src || '';
                        if (!thumb.src) {
                            // fallback to example images
                            fetch(`${backendBaseUrl}/debug/embed-images`).then(r => r.json()).then(data => {
                                if (data && Array.isArray(data.images) && data.images.length) thumb.src = data.images[0];
                            }).catch(()=>{});
                        }
                        thumb.addEventListener('click', () => openImageModal(thumb.src, chart?.title || 'Chart'));
                        gallery.appendChild(thumb);
                    });
                    ui.content.appendChild(gallery);
                } else {
                    charts.forEach((chart) => appendChartBlock(ui.content, chart));
                }
            }
            if (payload.sources) {
                appendSourcesBlock(ui.content, Array.isArray(payload.sources) ? payload.sources : [payload.sources]);
            }
            return;
        }

        if (payload.kind === "chart" || payload.charts || payload.type === "chart") {
            const charts = payload.chart || payload.charts || payload;
            const arr = Array.isArray(charts) ? charts : [charts];
            if (arr.length > 1) {
                const gallery = document.createElement('div');
                gallery.className = 'assistant-gallery';
                arr.forEach((chart) => {
                    const thumb = document.createElement('img');
                    thumb.className = 'assistant-chart-image';
                    thumb.alt = chart?.title || 'chart';
                    thumb.src = chart?.imageUrl || chart?.src || '';
                    if (!thumb.src) {
                        fetch(`${backendBaseUrl}/debug/embed-images`).then(r => r.json()).then(data => {
                            if (data && Array.isArray(data.images) && data.images.length) thumb.src = data.images[0];
                        }).catch(()=>{});
                    }
                    thumb.addEventListener('click', () => openImageModal(thumb.src, chart?.title || 'Chart'));
                    gallery.appendChild(thumb);
                });
                ui.content.appendChild(gallery);
            } else {
                (arr).forEach((chart) => appendChartBlock(ui.content, chart));
            }
            if (payload.sources) {
                appendSourcesBlock(ui.content, Array.isArray(payload.sources) ? payload.sources : [payload.sources]);
            }
            return;
        }

        if (payload.sources || payload.object || payload.items || payload.type || payload.imageUrl || payload.src) {
            appendObjectBlock(ui.content, payload.title || payload.type || "Objeto", payload);
            return;
        }

        //appendObjectBlock(ui.content, "Respuesta", payload);
    }

    // Render a simplified AdaptiveCard: show title + steps with accordion (reasoning)
    function renderAdaptiveCard(ui, cardJson) {
        try {
            const container = document.createElement('div');
            container.className = 'assistant-adaptive-card';

            // Title if present
            const title = (cardJson.body && Array.isArray(cardJson.body) && cardJson.body[0] && cardJson.body[0].steps && cardJson.body[0].steps[0] && cardJson.body[0].steps[0].displayName) || cardJson.title || 'Result';
            const h4 = document.createElement('h4');
            h4.textContent = title;
            h4.style.margin = '0 0 8px 0';
            container.appendChild(h4);

            // Steps (if stepper exists)
            const steps = [];
            if (cardJson.body && Array.isArray(cardJson.body)) {
                for (const b of cardJson.body) {
                    if (b.steps && Array.isArray(b.steps)) {
                        for (const s of b.steps) steps.push(s);
                    }
                }
            }

            if (steps.length) {
                const acc = document.createElement('div');
                acc.className = 'assistant-reasoning-accordion';

                steps.forEach((step, idx) => {
                    const item = document.createElement('div');
                    item.className = 'assistant-reasoning-item';

                    const header = document.createElement('button');
                    header.className = 'assistant-reasoning-header';
                    header.type = 'button';
                    header.textContent = step.displayName || `Step ${idx + 1}`;

                    const body = document.createElement('div');
                    body.className = 'assistant-reasoning-body';
                    body.style.display = idx === steps.length - 1 ? 'block' : 'none'; // show last by default

                    // render content if present
                    const content = step.content || step.toggleContent || step.fixedContent || {};
                    if (Array.isArray(content)) {
                        content.forEach(c => appendReasoningContent(body, c));
                    } else if (content && content.items) {
                        content.items.forEach(it => appendReasoningContent(body, it));
                    } else {
                        appendReasoningContent(body, content);
                    }

                    header.addEventListener('click', () => {
                        const open = body.style.display === 'block';
                        // close all
                        acc.querySelectorAll('.assistant-reasoning-body').forEach(el => el.style.display = 'none');
                        if (!open) body.style.display = 'block';
                    });

                    item.appendChild(header);
                    item.appendChild(body);
                    acc.appendChild(item);
                });

                container.appendChild(acc);
            }

            // If card contains charts or citations, show view sources link
            const hasCite = JSON.stringify(cardJson).includes('cite') || JSON.stringify(cardJson).includes('citation');
            if (hasCite) {
                const link = document.createElement('a');
                link.href = '#';
                link.className = 'assistant-view-sources';
                link.textContent = 'View sources';
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    // open sources in our modal
                    openSourcesModal();
                });
                container.appendChild(link);
            }

            // If card mentions a chart id, try to load example images from backend and show one
            try {
                const jsonText = JSON.stringify(cardJson);
                const chartIdMatch = jsonText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                if (chartIdMatch) {
                    fetch(`${backendBaseUrl}/debug/embed-images`).then(r => r.json()).then(data => {
                        if (data && Array.isArray(data.images) && data.images.length) {
                            // use first image as example chart preview
                            const img = document.createElement('img');
                            img.className = 'assistant-chart-image';
                            img.src = data.images[0];
                            img.alt = 'Chart preview';
                            img.style.cursor = 'zoom-in';
                            img.addEventListener('click', () => openImageModal(img.src, 'Chart'));
                            const media = document.createElement('div');
                            media.className = 'assistant-chart-media';
                            media.appendChild(img);
                            container.appendChild(media);
                        }
                    }).catch(() => {});
                }
            } catch (e) {}

            // If AdaptiveCards lib is available, use it for faithful rendering
            if (window.AdaptiveCards && typeof window.AdaptiveCards.AdaptiveCard === 'function') {
                try {
                    const adaptiveCard = new window.AdaptiveCards.AdaptiveCard();
                    adaptiveCard.hostConfig = new window.AdaptiveCards.HostConfig({});
                    adaptiveCard.parse(cardJson);
                    const rendered = adaptiveCard.render();
                    container.appendChild(rendered);
                } catch (e) {
                    // fallback to simplified view already built above
                }
            }

            // If there is a current agent, try to append into its panel (if exists)
            if (ui._currentAgent && ui._agentPanels && ui._agentPanels[ui._currentAgent]) {
                ui._agentPanels[ui._currentAgent].content.appendChild(container);
                // hide spinner
                ui._agentPanels[ui._currentAgent].spinner.style.display = 'none';
            } else {
                ui.content.appendChild(container);
            }
        } catch (err) {
            appendObjectBlock(ui.content, 'AdaptiveCard', cardJson);
        }
    }

    function appendReasoningContent(parent, node) {
        if (!node) return;
        if (typeof node === 'string') {
            const p = document.createElement('p'); p.textContent = node; parent.appendChild(p); return;
        }
        if (node.type === 'TextBlock' && node.text) {
            const p = document.createElement('p'); p.textContent = node.text; parent.appendChild(p); return;
        }
        if (node.items && Array.isArray(node.items)) {
            node.items.forEach(it => appendReasoningContent(parent, it));
            return;
        }
        // fallback: show JSON
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(node, null, 2); parent.appendChild(pre);
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
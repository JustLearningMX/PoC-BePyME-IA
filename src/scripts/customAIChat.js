// import { createQlikApi } from '@qlik/api'

document.addEventListener("DOMContentLoaded", () => {
    const chatBody = document.getElementById("chat-body");
    const chatInput = document.getElementById("chat-input");
    const sendButton = document.getElementById("send-btn");
    const backendBaseUrl = "http://localhost:3001";
    const qlikConfigPromise = fetch(`${backendBaseUrl}/debug/env`, { credentials: "include" })
        .then((response) => response.ok ? response.json() : {})
        .catch(() => ({}));

    // Cargar metadatos del asistente al iniciar
    fetch(`${backendBaseUrl}/api/assistant`)
        .then(response => {
            if (response.ok) return response.json();
            throw new Error("Failed to fetch assistant metadata");
        })
        .then(data => {
            if (data && data.name) {
                // Actualizar título del chat header
                const chatHeaderTitle = document.querySelector(".chat-header h4");
                if (chatHeaderTitle) {
                    chatHeaderTitle.textContent = "Asistente " + data.name;
                }

                // Actualizar subtítulo
                const chatHeaderSubtitle = document.querySelector(".chat-header .header-span");
                if (chatHeaderSubtitle && data.welcomeMessage) {
                    chatHeaderSubtitle.textContent = data.welcomeMessage;
                }
            }
        })
        .catch(err => {
            console.error("Error loading assistant metadata:", err);
        });

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

    function parseTextWithCitations(text) {
        if (!text) return "";
        // Replace citations like <citation data-index="0">1</citation> with elegant clickables
        let processed = text.replace(/<citation data-index=(["']?)(\d+)\1>([\s\S]*?)<\/citation>/gi, (match, quote, index, content) => {
            return `<sup class="citation-sup"><a href="#" class="citation-link" data-index="${index}">${content}</a></sup>`;
        });
        // Replace Markdown double asterisks **text**
        processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        return processed;
    }

    function AdaptiveCardRenderer(card) {
        const container = document.createElement('div');
        container.className = 'adaptive-card-container';

        let detailsSection = null;
        const renderedElements = [];

        function renderElement(element, index) {
            if (!element) return null;

            switch (element.type) {
                case 'TextBlock': {
                    const isTitle = element.weight === 'bolder' || element.size === 'medium' || element.size === 'large';
                    const el = document.createElement(isTitle ? 'h3' : 'p');
                    el.className = isTitle ? 'adaptive-card-title' : 'adaptive-card-text';
                    el.innerHTML = parseTextWithCitations(element.text);
                    return el;
                }
                case 'Qlik.Snapshot': {
                    const snapshot = element.snapshot;
                    if (!snapshot) return null;

                    const visType = snapshot.visualization;
                    if (visType === 'kpi') {
                        // KPI Visual matching Fase 4 specs
                        const kpiContainer = document.createElement('div');
                        kpiContainer.className = 'qlik-kpi-container';
                        kpiContainer.setAttribute('data-citation-index', String(index));

                        const qHyperCube = snapshot.data?.qHyperCube;
                        const matrix = qHyperCube?.qDataPages?.[0]?.qMatrix;
                        const cell = matrix?.[0]?.[matrix[0].length - 1] || matrix?.[0]?.[0];
                        const formattedValue = cell?.qText || String(cell?.qNum || "-");

                        const titleEl = document.createElement('div');
                        titleEl.className = 'qlik-kpi-title';
                        titleEl.textContent = snapshot.title || qHyperCube?.qMeasureInfo?.[0]?.qFallbackTitle || 'Indicador';

                        const valueEl = document.createElement('div');
                        valueEl.className = 'qlik-kpi-value';
                        valueEl.textContent = formattedValue;

                        kpiContainer.appendChild(titleEl);
                        kpiContainer.appendChild(valueEl);

                        // Add formula/expression as-is if available
                        const expression = snapshot.object_properties?.qHyperCubeDef?.qMeasures?.[0]?.qDef?.qDef;
                        if (expression) {
                            const hr = document.createElement('hr');
                            hr.style.cssText = 'border: 0; border-top: 1px solid rgba(0, 0, 0, 0.06); margin: 12px 0;';
                            kpiContainer.appendChild(hr);

                            const exprLabel = document.createElement('div');
                            exprLabel.className = 'qlik-kpi-expression';
                            exprLabel.textContent = expression;
                            kpiContainer.appendChild(exprLabel);
                        }

                        return kpiContainer;
                    } else if (visType === 'bar' || visType === 'pie') {
                        // Chart.js implementation for standard visualizations
                        const chartContainer = document.createElement('div');
                        chartContainer.className = 'qlik-chart-container';
                        chartContainer.setAttribute('data-citation-index', String(index));
                        chartContainer.style.cssText = 'margin: 20px 0; padding: 16px; background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 16px; height: 250px; position: relative;';

                        if (snapshot.title) {
                            const chartTitle = document.createElement('div');
                            chartTitle.className = 'qlik-kpi-title';
                            chartTitle.style.marginBottom = '12px';
                            chartTitle.textContent = snapshot.title;
                            chartContainer.appendChild(chartTitle);
                        }

                        const canvas = document.createElement('canvas');
                        canvas.style.width = '100%';
                        canvas.style.height = '100%';
                        chartContainer.appendChild(canvas);

                        const qHyperCube = snapshot.data?.qHyperCube;
                        const matrix = qHyperCube?.qDataPages?.[0]?.qMatrix || [];

                        const labels = matrix.map(row => row[0]?.qText || String(row[0]?.qNum || ''));
                        const datasetData = matrix.map(row => row[1] !== undefined ? (row[1].qNum !== undefined ? row[1].qNum : parseFloat(row[1].qText)) : 0);
                        const datasetLabel = qHyperCube?.qMeasureInfo?.[0]?.qFallbackTitle || 'Métrica';

                        // Initialize Chart.js safely after DOM injection
                        setTimeout(() => {
                            try {
                                new Chart(canvas, {
                                    type: visType === 'pie' ? 'pie' : 'bar',
                                    data: {
                                        labels: labels,
                                        datasets: [{
                                            label: datasetLabel,
                                            data: datasetData,
                                            backgroundColor: visType === 'pie'
                                                ? ['#1d1d1f', '#313136', '#515156', '#86868b', '#a1a1a6', '#d2d2d7']
                                                : '#1d1d1f',
                                            borderColor: visType === 'pie' ? '#ffffff' : '#1d1d1f',
                                            borderWidth: 1
                                        }]
                                    },
                                    options: {
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: {
                                            legend: {
                                                display: visType === 'pie',
                                                position: 'bottom'
                                            }
                                        },
                                        scales: visType === 'pie' ? {} : {
                                            y: {
                                                beginAtZero: true
                                            }
                                        }
                                    }
                                });
                            } catch (e) {
                                console.error('Error initializing Chart.js:', e);
                            }
                        }, 100);

                        return chartContainer;
                    } else {
                        console.log('Unknown visualization:', visType);
                        return null;
                    }
                }
                case 'ActionSet': {
                    // Ignorar el ActionSet (botón de toggle) ya que la fuente se muestra directamente
                    return null;
                }
                case 'Container': {
                    const div = document.createElement('div');
                    if (element.id === 'detailsSection') {
                        div.className = 'adaptive-card-details-panel';
                        div.style.display = 'block'; // Mostrar la fuente de los datos directamente
                        detailsSection = div;
                    }

                    if (element.items) {
                        element.items.forEach((item, itemIdx) => {
                            const childEl = renderElement(item, itemIdx);
                            if (childEl) div.appendChild(childEl);
                        });
                    }
                    return div;
                }
                default:
                    return null;
            }
        }

        if (card?.body) {
            card.body.forEach((element, idx) => {
                const domEl = renderElement(element, idx);
                if (domEl) {
                    container.appendChild(domEl);
                    renderedElements.push(domEl);
                }
            });
        }

        container.querySelectorAll('.citation-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const index = link.getAttribute('data-index');
                const targetEl = container.querySelector(`[data-citation-index="${index}"]`);
                if (targetEl) {
                    targetEl.classList.add('highlight-flash');
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => {
                        targetEl.classList.remove('highlight-flash');
                    }, 2000);
                }
            });
        });

        return container;
    }

    function ConclusionCard(card, chatInput, sendQuestion) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message assistant';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.width = '100%';

        // 1. loading Spinner for the card
        const cardSpinner = document.createElement('div');
        cardSpinner.className = 'card-loading-spinner';
        cardSpinner.style.cssText = 'display: flex; justify-content: center; align-items: center; padding: 40px 20px; background: white; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 18px; margin-top: 12px;';
        cardSpinner.innerHTML = `
            <div class="fancy-spinner">
                <div class="dot" style="background-color: #1d1d1f;"></div>
                <div class="dot" style="background-color: #1d1d1f;"></div>
                <div class="dot" style="background-color: #1d1d1f;"></div>
            </div>
            <span class="card-loading-text" style="margin-left: 12px; font-size: 13.5px; color: #86868b; font-weight: 500; font-family: inherit;">Cargando conclusión analítica...</span>
        `;
        wrapper.appendChild(cardSpinner);

        // 2. Render actual AdaptiveCard (initially hidden)
        const cardContent = AdaptiveCardRenderer(card);
        cardContent.style.opacity = '0';
        cardContent.style.transition = 'opacity 0.4s ease';
        cardContent.style.display = 'none';
        wrapper.appendChild(cardContent);

        // Transition from spinner to card
        setTimeout(() => {
            cardSpinner.style.transition = 'opacity 0.3s ease';
            cardSpinner.style.opacity = '0';
            setTimeout(() => {
                cardSpinner.remove();
                cardContent.style.display = 'block';
                cardContent.offsetHeight; // reflow trigger
                cardContent.style.opacity = '1';
            }, 300);
        }, 850);

        // 3. Suggested questions (followUpActions) rendered outside the card
        const followUps = card.followUpActions || [];
        if (followUps.length > 0) {
            const followUpsContainer = document.createElement('div');
            followUpsContainer.className = 'assistant-followups-container';
            followUpsContainer.style.marginTop = '16px';
            followUpsContainer.style.display = 'flex';
            followUpsContainer.style.flexDirection = 'column';
            followUpsContainer.style.gap = '8px';

            followUps.forEach(action => {
                if (action.text) {
                    const btn = document.createElement('button');
                    btn.className = 'suggested-question-row';

                    const leftDiv = document.createElement('div');
                    leftDiv.style.cssText = 'display: flex; align-items: center; gap: 10px;';

                    const circle = document.createElement('span');
                    circle.className = 'suggested-question-circle';
                    circle.textContent = '→';

                    const txt = document.createElement('span');
                    txt.style.cssText = 'font-size: 13.5px; color: #1d1d1f; font-weight: 500; font-family: inherit;';
                    txt.textContent = action.text;

                    leftDiv.appendChild(circle);
                    leftDiv.appendChild(txt);

                    const rightArrow = document.createElement('span');
                    rightArrow.style.cssText = 'color: #86868b; font-size: 14px; font-weight: 500; font-family: inherit;';
                    rightArrow.textContent = '↵';

                    btn.appendChild(leftDiv);
                    btn.appendChild(rightArrow);

                    btn.addEventListener('click', () => {
                        chatInput.value = action.text;
                        sendQuestion();
                    });

                    followUpsContainer.appendChild(btn);
                }
            });

            wrapper.appendChild(followUpsContainer);
        }

        return wrapper;
    }

    function createFinalCard(content, objectId = "ZxDKp", hasChart = false, kpi = null, card = null) {
        if (card) {
            return ConclusionCard(card, chatInput, sendQuestion);
        }

        const fallbackCard = {
            body: [
                { type: "TextBlock", text: "Conclusión", weight: "bolder", size: "medium" },
                { type: "TextBlock", text: content, wrap: true }
            ]
        };

        if (kpi) {
            fallbackCard.body.push({
                type: "Qlik.Snapshot",
                snapshot: {
                    visualization: "kpi",
                    title: kpi.title,
                    data: {
                        qHyperCube: {
                            qDataPages: [{
                                qMatrix: [[{ qText: kpi.text || String(kpi.value), qNum: kpi.value }]]
                            }],
                            qMeasureInfo: [{ qFallbackTitle: kpi.title }]
                        }
                    },
                    object_properties: {
                        qHyperCubeDef: {
                            qMeasures: [{ qDef: { qDef: kpi.expression } }]
                        }
                    }
                }
            });
        }

        return ConclusionCard(fallbackCard, chatInput, sendQuestion);
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
                } catch (e) { }
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
            const preferredKeys = ['text', 'markdown', 'output', 'title', 'subtitle', 'message', 'value'];
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



    function translateAgentName(name) {
        if (!name) return "";
        let n = name;
        if (n.toLowerCase().includes("answers agent")) return "Agente Answers";
        if (n.toLowerCase().includes("data analyst agent")) return "Agente Data Analyst";
        return n.replace(/agent/gi, "Agente").trim();
    }

    function translateAgentStep(step) {
        if (!step) return "";
        const lower = step.toLowerCase();
        if (lower.includes("understanding intent")) return "Entendiendo la intención";
        if (lower.includes("building expressions")) return "Construyendo expresiones";
        if (lower.includes("searching fields")) return "Buscando campos";
        if (lower.includes("generating query")) return "Generando consulta";
        if (lower.includes("synthesizing answer")) return "Sintetizando respuesta";
        if (lower.includes("routing request")) return "Ruteando la solicitud";
        if (lower.includes("fetching data")) return "Obteniendo los datos";
        if (lower.includes("analyzing results")) return "Analizando los resultados";
        return step;
    }

    function markAgentDone(uiContext, agentName) {
        const panel = uiContext._activeAgentPanel || (uiContext._agentPanels && uiContext._agentPanels[agentName]);
        if (!panel) return;
        try {
            if (panel.spinner) panel.spinner.style.display = 'none';
            if (panel.wrap) panel.wrap.classList.add('assistant-agent-done');
        } catch (e) { }
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
                summary: p.summary || "",
                card: card
            };
        }

        const p = event.params;
        if (!p) return null;

        // 1. Nuevo agente (a través de steps de un stepper o directo)
        const firstAgent = p.value?.content?.[0]?.card?.body?.[0]?.steps?.[0];
        if (p.op === "add" && firstAgent && firstAgent.displayName) {
            const nameTrans = translateAgentName(firstAgent.displayName);
            return {
                type: "NEW_AGENT",
                name: nameTrans,
                title: firstAgent.title || nameTrans
            };
        }

        if (p.op === "add" && p.value && p.value.displayName) {
            const nameTrans = translateAgentName(p.value.displayName);
            return {
                type: "NEW_AGENT",
                name: nameTrans,
                title: p.value.title || nameTrans
            };
        }

        // 2. Cambio de step del agente
        if (p.value?.isSubtle === true && p.value?.text) {
            return {
                type: "AGENT_STEP",
                step: translateAgentStep(p.value.text)
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
        spinner.style.borderTopColor = '#1d1d1f';

        const check = document.createElement('span');
        check.style.display = 'none';

        statusWrap.appendChild(spinner);

        const toggle = document.createElement('button');
        toggle.className = 'assistant-agent-toggle';
        toggle.innerHTML = '▾';

        header.appendChild(title);
        header.appendChild(statusWrap);
        header.appendChild(toggle);

        const content = document.createElement('div');
        content.className = 'assistant-agent-content';
        content.style.display = 'none';

        toggle.addEventListener('click', () => {
            const open = content.style.display === 'block';
            content.style.display = open ? 'none' : 'block';
            toggle.innerHTML = open ? '▾' : '▴';
        });

        panelWrap.appendChild(dot);
        panelWrap.appendChild(header);
        panelWrap.appendChild(content);
        ui.content.appendChild(panelWrap);

        const panelObj = { wrap: panelWrap, header, content, spinner, check, toggle };
        ui._agentPanels[agentName] = panelObj;
        ui._activeAgentPanel = panelObj;
        return panelObj;
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
                        if (action.card) {
                            const finalCard = createFinalCard(null, null, false, null, action.card);
                            chatBody.appendChild(finalCard);
                        } else if (action.conclusion?.text) {
                            const hasChart = !!action.kpi;
                            const objectId = action.kpi?.objectId || "ZxDKp";
                            const finalCard = createFinalCard(action.conclusion.text, objectId, hasChart, action.kpi, null);
                            chatBody.appendChild(finalCard);
                        } else if (action.summary) {
                            // Si no hay conclusión formal pero hay summary
                            const finalCard = createFinalCard(action.summary, "ZxDKp", false, null, null);
                            chatBody.appendChild(finalCard);
                        }

                        // Renderizar preguntas sugeridas (Follow-Ups) only if action.card is not present
                        if (!action.card && action.followUps && action.followUps.length) {
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
                                    btn.style.cssText = "text-align: left; padding: 10px 16px; background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 999px; cursor: pointer; font-size: 13px; color: #1d1d1f; font-weight: 500; font-family: inherit; transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1);";
                                    btn.textContent = act.title || act.label;
                                    btn.addEventListener("mouseenter", () => {
                                        btn.style.background = "#f5f5f7";
                                        btn.style.borderColor = "rgba(0, 0, 0, 0.15)";
                                    });
                                    btn.addEventListener("mouseleave", () => {
                                        btn.style.background = "#ffffff";
                                        btn.style.borderColor = "rgba(0, 0, 0, 0.08)";
                                    });
                                    btn.addEventListener("click", () => {
                                        chatInput.value = btn.textContent;
                                        sendQuestion();
                                    });
                                    followUpsContainer.appendChild(btn);
                                }
                            });
                            chatBody.appendChild(followUpsContainer);
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
                try { evtSource.close(); } catch (_e) { }
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
        testEmbed: async function (objectId = "ZxDKp") {
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
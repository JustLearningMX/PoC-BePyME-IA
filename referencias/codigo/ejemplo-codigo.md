## Este es un codigo que utilizo en Postman para limpiar y ordenar por agentes los chunks recibidos del Stream
```js
const rawBody = pm.response.text();

// Separar líneas SSE: "data: {...}"
const lines = rawBody.split('\n');
const events = [];

for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const jsonStr = trimmed.replace(/^data:\s*/, '');
    try {
        const parsed = JSON.parse(jsonStr);
        events.push(parsed);
    } catch(e) {
        // ignorar líneas no parseables
    }
}

console.log(`Total eventos SSE: ${events.length}`);

// Buscar el evento final "method":"message" que tiene todo consolidado
const finalEvent = events.find(e => e.method === 'message');

if (finalEvent) {
    const content = finalEvent.params?.content?.[0];
    const card = content?.card;
    
    if (card?.reasoning) {
        // Extraer los steps del reasoning (cada step = un agente)
        const reasoningBody = card.reasoning.body?.[0]?.items;
        
        if (reasoningBody) {
            // El container de razonamiento largo tiene los pasos por agente
            const longContainer = reasoningBody.find(i => i.id === 'longReasoningContainer');
            const steps = longContainer?.items || [];
            
            console.log(`\n===== AGENTES Y SUS RESPUESTAS =====\n`);
            
            steps.forEach((step, idx) => {
                const agentItems = step?.items?.[0]?.items || [];
                
                // Nombre del agente
                const agentName = agentItems.find(i => i.weight === 'bolder')?.text || `Agente ${idx+1}`;
                
                // Texto del agente
                const agentText = agentItems
                    .filter(i => i.type === 'ColumnSet')
                    .flatMap(cs => cs.columns || [])
                    .flatMap(col => col.items || [])
                    .map(item => item.text || '')
                    .join('');
                
                // Limpiar tags HTML/XML internos
                const cleanText = agentText
                    .replace(/\\u003c[^\\u003e]*\\u003e/g, '')
                    .replace(/<[^>]*>/g, '')
                    .replace(/\\n/g, '\n')
                    .trim();
                
                console.log(`--- ${agentName} ---`);
                console.log(cleanText);
                console.log('');
            });
        }
    }
    
    // Conclusión final
    const conclusion = card?.body?.find(b => b.text && b.text.includes('clientes'));
    if (conclusion) {
        console.log(`\n===== CONCLUSIÓN FINAL =====`);
        console.log(conclusion.text.replace(/\*\*/g, ''));
    }
    
    // Follow-up suggestions
    const followUps = content?.followUpActions || [];
    if (followUps.length > 0) {
        console.log(`\n===== PREGUNTAS SUGERIDAS =====`);
        followUps.forEach(f => console.log(`- ${f.text}`));
    }
    
    pm.collectionVariables.set("LAST_RESPONSE", conclusion?.text || '');
}
```

## Este es el resultado
```text
 
--- Data Analyst Agent ---
 
Tienes **1,860 clientes** registrados en tu sistema CRM.
 
 
--- Answers Agent ---
 
Tienes 1,860 clientes únicos registrados en tu sistema CRM.[dbcea864-8d18-4409-94ce-a0cfd204508d]
 
 
--- Agente 7 ---
 
 
 

===== CONCLUSIÓN FINAL =====
 
Tienes 1,860 clientes únicos registrados en tu sistema CRM.<citation data-index="0">1</citation>
```
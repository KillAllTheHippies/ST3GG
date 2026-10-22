/* Shared by Agent / Conceal and PolyPolyGlotZipNest. Prompts only; no archive inspection. */
(function () {
    'use strict';
    const endpoint = 'https://openrouter.ai/api/v1', active = new Set();
    const keyInput = document.getElementById('aiagent-api-key');
    const keyStorageName = 'openrouter_api_key';
    const keyStorageTypes = ['sessionStorage', 'localStorage'];
    function saveKey() {
        const key = keyInput.value.trim();
        for (const storageType of keyStorageTypes) {
            try {
                const storage = globalThis[storageType];
                if (key) storage.setItem(keyStorageName, key);
                else storage.removeItem(keyStorageName);
            } catch { /* Try the other store; the current page can still use its key. */ }
        }
    }
    for (const storageType of keyStorageTypes) {
        if (keyInput.value.trim()) break;
        try {
            const savedKey = globalThis[storageType].getItem(keyStorageName);
            if (savedKey?.trim()) keyInput.value = savedKey.trim();
        } catch { /* Storage may be disabled; try the other store. */ }
    }
    if (keyInput.value.trim()) saveKey();
    keyInput.addEventListener('input', saveKey);
    keyInput.addEventListener('change', saveKey);
    function settings() {
        return { apiKey: keyInput.value.trim(), model: document.getElementById('aiagent-image-model').value.trim() };
    }
    function configure({ apiKey, model }) {
        if (apiKey !== undefined) {
            keyInput.value = apiKey.trim();
            saveKey();
        }
        if (model !== undefined) document.getElementById('aiagent-image-model').value = model;
    }
    async function models(signal, kind = 'image') {
        const key=settings().apiKey;
        const response = await fetch(`${endpoint}/${kind==='planning'?'models':'images/models'}`, { signal, headers:key?{Authorization:`Bearer ${key}`}:{}});
        if (!response.ok) throw new Error(`Model discovery failed (${response.status}). You can enter a model ID directly.`);
        const data = await response.json();
        return (data.data || []).filter(model => model.id && (kind==='planning'
            ? model.architecture?.input_modalities?.includes('image') && model.architecture?.output_modalities?.includes('text')
            : model.architecture?.output_modalities?.includes('image')));
    }
    async function generate({ prompt, model, apiKey, signal, resolution, aspectRatio, size, references = [] }) {
        const configured = settings(); apiKey = apiKey ?? configured.apiKey; model = model || configured.model;
        if (!apiKey) throw new Error('Enter your OpenRouter API key in Agent settings before generating images.');
        if (!model) throw new Error('Select an image model in Agent settings.');
        if (!prompt?.trim()) throw new Error('Describe the carrier image to generate.');
        const controller = new AbortController(), abort = () => controller.abort();
        if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
        active.add(controller);
        try {
            const body = { model, prompt: prompt.trim() };
            if (resolution) body.resolution = resolution;
            if (aspectRatio) body.aspect_ratio = aspectRatio;
            if (size) body.size = size;
            if (references.length) body.input_references = references.map(url => ({ type: 'image_url', image_url: { url } }));
            const response = await fetch(`${endpoint}/images`, {
                method: 'POST', signal: controller.signal,
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'ST3GG Image Agent' },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                let message = `Image model request failed (${response.status}).`;
                try { const error = await response.json(); message = error.error?.message || message; } catch { /* Keep the HTTP error. */ }
                throw new Error(message);
            }
            const data = await response.json(), image = data.data?.find(item => item.b64_json);
            if (!image) throw new Error('The image model returned no image bytes. Check its output modality and model ID.');
            const type = image.media_type || 'image/png';
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new Error(`The model returned ${type}; choose a raster image model for carriers.`);
            const bytes = Uint8Array.from(atob(image.b64_json), char => char.charCodeAt(0));
            return { bytes, url: `data:${type};base64,${image.b64_json}`, type, model, usage: data.usage || null };
        } finally { active.delete(controller); signal?.removeEventListener('abort', abort); }
    }
    async function plan({ brief, layers, reference, signal, model }) {
        const apiKey = settings().apiKey;
        if (!apiKey) throw new Error('Add your Agent API key in Model settings.');
        model = model || document.getElementById('aiagent-model').value;
        if (model === 'custom') model = document.getElementById('aiagent-custom-model').value.trim();
        if (!model) throw new Error('Choose a vision / planning model in Model settings.');
        const content = [{ type: 'text', text: `Plan a coherent image progression for a nested polyglot. Return ONLY JSON with a layers array of exactly ${layers.length} objects, each containing id (unchanged), prompt (self-contained image description) and role (short label). Keep the supplied order. Brief: ${brief}\nLayers: ${JSON.stringify(layers.map(n => ({ id: n.id, name: n.name, parent: n.parent?.id ?? null })))}` }];
        if (reference) content.push({ type: 'image_url', image_url: { url: reference } });
        const response = await fetch(`${endpoint}/chat/completions`, { method: 'POST', signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'ST3GG Sequence Planner' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content }], response_format: { type: 'json_object' } }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || `Sequence planning failed (${response.status}).`);
        const raw = result.choices?.[0]?.message?.content;
        const parsed = JSON.parse(String(raw || '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (!Array.isArray(parsed.layers) || parsed.layers.length !== layers.length || layers.some(n => !parsed.layers.some(p => String(p.id) === String(n.id) && typeof p.prompt === 'string' && p.prompt.trim()))) throw new Error('The planner returned an incomplete sequence. Your existing plan is retained.');
        return parsed.layers;
    }
    window.ST3GGImageAgent = { settings, configure, models, generate, plan, cancel: () => { for (const controller of active) controller.abort(); } };
})();

/* Searchable Agent model catalog. Usage rankings stay in this browser. */
(function () {
    'use strict';
    const input = document.getElementById('aiagent-custom-model');
    const select = document.getElementById('aiagent-model');
    if (!input || !select) return;
    const usageKey = 'st3gg_agent_model_usage', selectedKey = 'st3gg_agent_selected_model';
    const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
    const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Selection still works without storage. */ } };
    let usage = read(usageKey, {});
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) usage = {};
    usage = Object.assign(Object.create(null), usage);
    const recommended = [...select.options].filter(o => o.value !== 'custom').map(o => ({ id: o.value, name: o.textContent.replace(/ \([^)]*\)$/, '') }));
    const recommendedOrder = new Map(recommended.map((m, i) => [m.id, i]));
    let catalog = [...recommended], recommendedOpen = true;
    let fetched = false, loading = false, problem = '', lastFetch = 0, matches = [], active = -1, shown = 40, searching = false;
    const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    const wrap = node('div', null, 'agent-model-picker');
    const bar = node('div', null, 'agent-model-input-row');
    input.replaceWith(wrap); wrap.append(bar); bar.append(input);
    const refresh = node('button', '↻', 'agent-model-refresh'); refresh.type = 'button'; refresh.title = 'Refresh available models'; refresh.setAttribute('aria-label', refresh.title); bar.append(refresh);
    const popup = node('div', null, 'agent-model-popup'); popup.hidden = true; wrap.append(popup);
    const status = node('div', null, 'agent-model-status'); status.setAttribute('role', 'status'); popup.append(status);
    const list = node('div', null, 'agent-model-options'); list.id = 'aiagent-model-options'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Available Agent models'); popup.append(list);
    input.style.display = 'block'; input.style.marginTop = '0'; input.style.fontSize = '';
    input.placeholder = 'Search models by name or provider, or enter a model ID'; input.autocomplete = 'off';
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
    const label = select.parentElement.querySelector('label'); if (label) label.htmlFor = input.id;
    select.hidden = true;
    const hint = document.getElementById('aiagent-custom-hint'); if (hint) hint.hidden = true;
    const saved = read(selectedKey, '');
    input.value = typeof saved === 'string' && saved ? saved : select.value === 'custom' ? input.value : select.value;
    select.value = 'custom';
    const frequency = id => { const n = Number(usage[id]?.count); return Number.isFinite(n) && n > 0 ? n : 0; };
    function close() { popup.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
    function choose(id) {
        input.value = id; select.value = 'custom'; save(selectedKey, id); close();
        input.dispatchEvent(new Event('change', { bubbles: true })); input.focus({ preventScroll: true }); close();
    }
    function draw(preserve = false) {
        const scrollTop = popup.scrollTop, previousActive = active;
        const query = searching ? input.value.trim().toLowerCase() : '', terms = query.split(/\s+/).filter(Boolean);
        const previous = fetched ? [] : Object.keys(usage).filter(id => frequency(id)).map(id => ({ id, name: id }));
        const pool = [...new Map([...previous, ...catalog].map(m => [m.id, m])).values()];
        const filtered = pool.filter(m => terms.every(term => (m.id + ' ' + m.name).toLowerCase().includes(term)));
        const sections = [
            { title: 'Recommended', models: filtered.filter(m => recommendedOrder.has(m.id)).sort((a, b) => recommendedOrder.get(a.id) - recommendedOrder.get(b.id)) },
            { title: 'Frequently used', models: filtered.filter(m => frequency(m.id)).sort((a, b) => frequency(b.id) - frequency(a.id) || a.name.localeCompare(b.name)) },
            { title: fetched ? 'Available models' : 'Saved choices', models: filtered.filter(m => !recommendedOrder.has(m.id) && !frequency(m.id)).sort((a, b) => a.name.localeCompare(b.name)) }
        ];
        matches = sections.flatMap(section => section.models);
        list.replaceChildren(); active = -1; input.removeAttribute('aria-activedescendant');
        let rendered = 0;
        for (const section of sections) {
            const visible = section.models.slice(0, Math.max(0, shown - rendered));
            if (!visible.length) continue;
            let host = list;
            if (section.title === 'Recommended') {
                const submenu = node('details', null, 'agent-model-recommended'); submenu.open = !!query || recommendedOpen;
                submenu.append(node('summary', section.title, 'agent-model-group'));
                submenu.ontoggle = () => { if (submenu.isConnected && !query) recommendedOpen = submenu.open; };
                host = node('div'); host.setAttribute('role', 'group'); host.setAttribute('aria-label', section.title); submenu.append(host); list.append(submenu);
            } else { const title = node('div', section.title, 'agent-model-group'); title.setAttribute('role', 'presentation'); list.append(title); }
            for (const model of visible) {
            const index = rendered++;
            const option = node('button', null, 'agent-model-option'); option.type = 'button'; option.id = 'agent-model-option-' + index;
            option.dataset.modelId = model.id;
            option.tabIndex = -1; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
            option.append(node('span', model.name, 'agent-model-name'), node('small', model.id));
            option.onmousedown = e => e.preventDefault(); option.onclick = () => choose(model.id); host.append(option);
            }
        }
        const exact = catalog.some(m => m.id.toLowerCase() === query);
        if (query && !exact) {
            const custom = node('button', 'Use model ID: ' + input.value.trim(), 'agent-model-custom'); custom.type = 'button';
            custom.onmousedown = e => e.preventDefault(); custom.onclick = () => choose(input.value.trim()); list.append(custom);
        }
        status.textContent = loading ? 'Fetching available models…' : problem || `${filtered.length} ${filtered.length === 1 ? 'model' : 'models'}${query ? ' match' : ''}`;
        if (preserve) {
            popup.scrollTop = scrollTop; active = previousActive;
            const options = visibleOptions(); if (options[active]) { options[active].setAttribute('aria-selected', 'true'); input.setAttribute('aria-activedescendant', options[active].id); }
        }
    }
    function visibleOptions() { return [...list.querySelectorAll('[role=option]')].filter(option => option.closest('details')?.open !== false); }
    function open() { popup.hidden = false; input.setAttribute('aria-expanded', 'true'); draw(); }
    async function load(force = false) {
        if (loading || (!force && fetched && Date.now() - lastFetch < 300000)) return;
        loading = true; problem = ''; draw(); refresh.disabled = true;
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error('Model catalog request failed');
            const data = await response.json();
            if (!Array.isArray(data.data)) throw new Error('Invalid model catalog');
            catalog = data.data.filter(m => typeof m.id === 'string' && (m.architecture?.output_modalities || ['text']).includes('text')).map(m => ({ id: m.id, name: m.name || m.id }));
            fetched = true; lastFetch = Date.now();
        } catch { problem = 'Could not refresh models. Enter a model ID or use Refresh to retry.'; }
        finally { loading = false; refresh.disabled = false; draw(); }
    }
    input.addEventListener('focus', () => { searching = false; open(); void load(); });
    input.addEventListener('input', () => { select.value = 'custom'; searching = true; shown = 40; open(); });
    input.addEventListener('change', () => { select.value = 'custom'; save(selectedKey, input.value.trim()); });
    input.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); if (popup.hidden) open();
            let options = visibleOptions();
            if (e.key === 'ArrowDown' && active >= options.length - 1 && shown < matches.length) { shown += 40; draw(true); options = visibleOptions(); }
            if (!options.length) return;
            active = e.key === 'ArrowDown' ? Math.min(active + 1, options.length - 1) : Math.max(active - 1, 0);
            options.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
            input.setAttribute('aria-activedescendant', options[active].id); options[active].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && !popup.hidden) { e.preventDefault(); const options = visibleOptions(); if (active >= 0 && options[active]) choose(options[active].dataset.modelId); else if (input.value.trim()) choose(options[0]?.dataset.modelId || input.value.trim()); }
    });
    refresh.onclick = () => { open(); void load(true); };
    popup.addEventListener('scroll', () => { if (!popup.hidden && popup.scrollHeight - popup.scrollTop - popup.clientHeight < 70 && shown < matches.length) { shown += 40; draw(true); } });
    document.addEventListener('pointerdown', e => { if (!wrap.contains(e.target)) close(); });
    wrap.addEventListener('focusout', e => { if (!wrap.contains(e.relatedTarget)) close(); });
    window.ST3GGAgentModels = {
        recordUse(id) {
            if (typeof id !== 'string' || !id) return;
            usage[id] = { count: frequency(id) + 1 }; save(usageKey, usage);
            if (!popup.hidden) draw();
        }
    };
})();

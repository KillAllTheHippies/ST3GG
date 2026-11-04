/* Shared presentation and result affordances; technique implementations stay separate. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), W = ST3GGWorkflow, T = ST3GGTransfers;
    function button(label, run, host) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary'; b.textContent = label; b.onclick = run; host.append(b); return b; }
    function modelSummary() {
        for (const item of document.querySelectorAll('.workflow-model-summary')) item.textContent = `Image model: ${$('aiagent-image-model').value || 'Choose in Configuration'}`;
    }
    document.addEventListener('DOMContentLoaded', () => {
        // One editable image-model field and planning default, wherever they are used.
        for (const [id, key] of [['aiagent-image-model','st3gg_image_model'], ['planning-model','st3gg_planning_model']]) {
            try { const value = localStorage.getItem(key); if (value !== null) $(id).value = value; } catch { /* Session-only settings remain usable. */ }
            $(id).addEventListener('input', () => { try { localStorage.setItem(key, $(id).value); } catch {} modelSummary(); });
        }
        modelSummary();
        for (const [id, kind] of [['aiagent-image-model','image'],['planning-model','planning']]) {
            const input = $(id), list = document.createElement('datalist'); list.id = id + '-options';
            input.setAttribute('list', list.id); input.after(list);
            const status = document.createElement('p'); status.className = 'workflow-model-status'; status.setAttribute('role','status');
            input.parentElement.append(status);
            const discover = button('Refresh available models', async () => {
                discover.disabled = true; status.textContent = 'Loading available models…';
                try {
                    const models = await ST3GGImageAgent.models(undefined,kind); list.replaceChildren();
                    for (const model of models) { const option = document.createElement('option'); option.value = model.id; option.label = model.name || model.id; list.append(option); }
                    status.textContent = `${models.length} models available. Type a name or enter a model ID.`;
                } catch (error) { status.textContent = error.message; }
                finally { discover.disabled = false; }
            }, input.parentElement);
        }
        const textShortcut = button('Continue in Text Lab', () => {
            document.querySelector('.tabs [data-tab="textlab"]').click(); $('textlab-secret').focus();
        }, $('encode-text').parentElement);
        textShortcut.hidden = !textLabUnlocked;
        document.addEventListener('st3gg-feature-change', () => { textShortcut.hidden = !textLabUnlocked; });
        // A common action row for decoded nested/cipher payloads.
        for (const [hostId, key, nameKey, source] of [
            ['matryoshka-extracted','matryoshkaExtractedData','matryoshkaExtractedFilename','Nested image payloads'],
            ['godmode-decode-result','godmodeDecodedData','godmodeDecodedFilename','SPECTER']
        ]) {
            const row = document.createElement('div'); row.className = 'result-actions';
            const download = $(hostId).querySelector('button'); if (download) row.append(download);
            $(hostId).append(row);
            T.mount(row, () => { if (!state[key]) throw new Error('Decode a payload first.'); return W.fromBytes(state[key],state[nameKey] || 'decoded.bin',source); });
        }
        const analysisActions = document.createElement('div'); analysisActions.className = 'result-actions'; $('analyze-results-card').append(analysisActions);
        T.mount(analysisActions, () => { if (!state.analyzeFile) throw new Error('Choose media first.'); return W.fromFile(state.analyzeFile,'Analyze input'); });
        button('Use analysis report…', () => ST3GGWorkbench.open(), analysisActions);
        // Remove duplicated quick-download placement; one result row handles images and audio.
        $('quick-download-btn').hidden = true;
        for (const [id, source] of [['textlab-output','Text Lab encoded text'], ['textlab-decode-output','Text Lab decoded message']]) {
            const row = $(id).nextElementSibling;
            button('Download text', () => { try { T.download(W.textArtifact(id,source)); } catch (error) { notify(error.message,'error'); } }, row);
        }
    });
})();

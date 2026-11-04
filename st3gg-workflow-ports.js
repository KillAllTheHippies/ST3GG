/* Input declarations: every upload and handoff uses the same receive handler. */
(() => {
    'use strict';
    const T = ST3GGTransfers, W = ST3GGWorkflow, $ = id => document.getElementById(id);
    const image = value => value.blob.type.startsWith('image/');
    const media = value => image(value) || value.blob.type.startsWith('audio/');
    const text = value => value.kind === 'text';
    const fileOf = value => new File([value.blob], value.name, { type: value.blob.type });
    const visible = panel => panel === 'matryoshka' ? state.matryoshkaMode : panel === 'godmode' ? state.godmodeActive : panel === 'textlab' ? textLabUnlocked : true;
    const groups = { encode: 'Encode', aiagent: 'Agent', matryoshka: 'Nested image payloads', godmode: 'SPECTER', textlab: 'Text Lab', polyglot: 'Image + ZIP layers' };
    const uploads = new Map();
    const imageURLs = new Map();
    async function readImage(value) {
        const url = URL.createObjectURL(value.blob);
        try {
            const img = new Image(); img.src = url; await img.decode();
            const bytes = new Uint8Array(await value.blob.arrayBuffer());
            const canvas = value.blob.type === 'image/png' ? await pngBytesToCanvas(bytes) || imageToCanvas(img) : imageToCanvas(img);
            return { img, canvas, bytes, url };
        } catch (error) { URL.revokeObjectURL(url); throw new Error('This image could not be opened.'); }
    }
    function preview(id, result, value, info) {
        if (imageURLs.has(id)) URL.revokeObjectURL(imageURLs.get(id)); imageURLs.set(id, result.url);
        $(id).src = result.url; $(id).classList.remove('hidden');
        if (info) $(info).textContent = `${value.name} | ${result.img.width}×${result.img.height}`;
    }
    function port({ panel, role, focus, upload, ...input }) {
        const definition = {
            group: groups[panel], available: () => visible(panel), ...input,
            reveal: value => W.reveal(panel, value, role, focus)
        };
        T.register(definition); if (upload) uploads.set(upload, definition);
    }
    function textPort(id, panel, field, label, setMode) {
        port({ id, panel, role: label, focus: field, label, accepts: text, accept: '.txt,.md,.json,.csv,text/*',
            occupied: () => !!$(field).value,
            receive: value => { setMode?.(); $(field).value = value.text; $(field).dispatchEvent(new Event('input', { bubbles: true })); }
        });
    }
    const mediaInputs = { encode: ['encode-carrier-input', 'carrierCanvas', 'encode-carrier-input'], decode: ['decode-image-input', 'decodeCanvas', 'decode-method'], analyze: ['analyze-image-input', 'analyzeCanvas', 'analyze-run-btn'] };
    for (const [panel, [upload, canvas, focus]] of Object.entries(mediaInputs)) {
        port({ id: panel === 'encode' ? 'encode.carrier' : panel + '.image', panel, upload, focus,
            role: panel === 'encode' ? 'Carrier' : 'Media',
            label: panel === 'encode' ? 'Use as carrier' : panel === 'decode' ? 'Decode media' : 'Analyze media',
            labelFor: value => panel === 'encode' ? 'Use as carrier' : `${panel === 'decode' ? 'Decode' : 'Analyze'} this ${image(value) ? 'image' : 'audio'}`,
            accepts: media, accept: 'image/*,audio/*',
            occupied: () => !!(state[canvas] || state[panel === 'encode' ? 'audioBuffer' : panel + 'AudioBuffer']),
            receive: value => W.loadMedia(panel, fileOf(value))
        });
    }
    textPort('encode.message', 'encode', 'encode-text', 'Encode · use as secret message', () => setPayloadMode('text'));
    for (const [panel, prefix, upload, info, mode] of [
        ['encode', 'payload', 'encode-file-input', 'encode-file-info', setPayloadMode],
        ['matryoshka', 'matryoshkaPayload', 'matryoshka-file-input', 'matryoshka-file-info', setMatryoshkaPayloadMode],
        ['godmode', 'godmodePayload', 'godmode-file-input', 'godmode-file-info', setGodmodePayloadMode]
    ]) {
        const bytesKey = prefix === 'payload' ? 'payloadFile' : prefix + 'File', nameKey = bytesKey + 'Name';
        port({ id: panel + '.file', panel, upload, role: 'Payload file', focus: upload,
            label: `${groups[panel]} · use as payload file`, accepts: () => true,
            occupied: () => !!state[bytesKey],
            receive: async value => {
                const bytes = new Uint8Array(await value.blob.arrayBuffer()); mode('file'); state[bytesKey] = bytes; state[nameKey] = value.name;
                $(info).textContent = `${value.name} (${formatSize(bytes.length)})`;
                if (panel === 'encode') updateCapacity(); if (panel === 'matryoshka') updateMatryoshkaSizeInfo();
            }
        });
    }
    textPort('matryoshka.message', 'matryoshka', 'matryoshka-text', 'Use as innermost secret', () => setMatryoshkaPayloadMode('text'));
    textPort('godmode.message', 'godmode', 'godmode-text', 'Use as secret message', () => setGodmodePayloadMode('text'));
    textPort('textlab.secret', 'textlab', 'textlab-secret', 'Use as secret text');
    textPort('textlab.cover', 'textlab', 'textlab-cover', 'Use as cover text');
    textPort('textlab.decode', 'textlab', 'textlab-decode-input', 'Text Lab · decode this text');
    textPort('aiagent.secret', 'aiagent', 'aiagent-secret-message', 'Use as Conceal message', () => setAgentMode('encode'));
    textPort('aiagent.context', 'aiagent', 'aiagent-context', 'Use as Agent context');

    for (const spec of [
        ['matryoshka.carrier', 'matryoshka', 'matryoshkaOuterCarrier', 'matryoshka-outer', 'Use as outer carrier'],
        ['matryoshka.decode', 'matryoshka', 'matryoshkaDecodeCanvas', 'matryoshka-decode', 'Decode nested image payloads'],
        ['godmode.carrier', 'godmode', 'godmodeCarrierCanvas', 'godmode-carrier', 'Use as SPECTER carrier'],
        ['godmode.decode', 'godmode', 'godmodeDecodeCanvas', 'godmode-decode', 'Decode with SPECTER']
    ]) {
        const [id, panel, stateKey, prefix, label] = spec;
        port({ id, panel, role: label, focus: prefix + '-input', upload: prefix + '-input', label, accepts: image, accept: 'image/*', occupied: () => !!state[stateKey],
            receive: async value => {
                const result = await readImage(value); state[stateKey] = result.canvas;
                preview(prefix + '-preview', result, value, $(prefix + '-info') ? prefix + '-info' : null);
                if (id === 'matryoshka.carrier') updateMatryoshkaSizeInfo();
            }
        });
    }
    port({ id: 'aiagent.reveal', panel: 'aiagent', role: 'Reveal file', focus: 'aiagent-start-btn', upload: 'aiagent-reveal-input',
        label: 'Agent · reveal this file', accepts: () => true, occupied: () => !!state.aiAgentFileBytes,
        receive: async value => {
            const bytes = new Uint8Array(await value.blob.arrayBuffer());
            const result = image(value) ? await readImage(value) : null;
            setAgentMode('analyze'); state.aiAgentFileBytes = bytes;
            state.aiAgentFileType = image(value) ? (value.blob.type === 'image/jpeg' ? 'JPEG' : value.blob.type.split('/')[1].toUpperCase()) : value.name.split('.').pop().toUpperCase();
            state.aiAgentJpegData = value.blob.type === 'image/jpeg' ? bytes : null;
            state.aiAgentCanvas = result?.canvas || null; state.aiAgentRevealCanvas = result?.canvas || null; state.aiAgentImage = result?.img || null;
            if (result) preview('aiagent-reveal-preview', result, value, 'aiagent-reveal-info');
            else { $('aiagent-reveal-preview').classList.add('hidden'); $('aiagent-reveal-info').textContent = `${value.name} · ${formatSize(bytes.length)}`; }
            const checklist = getChecklistForFileType(state.aiAgentFileType);
            $('checklist-info-btn').style.display = 'block'; $('checklist-info-text').textContent = `View ${checklist.techniques.length} techniques for ${state.aiAgentFileType}`;
        }
    });
    port({ id: 'aiagent.carrier', panel: 'aiagent', role: 'Conceal carrier', focus: 'aiagent-secret-message', upload: 'aiagent-conceal-input',
        label: 'Agent · use as Conceal carrier', accepts: image, accept: 'image/*', occupied: () => !!state.aiAgentConcealCanvas,
        receive: async value => { const result = await readImage(value); setAgentMode('encode'); state.aiAgentConcealCanvas = result.canvas; state.aiAgentCanvas = result.canvas; state.aiAgentImage = result.img; preview('aiagent-conceal-preview', result, value, 'aiagent-conceal-info'); }
    });
    port({ id: 'encode.spectrogram', panel: 'encode', role: 'Spectrogram image', focus: 'audio-encode-method', upload: 'audio-specart-input',
        label: 'Use as spectrogram art', accepts: image, accept: 'image/*', occupied: () => !!state.audioSpecartImage,
        receive: async value => { const result = await readImage(value); state.audioSpecartImage = result.img; preview('audio-specart-preview', result, value); $('audio-encode-method').value = 'AUDIO_SPECART'; updateAudioMethodOptions(); }
    });

    const poly = () => state.polyglotMode && !!window.PolyFlow?.workflow;
    for (const [id, label, accepts, occupied, receive] of [
        ['polyglot.carrier', 'Use as selected layer carrier', value => ['image/png','image/jpeg'].includes(value.blob.type), () => PolyFlow.workflow.hasCarrier(), value => PolyFlow.workflow.carrier(value)],
        ['polyglot.entry', 'Add as file in selected layer ZIP', () => true, () => false, value => PolyFlow.workflow.entry(value)],
        ['polyglot.payload', 'Use as selected layer image payload', () => true, () => PolyFlow.workflow.hasPayload(), value => PolyFlow.workflow.payload(value)],
        ['polyglot.open', 'Open image + ZIP workspace', value => value.imageArchive, () => PolyFlow.workflow.hasProject(), value => PolyFlow.workflow.open(value)]
    ]) port({ id, panel: 'polyglot', role: label, focus: 'polyglot-tab-btn', label, accepts, occupied, receive, available: poly });

    async function loadInput(id, file) {
        const input = uploads.get(id); if (!input) throw new Error('Unknown input: ' + id);
        const value = await W.fromFile(file, 'Uploaded file');
        if (!input.accepts(value)) throw new Error('This file type is not supported for this input.');
        await input.receive(value);
        T.publish('input:' + id, value);
    }
    document.addEventListener('DOMContentLoaded', () => {
        for (const [upload, input] of uploads) {
            const element = $(upload); if (!element) continue;
            const host = document.createElement('div'); host.className = 'work-input-actions'; element.closest('.drop-zone').after(host);
            ST3GGWorkbench.inputButton(host, input.id);
        }
        for (const [id, field] of [['encode.message','encode-text'],['matryoshka.message','matryoshka-text'],['godmode.message','godmode-text'],['textlab.secret','textlab-secret'],['textlab.cover','textlab-cover'],['textlab.decode','textlab-decode-input'],['aiagent.secret','aiagent-secret-message'],['aiagent.context','aiagent-context']]) {
            const host = document.createElement('div'); host.className = 'work-input-actions'; $(field).after(host); ST3GGWorkbench.inputButton(host, id);
        }
    });
    window.ST3GGInputPorts = Object.freeze({ loadInput });
})();

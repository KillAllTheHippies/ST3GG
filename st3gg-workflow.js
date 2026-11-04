/* Adapters connect existing tab state to the shared transfer system. */
(() => {
    'use strict';
    const T = ST3GGTransfers;
    const $ = id => document.getElementById(id);
    const previewURLs = new Map();
    const loading = new Map();
    const isImage = value => value.blob.type.startsWith('image/');
    function fromBytes(data, name = 'output.bin', source = 'Result', type = '') {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
        if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78) type = 'image/png';
        else if (bytes[0] === 255 && bytes[1] === 216) type = 'image/jpeg';
        else if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) type = 'image/gif';
        else if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && ['WEBP','WAVE'].includes(String.fromCharCode(...bytes.slice(8,12)))) type = String.fromCharCode(...bytes.slice(8,12)) === 'WEBP' ? 'image/webp' : 'audio/wav';
        else if (/\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(name)) type = 'audio/' + name.split('.').pop().toLowerCase();
        else if (bytes[0] === 80 && bytes[1] === 75) type = 'application/zip';
        let text;
        if (typeof data === 'string' || /\.(txt|md|json|csv|html|xml|js|css)$/i.test(name) || type.startsWith('text/')) {
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Keep exact binary data. */ }
        }
        let imageArchive = false;
        if (type === 'image/png' || type === 'image/jpeg') for (let i = bytes.length - 22; i >= Math.max(0,bytes.length-65557); i--) {
            if (bytes[i] === 80 && bytes[i+1] === 75 && bytes[i+2] === 5 && bytes[i+3] === 6 && i+22+bytes[i+20]+256*bytes[i+21] === bytes.length) { imageArchive = true; break; }
        }
        return T.artifact({ blob: new Blob([bytes], { type }), text, name, source, imageArchive });
    }
    const fromFile = async (file, source) => fromBytes(await file.arrayBuffer(), file.name, source, file.type);
    function recordBytes(key, bytes, name, source, type) { return T.publish(key, fromBytes(bytes, name, source, type)); }

    function origin(panel, value, role) {
        let note = $(`transfer-origin-${panel}`);
        if (!note) {
            note = document.createElement('p'); note.id = `transfer-origin-${panel}`;
            note.className = 'transfer-origin'; note.setAttribute('role', 'status');
            $(`${panel}-panel`).prepend(note);
        }
        note.textContent = `${value.name} from ${value.source} · ${role} ready`;
    }

    function reveal(panel, value, role, focus) {
        if ($('work-picker')?.open) $('work-picker').close();
        origin(panel, value, role);
        document.querySelector(`.tabs [data-tab="${panel}"]`).click();
        let target = $(focus);
        if (target?.type === 'file') target = target.closest('.drop-zone')?.nextElementSibling?.querySelector('button') || target;
        if (!target || target.offsetParent === null) { target = $(panel + '-panel'); target.tabIndex = -1; }
        target?.scrollIntoView({ block: 'center', behavior: 'instant' });
        target?.focus({ preventScroll: true });
    }

    // Upload and transfer use this same loader. Raw bytes remain separate from previews.
    async function loadMedia(panel, file) {
        $(`transfer-origin-${panel}`)?.remove();
        if (file.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(file.name)) {
            const request = Symbol(); loading.set(panel, request);
            const prepared = await getAudioContext().decodeAudioData(await file.arrayBuffer());
            if (loading.get(panel) !== request) throw new Error('A newer file was selected. This audio was not applied.');
            switchToAudioMode(panel);
            await (panel === 'decode' ? loadAudioForDecode(file, prepared) : panel === 'encode' ? loadAudioCarrier(file, prepared) : loadAudioForAnalyze(file, prepared));
            if (panel === 'decode') { state.decodeCanvas = null; state.decodeJpegData = null; state.decodePngData = null; state.extractedData = null; $('decode-result').classList.add('hidden'); }
            if (panel === 'analyze') {
                state.analyzeCanvas = null; state.analyzeFile = file; state.currentFile = file;
                $('channel-layers-section').classList.add('hidden');
                state.analysisInspectionPromise = ST3GGAnalysis.inspect(file);
            }
            return;
        }
        const request = Symbol(); loading.set(panel, request);
        const url = URL.createObjectURL(file);
        try {
            const [bytes, image] = await Promise.all([
                file.arrayBuffer().then(buffer => new Uint8Array(buffer)),
                new Promise((resolve, reject) => {
                    const img = new Image(); img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error('This image could not be opened.')); img.src = url;
                })
            ]);
            const png = file.type === 'image/png' || /\.png$/i.test(file.name);
            const jpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
            const canvas = panel === 'decode' && png ? await pngBytesToCanvas(bytes) || imageToCanvas(image) : imageToCanvas(image);
            if (loading.get(panel) !== request) throw new Error('A newer file was selected. This image was not applied.');
            switchToImageMode(panel);
            if (panel === 'encode') {
                state.audioBuffer = null; state.carrierCanvas = canvas; state.carrierOriginalType = file.type;
                updateCapacity(); updateTextOverlayPreview();
            } else if (panel === 'decode') {
                state.decodeAudioBuffer = null;
                state.decodeCanvas = canvas;
                state.decodePngData = png ? bytes : null;
                state.decodeJpegData = jpeg ? bytes : null;
                state.extractedData = null;
                $('decode-result').classList.add('hidden');
                $('scan-results').classList.add('hidden');
                $('matryoshka-results').classList.add('hidden');
                const header = findStegHeader(canvas);
                $('decode-detection').textContent = header
                    ? `STEG v${header.header.version} detected · ${header.channelStr} · ${header.detectedBits}-bit`
                    : `No STEG header found. Use Smart Scan${jpeg ? ' or try F5 with a password' : ''}.`;
            } else {
                state.analyzeAudioBuffer = null;
                state.analyzeFile = file; state.currentFile = file; state.analyzeCanvas = canvas;
                $('channel-layers-section').classList.add('hidden');
                $('analyze-result').textContent = 'Image ready. Analyze to inspect pixels and channel views.';
                state.analysisInspectionPromise = ST3GGAnalysis.inspect(file, bytes);
            }
            const previous = previewURLs.get(panel); if (previous) URL.revokeObjectURL(previous);
            previewURLs.set(panel, url);
            const prefix = panel === 'encode' ? 'encode-carrier' : panel + '-image';
            $(`${prefix}-preview`).src = url;
            $(`${prefix}-preview`).classList.remove('hidden');
            $(`${prefix}-info`).textContent = `${file.name} | ${image.width}×${image.height}${panel === 'decode' ? jpeg ? ' (JPEG - F5 ready)' : png ? ' (PNG - Chunk ready)' : '' : ''}`;
            if (panel === 'encode') void PolyImageLibrary.remember(file.name, bytes).catch(() => {});
        } catch (error) { URL.revokeObjectURL(url); throw error; }
    }

    async function encodedArtifact() {
        const name = $('download-filename').value.trim() || 'stego_output';
        if (state.workflowResultKind === 'audio' && state.audioEncodedSamples) return T.artifact({ blob: encodeWAV(state.audioEncodedSamples, state.workflowAudioSampleRate || state.audioBuffer?.sampleRate, 1), name: name + '.wav', source: 'Encode audio' });
        if (state.encodedJpegResult) return T.artifact({ blob: new Blob([state.encodedJpegResult], { type: 'image/jpeg' }), name: name + '.jpg', source: 'Encode' });
        if (state.encodedPngChunkResult) return T.artifact({ blob: new Blob([state.encodedPngChunkResult], { type: 'image/png' }), name: name + '.png', source: 'Encode' });
        if (!state.encodedResult) throw new Error('Encode an image first.');
        const blob = await new Promise(resolve => state.encodedResult.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('The encoded image could not be prepared.');
        return T.artifact({ blob, name: name + '.png', source: 'Encode' });
    }

    function textArtifact(id, source) {
        const text = $(id).value;
        if (!text) throw new Error('Create an output first.');
        return T.artifact({ text, name: 'message.txt', source });
    }

    function actions(id) {
        const host = document.createElement('div'); host.className = 'result-actions'; $(id).append(host); return host;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const encodeActions = actions('encode-result');
        encodeActions.append($('encode-result').querySelector('button[onclick="downloadResult()"]'));
        T.mount(encodeActions, encodedArtifact);
        const decodeActions = $('download-extracted-btn').parentElement;
        decodeActions.classList.add('result-actions');
        T.mount(decodeActions, () => {
            if (!state.extractedData) throw new Error('Decode a payload first.');
            return fromBytes(state.extractedData, state.extractedFileName || 'extracted.bin', 'Decode');
        });
        for (const [id, source] of [['textlab-output', 'Text Lab encoded text'], ['textlab-decode-output', 'Text Lab decoded message'], ['zerowidth-output', 'Zero-width encoded text']]) {
            let host = $(id).nextElementSibling;
            if (!host || host.tagName !== 'DIV') {
                const next = host;
                host = document.createElement('div'); $(id).after(host);
                if (next?.tagName === 'BUTTON') host.append(next);
            }
            host.classList.add('result-actions');
            T.mount(host, () => textArtifact(id, source));
        }
    });
    async function recordEncoded() {
        if (state.workflowResultKind === 'audio') state.workflowAudioSampleRate = state.audioBuffer.sampleRate;
        $('encode-result').querySelector('h2').textContent = state.workflowResultKind === 'audio' ? 'Encoded audio' : 'Encoded image';
        return T.publish('encode.output', await encodedArtifact());
    }
    async function outputCanvas(key, canvas, name, source, panel) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not prepare the output image.');
        const value = T.publish(key, T.artifact({ blob, name, source }));
        showResult(key, value, panel); return value;
    }
    const resultURLs = new Map();
    function showResult(key, value, panel) {
        const id = 'workflow-result-' + key.replace(/[^a-z0-9]/gi, '-');
        let card = $(id); if (!card) { card = document.createElement('div'); card.id = id; card.className = 'card mt-4 workflow-result'; $(panel + '-panel').append(card); }
        if (resultURLs.has(key)) URL.revokeObjectURL(resultURLs.get(key));
        card.replaceChildren(); const heading = document.createElement('h2'); heading.className = 'card-title'; heading.textContent = value.name; card.append(heading);
        if (isImage(value)) { const image = document.createElement('img'); const url = URL.createObjectURL(value.blob); resultURLs.set(key, url); image.src = url; image.alt = value.name; image.className = 'image-preview'; card.append(image); }
        const info = document.createElement('p'); info.textContent = `${value.source} · ${formatSize(value.blob.size)}`; card.append(info);
        const host = document.createElement('div'); host.className = 'result-actions'; card.append(host);
        const download = document.createElement('button'); download.className = 'btn btn-secondary'; download.textContent = 'Download'; download.onclick = () => T.download(value); host.append(download); T.mount(host, () => value);
    }
    function attachArtifact(host, artifact) {
        const ext = { PNG: 'png', JPEG: 'jpg', ZIP: 'zip', PDF: 'pdf', GIF: 'gif', TEXT: 'txt', WAV: 'wav' }[artifact.format] || 'bin';
        const value = recordBytes('agent.' + artifact.id, artifact.data, artifact.filename || `artifact_${artifact.id}.${ext}`, 'Agent artifact');
        const actions = document.createElement('div'); actions.className = 'result-actions'; host.append(actions); T.mount(actions, () => value);
    }
    window.ST3GGWorkflow = Object.freeze({ loadMedia, encodedArtifact, fromBytes, fromFile, recordBytes, recordEncoded, outputCanvas, showResult, attachArtifact, reveal, textArtifact });
})();

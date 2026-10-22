/* Compatibility planning and final-image verification for independent payload steps. */
(function () {
    'use strict';
    const enc = new TextEncoder(), dec = new TextDecoder();
    const id = () => crypto.randomUUID();
    function create(method = 'LSB') { return { id: id(), method, payload: '', options: {}, enabled: true, status: 'Configured' }; }
    function steps(node) {
        if (!node.payloadSteps) node.payloadSteps = node.settings.method === 'none' ? [] : [{ id: id(), ...structuredClone(node.settings), enabled: true, status: node.imageDirty ? 'Configured' : 'Preserved / unverified' }];
        return node.payloadSteps;
    }
    function options(step) { return PolyWorkspace.options({ settings: step }); }
    function channels(step) {
        if (step.method === 'LSB') return new Set(options(step).channels.split('').map(c => 'RGB'.indexOf(c)));
        if (step.method === 'SPECTER') {
            const s = JSON.parse(options(step).steps);
            if (!Array.isArray(s) || !s.length) throw new Error('SPECTER needs channel steps.');
            return new Set(s.flatMap(s => s.channels));
        }
        return new Set([0, 1, 2]);
    }
    function compatibility(a, b) {
        if (a.method === 'PNGCHUNK' && b.method === 'PNGCHUNK') {
            const x = options(a), y = options(b);
            return x.keyword === y.keyword && x.chunkType === y.chunkType ? { ok: false, reason: 'Use distinct PNG chunk type / keyword addresses for separate payloads.' } : { ok: true, reason: 'Independent metadata addresses.' };
        }
        if (a.method === 'F5' || b.method === 'F5') return { ok: false, reason: 'F5 produces lossy JPEG and cannot preserve these PNG pixel or chunk encodings.' };
        if (a.method === 'PNGCHUNK' || b.method === 'PNGCHUNK') return { ok: true, ordered: true, reason: 'Pixel encoding first; metadata inserted afterward without re-encoding pixels.' };
        if (['LSB', 'SPECTER'].includes(a.method) && ['LSB', 'SPECTER'].includes(b.method)) {
            const x = channels(a), y = channels(b);
            if (![...x].some(c => y.has(c))) return { ok: true, reason: 'Disjoint colour channels, including their headers.' };
            return { ok: false, reason: 'These steps overwrite the same low-order channel bits and headers. Assign disjoint channels.' };
        }
        return { ok: false, reason: 'These implementations modify overlapping pixel or transform data. Their payloads cannot be isolated with the available settings.' };
    }
    function rules(list) {
        const active = list.filter(s => s.enabled !== false), conflicts = [];
        for (let a = 0; a < active.length; a++) for (let b = a + 1; b < active.length; b++) {
            try { const rule = compatibility(active[a], active[b]); if (!rule.ok) conflicts.push({ a: active[a], b: active[b], ...rule }); }
            catch (e) { conflicts.push({ a: active[a], b: active[b], ok: false, reason: e.message }); }
        }
        return { ok: !conflicts.length, conflicts, ordered: active.some(s => s.method === 'PNGCHUNK') && active.some(s => s.method !== 'PNGCHUNK') };
    }
    function data(step) { return step.filePayload ?? enc.encode(step.payload || ''); }
    function base64(bytes) {
        let out = ''; for (let i = 0; i < bytes.length; i += 16384) out += String.fromCharCode(...bytes.subarray(i, i + 16384));
        return btoa(out);
    }
    async function transform(bytes, compress) {
        const stream = new Blob([bytes]).stream().pipeThrough(compress ? new CompressionStream('deflate') : new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    function chunks(bytes) {
        if (PolyCore.format(bytes) !== 'png') throw new Error('PNG chunk payloads require PNG output.');
        const out = []; let at = 8;
        while (at + 12 <= bytes.length) {
            const view = new DataView(bytes.buffer, bytes.byteOffset + at, 4), size = view.getUint32(0);
            if (at + size + 12 > bytes.length) throw new Error('Invalid PNG chunk length.');
            const type = dec.decode(bytes.subarray(at + 4, at + 8)), body = bytes.subarray(at + 8, at + 8 + size);
            out.push({ type, body, raw: bytes.subarray(at, at + size + 12) }); at += size + 12;
            if (type === 'IEND') break;
        }
        if (!out.some(c => c.type === 'IEND')) throw new Error('PNG end chunk is missing.');
        return out;
    }
    async function writeChunk(bytes, step) {
        const o = options(step), keyword = o.keyword;
        if (!keyword || keyword.length > 79 || /[^\x20-\x7e\xa1-\xff]/.test(keyword)) throw new Error('PNG keyword must contain 1–79 Latin-1 characters.');
        const key = Uint8Array.from(keyword, c => c.charCodeAt(0)), text = enc.encode(base64(data(step)));
        const body = PolyCore.concat([key, new Uint8Array(o.chunkType === 'iTXt' ? 5 : o.chunkType === 'zTXt' ? 2 : 1), o.chunkType === 'zTXt' ? await transform(text, true) : text]);
        const packet = new Uint8Array(body.length + 12), view = new DataView(packet.buffer);
        view.setUint32(0, body.length); packet.set(enc.encode(o.chunkType), 4); packet.set(body, 8);
        view.setUint32(body.length + 8, PolyCore.crc(packet.subarray(4, body.length + 8)));
        const parts = [bytes.subarray(0, 8)];
        for (const c of chunks(bytes)) {
            const end = c.body.indexOf(0), keyText = end >= 0 ? String.fromCharCode(...c.body.subarray(0, end)) : '';
            if (c.type === 'IEND') parts.push(packet);
            if (!(c.type === o.chunkType && keyText === keyword)) parts.push(c.raw);
        }
        return PolyCore.concat(parts);
    }
    async function readChunk(bytes, step) {
        const o = options(step);
        for (const c of chunks(bytes)) {
            const end = c.body.indexOf(0);
            if (c.type !== o.chunkType || end < 0 || String.fromCharCode(...c.body.subarray(0, end)) !== o.keyword) continue;
            let text;
            if (c.type === 'zTXt') {
                try { text = await transform(c.body.subarray(end + 2), false); }
                catch { text = c.body.subarray(end + 2); } // Existing ST3GG legacy zTXt files.
            } else if (c.type === 'iTXt') {
                let at = end + 3;
                for (let i = 0; i < 2; i++) { while (at < c.body.length && c.body[at] !== 0) at++; at++; }
                text = c.body.subarray(at);
                if (c.body[end + 1]) text = await transform(text, false);
            } else text = c.body.subarray(end + 1);
            return Uint8Array.from(atob(dec.decode(text)), c => c.charCodeAt(0));
        }
        throw new Error(`No ${o.chunkType} payload at keyword ${o.keyword}.`);
    }
    async function decodeStep(step, image) {
        return step.method === 'PNGCHUNK' ? readChunk(image, step) : PolyWorkspace.decodePayload({ settings: step }, image, await PolyWorkspace.canvasOf(image));
    }
    function adapter(legacy) {
        return { validateImage: legacy.validateImage,
            async encode(node, signal) {
                const list = steps(node).filter(s => s.enabled !== false), rule = rules(list);
                if (!rule.ok) throw new Error(rule.conflicts.map(c => `${c.a.method} + ${c.b.method}: ${c.reason}`).join('\n'));
                let image = node.image;
                if (list.length && !list.some(s => s.method === 'F5') && PolyCore.format(image) !== 'png') image = await PolyWorkspace.canvasBytes(await PolyWorkspace.canvasOf(image));
                const ordered = [...list.filter(s => s.method !== 'PNGCHUNK'), ...list.filter(s => s.method === 'PNGCHUNK')];
                for (const step of ordered) {
                    PolyCore.check(signal);
                    if (!data(step).length) throw new Error(`${step.method}: supply a payload.`);
                    image = step.method === 'PNGCHUNK' ? await writeChunk(image, step) : (await legacy.encode({ ...node, image, settings: step }, signal)).bytes;
                }
                for (const step of list) {
                    PolyCore.check(signal);
                    try {
                        const recovered = await decodeStep(step, image);
                        if (!recovered || !PolyCore.equal(recovered, data(step))) throw new Error('Recovered bytes differ from the configured payload.');
                    } catch (e) { throw new Error(`${step.method} / ${step.fileName || 'text'}: final-image verification failed. ${e.message}`); }
                }
                return { bytes: image, status: list.length ? `${list.length} payloads decoded from the final image and byte-verified.` : 'Image bytes preserved.' };
            }
        };
    }
    window.PolyPayloads = { create, steps, options, compatibility, rules, data, decodeStep, adapter };
})();

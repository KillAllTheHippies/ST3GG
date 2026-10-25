/* Browser-local ZIP engine. No instruction-file content is evaluated. */
(function (global) {
    'use strict';
    const utf8 = new TextEncoder();
    const empty = new Uint8Array();
    // ZIP32 field widths are format constraints, not a workspace resource policy.
    const limits = { bytes: Infinity, entries: 65534 };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
        let value = index;
        for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
        return value >>> 0;
    });
    function check(signal) { if (signal?.aborted) throw new Error('Cancelled. Workspace edits are retained.'); }
    function equal(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
    function crc(bytes) {
        let value = 0xffffffff;
        for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
        return (value ^ 0xffffffff) >>> 0;
    }
    function path(name) {
        if (!name || name.includes('\\') || name.startsWith('/') || /[\x00-\x1f]/.test(name) ||
            /^[a-z]:/i.test(name) || name.replace(/\/$/, '').split('/').some(p => !p || p === '.' || p === '..'))
            throw new Error('Use a relative path with / separators, without empty, . or .. segments.');
        if (utf8.encode(name).length > 65535) throw new Error('Filename is too long for ZIP.');
        return name;
    }
    function collision(entries, name, except) {
        path(name);
        const stem = name.replace(/\/$/, '');
        if (entries.some(e => e !== except && (e.name.replace(/\/$/, '') === stem ||
            (!name.endsWith('/') && e.name.startsWith(stem + '/')) ||
            (!e.name.endsWith('/') && name.startsWith(e.name + '/')))))
            throw new Error(`Path collision: ${name}. Choose another name or explicitly replace the existing entry.`);
    }
    function concat(parts) {
        const length = parts.reduce((n, p) => n + p.length, 0);
        let bytes;
        try { bytes = new Uint8Array(length); }
        catch { throw new Error(`The browser could not allocate ${length.toLocaleString()} bytes for this operation. Inspect the size map or reduce carrier dimensions.`); }
        let at = 0;
        for (const p of parts) { bytes.set(p, at); at += p.length; }
        return bytes;
    }
    function comment(bytes, label) {
        bytes = bytes ?? empty;
        if (!(bytes instanceof Uint8Array)) throw new Error(`${label} must be bytes.`);
        if (bytes.length > 65535) throw new Error(`${label} exceeds the ZIP format's 65,535-byte comment field. Shorten the comment; workspace edits are retained.`);
        return bytes;
    }
    function withoutCommentExtra(extra) {
        const parts = [], view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
        for (let at = 0; at < extra.length;) {
            if (at + 4 > extra.length) throw new Error('Invalid ZIP extra fields; cannot update the entry comment safely.');
            const tag = view.getUint16(at, true), end = at + 4 + view.getUint16(at + 2, true);
            if (end > extra.length) throw new Error('Invalid ZIP extra fields; cannot update the entry comment safely.');
            // A changed UTF-8 comment supersedes an imported Unicode Comment extra.
            if (tag !== 0x6375) parts.push(extra.subarray(at, end));
            at = end;
        }
        return concat(parts);
    }
    function format(bytes) {
        if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'png';
        if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
        return null;
    }
    async function unpack(raw, signal) {
        check(signal);
        if (raw.flags & 1) throw new Error('Encrypted ZIP entry: original compressed bytes retained; extraction is unavailable.');
        let bytes;
        if (raw.method === 0) bytes = raw.packed.slice();
        else if (raw.method === 8) {
            const reader = new Blob([raw.packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
            const chunks = []; let total = 0;
            try {
                while (true) {
                    check(signal);
                    const { value, done } = await reader.read();
                    if (done) break;
                    total += value.length;
                    if (total > raw.size) throw new Error('Inflated entry exceeds its declared size.');
                    chunks.push(value);
                }
            } catch (error) { await reader.cancel(); throw error; }
            bytes = concat(chunks);
        } else throw new Error(`ZIP compression method ${raw.method} is unsupported; original bytes retained.`);
        if (bytes.length !== raw.size || crc(bytes) !== raw.crc) throw new Error('ZIP size or CRC validation failed; original compressed bytes retained.');
        return bytes;
    }
    async function readZip(bytes, signal) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const u16 = n => view.getUint16(n, true), u32 = n => view.getUint32(n, true);
        let end = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { end = i; break; }
        }
        if (end < 0) throw new Error('No readable ZIP end directory.');
        if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw new Error('Multi-volume ZIP is unsupported.');
        const count = u16(end + 10), cdSize = u32(end + 12), declared = u32(end + 16);
        if (count === 65535 || declared === 0xffffffff || cdSize === 0xffffffff) throw new Error('ZIP64 is unsupported; keep the original file.');
        let pos = end - cdSize;
        const base = pos - declared;
        if (pos < 0 || base < 0) throw new Error('Invalid ZIP directory offsets.');
        let prefixEnd = pos;
        const entries = [], ranges = [];
        for (let i = 0; i < count; i++) {
            check(signal);
            if (pos + 46 > end || u32(pos) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
            const flags = u16(pos + 8), method = u16(pos + 10), packedSize = u32(pos + 20), size = u32(pos + 24);
            const nl = u16(pos + 28), xl = u16(pos + 30), cl = u16(pos + 32), local = base + u32(pos + 42);
            if (u16(pos + 34) || size === 0xffffffff || packedSize === 0xffffffff) throw new Error('ZIP64 or multi-volume entry is unsupported.');
            if (pos + 46 + nl + xl + cl > end || local < 0 || local + 30 > end - cdSize || u32(local) !== 0x04034b50)
                throw new Error('Invalid ZIP entry offsets.');
            const nameBytes = bytes.slice(pos + 46, pos + 46 + nl);
            if (!(flags & 0x800) && nameBytes.some(x => x > 127)) throw new Error('Legacy non-UTF-8 ZIP filenames are unsupported; original file is unchanged.');
            const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
            collision(entries, name);
            const dataStart = local + 30 + u16(local + 26) + u16(local + 28), dataEnd = dataStart + packedSize;
            if (dataEnd > end - cdSize || u16(local + 6) !== flags || u16(local + 8) !== method ||
                !equal(nameBytes, bytes.subarray(local + 30, local + 30 + u16(local + 26))))
                throw new Error(`Invalid local ZIP header for ${name}.`);
            ranges.push([local, dataEnd]);
            prefixEnd = Math.min(prefixEnd, local);
            const raw = { flags, method, size, crc: u32(pos + 16), packed: bytes.slice(dataStart, dataEnd),
                time: u16(pos + 12), date: u16(pos + 14), attrs: u32(pos + 38),
                version: u16(pos + 6),
                localExtra: bytes.slice(local + 30 + u16(local + 26), dataStart),
                centralExtra: bytes.slice(pos + 46 + nl, pos + 46 + nl + xl),
                commentBytes: bytes.slice(pos + 46 + nl + xl, pos + 46 + nl + xl + cl) };
            const entry = { name, raw, commentBytes: raw.commentBytes, bytes: null, issue: '', kind: name.endsWith('/') ? 'folder' : 'file' };
            {
                try { entry.bytes = await unpack(raw, signal); }
                catch (error) { check(signal); entry.issue = error.message; }
            }
            entries.push(entry);
            pos += 46 + nl + xl + cl;
            if (i % 16 === 0) await tick();
        }
        if (pos !== end) throw new Error('ZIP directory size does not match its entries.');
        ranges.sort((a, b) => a[0] - b[0]);
        if (ranges.some((r, i) => i && r[0] < ranges[i - 1][1])) throw new Error('Overlapping ZIP entries are unsupported.');
        return { image: bytes.slice(0, prefixEnd), entries, commentBytes: bytes.slice(end + 22) };
    }
    async function writeZip(entries, prefix = new Uint8Array(), signal, commentBytes = empty) {
        if (entries.length > limits.entries) throw new Error('This archive requires ZIP64 directory counts; the current writer supports ZIP32. The workspace is retained.');
        const archiveComment = comment(commentBytes, 'Archive comment');
        const locals = [prefix], directory = [];
        let offset = prefix.length;
        for (const entry of entries) {
            check(signal);
            const name = utf8.encode(path(entry.name));
            const raw = entry.bytes != null ? { ...entry.raw, packed: entry.bytes, size: entry.bytes.length, crc: crc(entry.bytes), method: 0, flags: 0x800 } : entry.raw;
            if (!raw) throw new Error(`Missing contents: ${entry.name}`);
            const entryComment = comment(entry.commentBytes ?? entry.raw?.commentBytes, `Comment for ${entry.name}`);
            const sameComment = !!entry.raw && equal(entryComment, entry.raw.commentBytes || empty);
            const legacyComment = sameComment && !(entry.raw.flags & 0x800) && entry.commentEncoding !== 'utf8';
            if (legacyComment && name.some(byte => byte > 127) && entryComment.some(byte => byte > 127))
                throw new Error(`${entry.name}: re-save its legacy ZIP comment as UTF-8 before using a non-ASCII filename. Original comment bytes cannot share the filename's UTF-8 flag.`);
            const commentChanged = !sameComment || (entry.commentEncoding === 'utf8' && !(entry.raw?.flags & 0x800));
            // Keep descriptor flags and extras for opaque encrypted entries. Traditional
            // encryption uses this flag to choose its password-check byte.
            const flags = (raw.flags & ~0x800) | (legacyComment && !name.some(byte => byte > 127) ? 0 : 0x800);
            let localExtra = raw.localExtra || empty, centralExtra = raw.centralExtra || empty;
            if (commentChanged) { localExtra = withoutCommentExtra(localExtra); centralExtra = withoutCommentExtra(centralExtra); }
            const local = new Uint8Array(30 + name.length + localExtra.length), lv = new DataView(local.buffer);
            const central = new Uint8Array(46 + name.length + centralExtra.length + entryComment.length), cv = new DataView(central.buffer);
            lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, raw.version || 20, true);
            cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, raw.version || 20, true);
            for (const [v, shift] of [[lv, 0], [cv, 2]]) {
                v.setUint16(6 + shift, flags, true); v.setUint16(8 + shift, raw.method, true);
                v.setUint16(10 + shift, raw.time || 0, true); v.setUint16(12 + shift, raw.date || 33, true);
                v.setUint32(14 + shift, raw.crc, true); v.setUint32(18 + shift, raw.packed.length, true);
                v.setUint32(22 + shift, raw.size, true); v.setUint16(26 + shift, name.length, true);
            }
            local.set(name, 30); central.set(name, 46);
            lv.setUint16(28, localExtra.length, true); local.set(localExtra, 30 + name.length);
            cv.setUint16(30, centralExtra.length, true); central.set(centralExtra, 46 + name.length);
            cv.setUint16(32, entryComment.length, true); central.set(entryComment, 46 + name.length + centralExtra.length);
            cv.setUint32(38, raw.attrs || (entry.name.endsWith('/') ? 16 : 0), true);
            cv.setUint32(42, offset, true);
            const descriptor = new Uint8Array(flags & 8 ? 16 : 0);
            if (descriptor.length) {
                const dv = new DataView(descriptor.buffer);
                dv.setUint32(0, 0x08074b50, true); dv.setUint32(4, raw.crc, true);
                dv.setUint32(8, raw.packed.length, true); dv.setUint32(12, raw.size, true);
            }
            locals.push(local, raw.packed, descriptor); directory.push(central);
            offset += local.length + raw.packed.length + descriptor.length;
            if (offset > 0xffffffff) throw new Error('This output requires ZIP64 offsets; the current writer supports ZIP32. The workspace is retained.');
            await tick();
        }
        const cd = concat(directory), end = new Uint8Array(22 + archiveComment.length), ev = new DataView(end.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
        ev.setUint32(12, cd.length, true); ev.setUint32(16, offset, true);
        ev.setUint16(20, archiveComment.length, true); end.set(archiveComment, 22);
        return concat([...locals, cd, end]);
    }
    let serial = 0;
    function layer(name = 'outer.png', image = null) {
        return { id: ++serial, name, image, entries: [], commentBytes: new Uint8Array(), parent: null, original: null, dirty: true,
            imageDirty: false, settings: { method: 'none', payload: '', options: {} }, validation: 'Not built' };
    }
    function dirty(node) { for (let n = node; n; n = n.parent) { n.dirty = true; n.validation = 'Requires rebuild'; } }
    function layerPath(node) {
        const names = [];
        for (let n = node; n; n = n.parent) names.push(n.name);
        return names.reverse().join(' → ');
    }
    async function open(bytes, name, validateImage, signal, progress = () => {}) {
        const root = layer(name), queue = [{ node: root, bytes }];
        while (queue.length) {
            check(signal);
            const item = queue.shift(), node = item.node;
            progress(`Inspecting ${layerPath(node)}`);
            if (!format(item.bytes)) throw new Error(`${node.name}: only PNG and JPEG carriers are supported.`);
            await validateImage(item.bytes);
            const zip = await readZip(item.bytes, signal);
            if (!zip.image.length) throw new Error(`${node.name}: missing image prefix.`);
            await validateImage(zip.image);
            node.image = zip.image; node.original = item.bytes; node.entries = zip.entries; node.commentBytes = zip.commentBytes; node.dirty = false;
            node.validation = 'Imported image and ZIP directory readable; image payload unverified.';
            for (const entry of node.entries) {
                if (entry.kind === 'folder' || !entry.bytes || !format(entry.bytes)) continue;
                try {
                    // A readable directory AND a valid image prefix are required, not a signature match.
                    const nested = await readZip(entry.bytes, signal);
                    await validateImage(nested.image);
                    const child = layer(entry.name, nested.image);
                    child.parent = node; entry.child = child; entry.kind = 'layer';
                    queue.push({ node: child, bytes: entry.bytes });
                } catch (error) {
                    check(signal);
                    entry.issue = `Ordinary image / no inspectable nested ZIP: ${error.message}`;
                }
            }
            await tick();
        }
        return root;
    }
    async function build(root, adapter, signal, progress = () => {}) {
        const stack = [{ node: root, visited: false }], results = new Map(), staged = [];
        while (stack.length) {
            check(signal);
            const { node, visited } = stack.pop();
            if (!visited) {
                stack.push({ node, visited: true });
                for (const entry of node.entries) if (entry.child) stack.push({ node: entry.child, visited: false });
                continue;
            }
            progress(`Building and validating ${layerPath(node)}`); await tick(); check(signal);
            try {
                let image = node.image, payloadStatus = 'Image payload unverified (preserved bytes).';
                if (!image) throw new Error('Upload or generate a carrier.');
                if (node.imageDirty) {
                    const encoded = await adapter.encode(node, signal);
                    image = encoded.bytes; payloadStatus = encoded.status;
                }
                const extension = format(image);
                if (!extension || !(extension === 'jpg' ? /\.jpe?g$/i : /\.png$/i).test(node.name))
                    throw new Error(`Output filename must end in .${extension || 'png or jpg'}.`);
                const entries = node.entries.map(e => ({ ...e, bytes: e.child ? results.get(e.child) : e.bytes }));
                const output = !node.dirty && node.original ? node.original : await writeZip(entries, image, signal, node.commentBytes);
                await adapter.validateImage(output);
                const read = await readZip(output, signal);
                if (!equal(read.image, image) || read.entries.length !== entries.length) throw new Error('Image prefix or entry count changed unexpectedly.');
                if (!equal(read.commentBytes, node.commentBytes || empty)) throw new Error('Archive comment changed unexpectedly.');
                let opaque = 0;
                for (let i = 0; i < entries.length; i++) {
                    const want = entries[i], got = read.entries[i];
                    if (want.name !== got.name) throw new Error(`Entry path mismatch: ${want.name}`);
                    if (!equal(want.commentBytes ?? want.raw?.commentBytes ?? empty, got.commentBytes)) throw new Error(`Entry comment changed: ${want.name}`);
                    if (want.bytes != null) {
                        if (!got.bytes || !equal(want.bytes, got.bytes)) throw new Error(`Extracted contents differ: ${want.name}`);
                    } else {
                        opaque++;
                        if (!equal(want.raw.packed, got.raw.packed)) throw new Error(`Opaque entry changed: ${want.name}`);
                    }
                }
                const status = `${opaque ? 'Partial validation' : 'Structure verified'}: image decoded, ${entries.length - opaque} entries extracted and byte-checked.${opaque ? ` ${opaque} opaque entries preserved, extraction unverified.` : ''} ${payloadStatus}`;
                results.set(node, output); staged.push({ node, output, image, status, archiveEntries: read.entries });
            } catch (error) { throw new Error(`${layerPath(node)}: ${error.message}`); }
        }
        check(signal);
        // Commit only after the entire requested subtree succeeds.
        for (const { node, output, image, status, archiveEntries } of staged) {
            node.original = output; node.image = image; node.imageDirty = false; node.dirty = false; node.validation = status;
            for (let i = 0; i < node.entries.length; i++) {
                node.entries[i].raw = archiveEntries[i].raw;
                node.entries[i].commentBytes = archiveEntries[i].commentBytes;
                if (node.entries[i].child) node.entries[i].bytes = results.get(node.entries[i].child);
            }
        }
        return results.get(root);
    }
    global.PolyCore = { limits, tick, check, equal, crc, path, collision, concat, format, unpack, readZip, writeZip, layer, dirty, open, build };
})(globalThis);

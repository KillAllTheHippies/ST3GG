/* Physical output accounting. Child archive bytes are included once, in their parent. */
(function () {
    'use strict';
    const encoder = new TextEncoder();
    function dimensions(bytes) {
        if (!bytes) return null;
        if (PolyCore.format(bytes) === 'png' && bytes.length >= 24) {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            return { width: view.getUint32(16), height: view.getUint32(20) };
        }
        if (PolyCore.format(bytes) === 'jpg') {
            let at = 2;
            while (at + 8 < bytes.length) {
                if (bytes[at++] !== 255) break;
                while (bytes[at] === 255) at++;
                const marker = bytes[at++];
                if (marker === 0xda || marker === 0xd9) break;
                const length = bytes[at] * 256 + bytes[at + 1];
                if (length < 2) break;
                if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
                    return { width: bytes[at + 5] * 256 + bytes[at + 6], height: bytes[at + 3] * 256 + bytes[at + 4] };
                at += length;
            }
        }
        return null;
    }
    function measure(root) {
        const records = new Map(), stack = [{ node: root, ready: false }];
        while (stack.length) {
            const { node, ready } = stack.pop();
            if (!ready) {
                stack.push({ node, ready: true });
                for (const e of node.entries) if (e.child) stack.push({ node: e.child, ready: false });
                continue;
            }
            const preserved = !node.dirty && !!node.original, image = node.image?.length || 0;
            const parts = [{ name: 'Image carrier', kind: 'carrier', bytes: image, node }];
            let overhead = 22;
            for (const e of node.entries) {
                const child = e.child && records.get(e.child);
                const bytes = preserved ? e.raw?.packed.length ?? child?.total ?? e.bytes?.length ?? 0 : child?.total ?? e.bytes?.length ?? e.raw?.packed.length ?? 0;
                parts.push({ name: e.name, kind: child ? 'nested' : 'file', bytes, node: e.child || null, child, entry: e });
                overhead += 76 + 2 * encoder.encode(e.name).length;
                if (!child && e.bytes == null && e.raw) overhead += (e.raw.localExtra?.length || 0) + (e.raw.centralExtra?.length || 0) + (e.raw.flags & 8 ? 16 : 0);
            }
            const content = parts.reduce((n, part) => n + part.bytes, 0);
            if (preserved) overhead = Math.max(0, node.original.length - content);
            const total = preserved ? node.original.length : content + overhead;
            parts.push({ name: 'ZIP directory & headers', kind: 'overhead', bytes: overhead });
            records.set(node, { node, image, total, overhead, parts, exact: preserved, pendingEncoding: node.imageDirty, dimensions: dimensions(node.image) });
        }
        const record = records.get(root);
        // A working-copy estimate, not a process-memory measurement or enforced budget.
        let workingBytes = record.total, imageBytes = 0, fileBytes = 0, headers = 0;
        for (const r of records.values()) {
            workingBytes += r.total * 2;
            if (r.dimensions) workingBytes += r.dimensions.width * r.dimensions.height * 8;
            imageBytes += r.image; headers += r.overhead;
            fileBytes += r.parts.filter(p => p.kind === 'file').reduce((n, p) => n + p.bytes, 0);
        }
        return { ...record, records, workingBytes, imageBytes, fileBytes, headers };
    }
    function format(value) {
        if (value < 1024) return `${value.toLocaleString()} B`;
        const units = ['KB', 'MB', 'GB', 'TB']; let n = value / 1024, unit = 0;
        while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
        return `${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 1 })} ${units[unit]}`;
    }
    function advisory(measurement, baseline = measurement.total, deviceMemory = navigator.deviceMemory) {
        const growing = measurement.total > baseline * 2 && measurement.total - baseline > 2 * 1024 * 1024;
        const memoryPressure = deviceMemory && measurement.workingBytes > deviceMemory * 1024 ** 3 * .15;
        // These are advisory triggers. They never prohibit a build or truncate contents.
        if (!(growing || memoryPressure || measurement.total >= 25 * 1024 * 1024)) return '';
        const dominant = measurement.imageBytes >= measurement.fileBytes ? 'Carrier images' : 'Contained files';
        return `${growing ? `Output has grown ${(measurement.total / baseline).toFixed(1)}× since opening. ` : ''}${dominant} contribute most of the bytes. ${memoryPressure ? 'Nested rebuild copies may put pressure on available browser memory. ' : ''}Open the size map to inspect each contribution.`;
    }
    window.PolySize = { measure, format, dimensions, advisory };
})();

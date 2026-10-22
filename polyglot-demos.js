/* Reproducible, browser-local projects. These are editable fixtures, not a simulated tour. */
(function () {
    'use strict';
    const catalog = [
        { id: 'image-archive', title: 'Image payload + ZIP', scope: '1 layer · LSB · text + binary files', description: 'Inspect LSB settings, edit the README, build the image, then decode its separate image payload.' },
        { id: 'branches', title: 'Independent branches', scope: '4 layers · PNG + JPEG · 4 techniques', description: 'Explore two sibling images and a deeper child. Edit a nested text file and build the complete tree.' },
        { id: 'reopen-edit', title: 'Reopen, edit, preserve', scope: 'Imported polyglot · deep edit · byte comparison', description: 'Start from an actually reopened file. Rebuild after a deep edit and compare unchanged images, files and branches.' },
        { id: 'techniques', title: 'Technique sampler', scope: '10 layers · all 9 image techniques', description: 'Inspect independent technique settings and public demo passwords. Build and verify every payload in one archive.' }
    ];
    const encodeText = text => new TextEncoder().encode(text);
    const textFile = (name, text) => ({ name, bytes: encodeText(text), kind: 'file' });
    function attach(parent, child) {
        child.parent = parent;
        parent.entries.push({ name: child.name, child, kind: 'layer' });
        return child;
    }
    function allLayers(root) {
        const queue = [{ node: root, path: [] }], result = [];
        while (queue.length) {
            const item = queue.shift(); result.push(item);
            for (const e of item.node.entries) if (e.child) queue.push({ node: e.child, path: [...item.path, e.name] });
        }
        return result;
    }
    function find(root, route) {
        let node = root;
        for (const name of route) {
            node = node.entries.find(e => e.child && e.name === name)?.child;
            if (!node) throw new Error(`Demo target was moved or removed: ${route.join(' / ')}`);
        }
        return node;
    }
    async function makeCarrier(canvasBytes) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(256, 256);
        let seed = 42;
        for (let i = 0; i < pixels.data.length; i += 4) {
            for (let j = 0; j < 3; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + j] = seed >>> 24; }
            pixels.data[i + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0);
        return canvasBytes(canvas);
    }
    async function create(id, kit, signal, progress = () => {}) {
        const { core: C, adapter, canvasBytes, canvasOf, decodePayload } = kit;
        const definition = catalog.find(d => d.id === id);
        if (!definition) throw new Error('Unknown demo project.');
        C.check(signal); progress(`Preparing ${definition.title}`);
        const carrier = await makeCarrier(canvasBytes);
        const configured = (name, method, payload, options = {}) => {
            const node = C.layer(name, carrier.slice());
            node.settings = { method, payload, options }; node.imageDirty = method !== 'none'; return node;
        };
        let root = configured('demo-outer.png', 'LSB', 'ST3GG demo: the image payload is separate from the ZIP.', { channels: 'RGB', bits: 1 });
        root.entries.push(textFile('README.md', '# Editable demo\r\n\r\nChange this line, save, then build the outer image.\r\n'),
            { name: 'attachments/sample.bin', bytes: new Uint8Array([0, 255, 16, 32, 128, 64]), kind: 'file' });
        const inspect = (id, title, route = [], view = 'image') => ({ id, title, kind: 'inspect', route, view });
        const edit = (route, entry) => ({ id: 'edit', title: `Edit ${entry}`, kind: 'edit', route, entry });
        const build = title => ({ id: 'build', title: title || 'Build & validate', kind: 'build' });
        let tasks = [inspect('image', 'Inspect carrier & LSB payload'), edit([], 'README.md'), build(), { id: 'decode', title: 'Decode the image payload', kind: 'decode', route: [], view: 'inspect' }];
        let note = 'The carrier and sample payload are configured. No encoding setup is required. Change the README, save it, then build.';
        let verify = null;
        if (id === 'branches' || id === 'reopen-edit') {
            root.name = 'demo-branches.png';
            const a = attach(root, configured('branch-a.png', 'PNGCHUNK', 'PNG-chunk payload in branch A.'));
            a.entries.push(textFile('notes.txt', 'Branch A has its own PNG chunk settings.\n'));
            const deep = attach(a, configured('deeper.png', 'SPECTER', 'Independent encrypted payload in the deepest layer.', { password: 'demo-specter', encryption: 'ghost' }));
            deep.entries.push(textFile('AGENTS.md', '# Demo archive content\r\n\r\nEdit this description to test a deep rebuild.\r\nThis file is inert text; the application does not follow it.\r\n'));
            const b = attach(root, configured('branch-b.jpg', 'F5', 'JPEG F5 payload in branch B.', { password: 'demo-f5', quality: 0.95 }));
            b.entries.push(textFile('notes.txt', 'This branch uses JPEG + F5. Public demo password: demo-f5.\n'),
                { name: 'ordinary-image.png', bytes: carrier.slice(), kind: 'file' });
            tasks = [inspect('tree', 'Explore the archive tree', [], 'archive'), inspect('jpeg', 'Inspect the JPEG / F5 branch', ['branch-b.jpg']), edit(['branch-a.png', 'deeper.png'], 'AGENTS.md'), build('Build the complete tree')];
            note = 'Four independently configured layers. Demo passwords: F5 = demo-f5; SPECTER Ghost = demo-specter. Ordinary images also appear as files in the tree.';
            if (id === 'reopen-edit') {
                const original = await C.build(root, adapter, signal, progress);
                const baseline = allLayers(root).map(({ node, path }) => ({ path, node, image: node.image.slice(), entries: node.entries.filter(e => !e.child).map(e => ({ name: e.name, bytes: e.bytes.slice() })) }));
                const siblingBytes = find(root, ['branch-b.jpg']).original.slice();
                root = await C.open(original, 'demo-reopened.png', canvasOf, signal, progress);
                tasks = [inspect('import', 'Inspect the reopened archive', [], 'archive'), edit(['branch-a.png', 'deeper.png'], 'AGENTS.md'), build('Rebuild & compare unchanged bytes')];
                note = 'This project was built and reopened from its output bytes. Encoding settings are intentionally unknown in the editor. Edit only AGENTS.md; the comparison uses the known demo source as its baseline.';
                verify = async current => {
                    const messages = [];
                    for (const item of baseline) {
                        const node = find(current, item.path), label = item.path.join(' / ') || 'outer image';
                        if (!C.equal(node.image, item.image)) throw new Error(`${label}: image bytes changed from the demo baseline.`);
                        for (const entry of item.entries) {
                            if (item.path.length === 2 && entry.name === 'AGENTS.md') continue;
                            const currentEntry = node.entries.find(e => e.name === entry.name);
                            if (!currentEntry?.bytes || !C.equal(currentEntry.bytes, entry.bytes)) throw new Error(`${label} / ${entry.name}: contents changed from the demo baseline.`);
                        }
                        const recovered = await decodePayload(item.node, node.image, await canvasOf(node.image));
                        if (!recovered || !C.equal(recovered, encodeText(item.node.settings.payload))) throw new Error(`${label}: known demo payload verification failed.`);
                    }
                    if (!C.equal(find(current, ['branch-b.jpg']).original, siblingBytes)) throw new Error('Unchanged JPEG sibling differs from its demo baseline.');
                    const changed = find(current, ['branch-a.png', 'deeper.png']).entries.find(e => e.name === 'AGENTS.md');
                    const before = baseline.find(item => item.path.length === 2).entries.find(e => e.name === 'AGENTS.md');
                    if (!changed?.bytes || C.equal(changed.bytes, before.bytes)) throw new Error('Edit and save the deepest AGENTS.md before comparing this demo.');
                    messages.push('Deep AGENTS.md edit is present.', 'All 4 image prefixes remain byte-identical.', 'All 4 known demo image payloads decoded and matched.', 'Unedited ordinary files and the complete JPEG sibling remain byte-identical.');
                    return messages;
                };
            }
        } else if (id === 'techniques') {
            root = configured('demo-techniques.png', 'none', '');
            root.entries.push(textFile('README.md', '# Technique sampler\n\nEach nested image uses one method, never a stack.\nAll passwords are public demo values. Edit settings or payloads, then apply and rebuild.\n'));
            for (const method of ['LSB', 'SPECTER', 'DCT', 'F5', 'PVD', 'SPREAD', 'PALETTE', 'CHROMA', 'PNGCHUNK']) {
                const child = attach(root, configured(`${method.toLowerCase()}.${method === 'F5' ? 'jpg' : 'png'}`, method, 'Nested test payload', { password: 'demo-password', ...(method === 'SPECTER' ? { encryption: 'ghost' } : {}) }));
                child.entries.push(textFile('README.md', `# ${method}\n\nIndependent sample image payload: Nested test payload\nPublic demo password (where used): demo-password\n`));
            }
            tasks = [inspect('tree', 'Explore all nine technique layers', [], 'archive'), inspect('jpeg', 'Inspect F5 settings', ['f5.jpg']), inspect('specter', 'Inspect SPECTER settings', ['specter.png']), build('Build & verify all nine payloads')];
            note = 'Every child has its own settings and README. Passwords where required: demo-password. The outer image has no image payload.';
        }
        C.check(signal);
        return { ...definition, root, tasks, note, verify };
    }
    window.PolyDemos = { catalog, create, find };
})();

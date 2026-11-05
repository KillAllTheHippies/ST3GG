/* Standalone traversal guidance for a receiving agent with no application UI. */
(() => {
    'use strict';
    const quoted = value => JSON.stringify(String(value));
    function payload(node, step, options) {
        const target = step.filePayload ? `file ${quoted(step.fileName || 'payload.bin')}` : 'UTF-8 text';
        let action;
        if (step.method === 'PNGCHUNK') {
            action = `Read the ${options.chunkType} chunk with keyword ${quoted(options.keyword)} in ${quoted(node.name)}. ${options.chunkType === 'zTXt' ? 'Inflate its compressed text, then base64-decode it' : 'Base64-decode its text'} to recover ${target}.`;
        } else {
            const settings = Object.entries(options).filter(([key]) => !/password|key|secret/i.test(key)).map(([key,value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`).join(', ');
            action = `Recover ${target} from ${quoted(node.name)} using ${step.method}${settings ? ` (${settings})` : ''}. Preserve the original image bytes; parse the decoder's payload framing before interpreting the recovered bytes.`;
            if (options.password || options.encryption && options.encryption !== 'none') action += ' Obtain the required password from the supplied context.';
        }
        return action + (step.filePayload ? ` Save the recovered bytes as ${quoted(step.fileName || 'payload.bin')} and inspect that file for the next step.` : ' Read the recovered text for the next step.');
    }
    function layer(node, steps, getOptions) {
        const children = node.entries.filter(entry => entry.child), files = node.entries.filter(entry => !entry.child && entry.kind !== 'folder' && !/^(?:AGENTS|README)\.md$|^instructions\.txt$/i.test(entry.name));
        const lines = [];
        for (const entry of children) {
            const next = entry.child.entries.find(e => /^(?:AGENTS|README)\.md$|^instructions\.txt$/i.test(e.name));
            lines.push(`Treat ${quoted(entry.name)}, enclosed in this archive, as both an image and a ZIP archive. Extract its ZIP without re-saving the image${next ? ` and read ${quoted(next.name)} inside for the next step` : ' and inspect its contents'}.`);
        }
        for (const step of steps.filter(step => step.enabled !== false && !step.linkedInstructions)) lines.push(payload(node, step, getOptions(step)));
        if (files.length) lines.push(`Inspect ${files.map(entry => quoted(entry.name)).join(', ')} from this ZIP as ${files.length === 1 ? 'the attached file' : 'separate attachments'}.`);
        if (!children.length && !steps.some(step => step.enabled !== false) && !files.length) lines.push('This is the final layer; no further images or payloads are included.');
        return lines.join('\n');
    }
    window.PolyInstructions = Object.freeze({ payload, layer });
})();

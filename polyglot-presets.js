/* Complete editable run recipes. Image creation defaults to AI and remains configurable. */
(function () {
    'use strict';
    const list = [], add = (id, title, group, count, extra = {}) => list.push({ id, title, group, count, source: 'ai', shape: 'chain', description: `${count} ${count === 1 ? 'layer' : 'layers'}`, ...extra });
    add('container','Image + ZIP','Containers',1,{ files:'basic' });
    add('text','Text payload + ZIP','Containers',1,{ method:'LSB',files:'basic' });
    add('file','File payload + ZIP','Containers',1,{ method:'LSB',filePayload:true,files:'basic' });
    add('instructions','Instructions + attachments','Containers',1,{ files:'instructions' });
    add('gallery','Image gallery','Containers',1,{ files:'gallery' });
    add('folders','Folder archive','Containers',1,{ files:'folders' });
    add('chain3','Three-layer chain','Structures',3,{ files:'notes',names:['outer','inner','core'] });
    add('chain5','Five-layer chain','Structures',5,{ files:'notes' });
    add('branches2','Two branches','Structures',3,{ shape:'branches',files:'notes' });
    add('branches4','Four branches','Structures',5,{ shape:'branches',files:'notes' });
    add('deep-branch','Branch with a deeper child','Structures',4,{ shape:'deep-branch',files:'notes' });
    add('balanced','Balanced seven-layer tree','Structures',7,{ shape:'balanced',files:'notes' });
    for (const [method,title] of [['LSB','LSB'],['SPECTER','SPECTER'],['DCT','DCT'],['F5','F5'],['PVD','PVD'],['SPREAD','Spread spectrum'],['PALETTE','Palette'],['CHROMA','Chroma'],['PNGCHUNK','PNG chunks']]) add('method-'+method,title+' payload','Encoding',1,{ method,files:'basic' });
    const outcomes = {
        container: ['Store files in an image', 'One PNG containing README.md and an attachment in its ZIP.'],
        text: ['Hide text and attach files', 'LSB text in the image; README.md and an attachment in its ZIP.'],
        file: ['Hide a file and attach others', 'A file encoded with LSB, plus separate files in the image’s ZIP.'],
        instructions: ['Package instructions and attachments', 'An image containing concise AGENTS.md traversal instructions and an attachment.'],
        gallery: ['Package an image gallery', 'One image whose ZIP contains two ordinary image files.'],
        folders: ['Keep files in folders', 'An image containing a ZIP with a documents folder and editable notes.'],
        chain3: ['Nest three images', 'outer.png contains layer-2.png, which contains layer-3.png. Each has its own README.md.'],
        chain5: ['Nest five images', 'Five images nested one inside the next, with editable notes in each ZIP.'],
        branches2: ['Place two images inside one', 'One outer image contains two independently editable image + ZIP files.'],
        branches4: ['Place four images inside one', 'One outer image contains four independently editable image + ZIP files.'],
        'deep-branch': ['Combine branches and nesting', 'Two images inside the outer ZIP; one branch contains a further image.'],
        balanced: ['Build a branching image tree', 'Seven images: two inside the outer image, with two more inside each branch.'],
    };
    const methodOutcomes = {
        LSB: 'Hide text in low-order colour bits.', SPECTER: 'Hide text using configured channel and bit allocations.',
        DCT: 'Hide text in image block frequency coefficients; output is PNG.', F5: 'Hide text in JPEG coefficients using a password.',
        PVD: 'Hide text using differences between neighbouring pixels.', SPREAD: 'Distribute text across groups of pixels.',
        PALETTE: 'Hide text in colour palette indices.', CHROMA: 'Hide text in colour components.',
        PNGCHUNK: 'Store text in a PNG metadata chunk.'
    };
    for (const p of list) {
        if (outcomes[p.id]) [p.title, p.description] = outcomes[p.id];
        else p.description = `${methodOutcomes[p.method]} Includes editable archive files.`;
    }
    window.PolyPresets = list;
})();

/* Run with Node >=22: node test_polyglot_comments.cjs */
const assert = require('node:assert/strict');
require('./polyglot-core.js');
const C = global.PolyCore, enc = new TextEncoder(), text = value => enc.encode(value);
const image = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64'));
const adapter = { validateImage: async bytes => assert.equal(C.format(bytes), 'png'), encode: async () => { throw Error('Unexpected image encoding'); } };
const unicodeCommentExtra = new Uint8Array([0x75,0x63,0x06,0x00,0x01,0,0,0,0,0x58]);
const retainedExtra = new Uint8Array([0xfe,0xca,0x01,0x00,0x77]);
function legacyEntry(name, opaque = false) {
    const bytes = text('Original file bytes'), commentBytes = new Uint8Array([0x43,0x61,0x66,0x82]);
    const raw = { packed:bytes, size:bytes.length, crc:C.crc(bytes), method:opaque?99:0, flags:0,
        commentBytes, localExtra:retainedExtra, centralExtra:C.concat([retainedExtra,unicodeCommentExtra]) };
    return { name, kind:'file', bytes:opaque?null:bytes, commentBytes, raw };
}
(async () => {
    const archiveComment = C.concat([text('Archive UTF-8: café\n'),new Uint8Array([0x50,0x4b,0x05,0x06])]);
    const legacyArchiveComment = new Uint8Array([0x82,0xe9,0x00]);
    assert.deepEqual((await C.readZip(await C.writeZip([],image,undefined,legacyArchiveComment))).commentBytes,legacyArchiveComment);
    const entries = [{name:'README.md',kind:'file',bytes:text('read me'),commentBytes:text('UTF-8 entry: λ')},legacyEntry('legacy.txt'),legacyEntry('opaque.bin',true)];
    const zipped = await C.writeZip(entries,image,undefined,archiveComment);
    const read = await C.readZip(zipped);
    assert.deepEqual(read.commentBytes,archiveComment);
    for(let i=0;i<entries.length;i++)assert.deepEqual(read.entries[i].commentBytes,entries[i].commentBytes);
    assert.equal(read.entries[0].raw.flags & 0x800,0x800);
    assert.equal(read.entries[1].raw.flags & 0x800,0);
    assert.equal(read.entries[2].raw.flags & 0x800,0);
    assert.equal(read.entries[2].bytes,null);

    // A rebuild of a readable legacy entry preserves comment bytes, encoding and extras.
    read.entries[1].bytes = text('Changed contents, same comment');
    const rebuilt = await C.readZip(await C.writeZip(read.entries,image,undefined,read.commentBytes));
    assert.deepEqual(rebuilt.entries[1].commentBytes,entries[1].commentBytes);
    assert.equal(rebuilt.entries[1].raw.flags & 0x800,0);
    assert.deepEqual(rebuilt.entries[1].raw.centralExtra,entries[1].raw.centralExtra);
    assert.deepEqual(rebuilt.entries[2].raw.packed,entries[2].raw.packed);

    // Explicit UTF-8 editing removes the obsolete Unicode Comment extra only.
    rebuilt.entries[1].commentBytes = text('Edited café'); rebuilt.entries[1].commentEncoding='utf8';
    const edited = await C.readZip(await C.writeZip(rebuilt.entries,image,undefined,rebuilt.commentBytes));
    assert.equal(edited.entries[1].raw.flags & 0x800,0x800);
    assert.deepEqual(edited.entries[1].commentBytes,text('Edited café'));
    assert.deepEqual(edited.entries[1].raw.centralExtra,retainedExtra);
    assert.deepEqual(edited.entries[1].raw.localExtra,retainedExtra);

    const renamed = legacyEntry('café.txt');
    await assert.rejects(C.writeZip([renamed],image),/re-save its legacy ZIP comment as UTF-8/);
    await assert.rejects(C.writeZip([],image,undefined,new Uint8Array(65536)),/65,535-byte/);
    await assert.rejects(C.writeZip([{name:'large.txt',bytes:text('x'),commentBytes:new Uint8Array(65536)}],image),/65,535-byte/);
    const boundary = new Uint8Array(65535).fill(0x41);
    const max = await C.readZip(await C.writeZip([{name:'max.txt',bytes:text('x'),commentBytes:boundary}],image,undefined,boundary));
    assert.deepEqual(max.commentBytes,boundary);assert.deepEqual(max.entries[0].commentBytes,boundary);

    // Nested archive and owning-entry comments are independent and survive deep edits.
    const child=C.layer('child.png',image);child.commentBytes=text('Child archive comment');
    child.entries=[legacyEntry('child.txt')];
    const root=C.layer('outer.png',image);root.commentBytes=archiveComment;
    root.entries=[...read.entries,{name:'child.png',kind:'layer',child,commentBytes:text('Parent entry comment for child')}];child.parent=root;
    const output=await C.build(root,adapter);
    const opened=await C.open(output,'outer.png',adapter.validateImage);
    assert.deepEqual(opened.commentBytes,archiveComment);
    const childEntry=opened.entries.find(e=>e.child),openedChild=childEntry.child;
    assert.deepEqual(childEntry.commentBytes,text('Parent entry comment for child'));
    assert.deepEqual(openedChild.commentBytes,text('Child archive comment'));
    const originalCarrier=openedChild.image.slice(), originalSibling=opened.entries[0].bytes.slice();
    openedChild.entries[0].bytes=text('Deep edit');C.dirty(openedChild);
    const reopened=await C.open(await C.build(opened,adapter),'outer.png',adapter.validateImage);
    assert.deepEqual(reopened.image,image);assert.deepEqual(reopened.entries[0].bytes,originalSibling);
    assert.deepEqual(reopened.entries[2].raw.packed,entries[2].raw.packed);
    assert.deepEqual(reopened.entries[2].commentBytes,entries[2].commentBytes);
    assert.deepEqual(reopened.entries[3].commentBytes,text('Parent entry comment for child'));
    assert.deepEqual(reopened.entries[3].child.image,originalCarrier);
    assert.deepEqual(reopened.entries[3].child.commentBytes,text('Child archive comment'));
    assert.deepEqual(reopened.entries[3].child.entries[0].commentBytes,legacyEntry('x').commentBytes);
    assert.equal(reopened.entries[3].child.entries[0].raw.flags & 0x800,0);
    console.log('PASS: archive/entry UTF-8 and legacy comments, opaque entries, Unicode-extra cleanup, ZIP field boundaries, nested rebuild and carrier/file preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});

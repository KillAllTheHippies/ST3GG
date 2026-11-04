/* Byte-derived file inspection. Records are data; file contents never become HTML. */
(() => {
    'use strict';
    const utf8 = new TextDecoder(), ascii = bytes => { let text = ''; for (let at=0;at<bytes.length;at+=8192) text += String.fromCharCode(...bytes.subarray(at,at+8192)); return text; };
    const hex = bytes => Array.from(bytes.subarray(0,64),b=>b.toString(16).padStart(2,'0')).join(' ');
    const categories = { exif:'EXIF', iptc:'IPTC / Photoshop', xmp:'XMP', png:'PNG chunks', jpeg:'JPEG segments', icc:'ICC profiles', thumbnail:'Thumbnails', hidden:'Hidden-data indicators', format:'Format details' };
    const check = signal => { if(signal?.aborted) throw new DOMException('Inspection superseded','AbortError'); };
    async function scan(bytes, { name = 'file', signal } = {}) {
        const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        const u16 = (at,little=false) => view.getUint16(at,little), u32 = (at,little=false) => view.getUint32(at,little);
        const model = { name, size:bytes.length, format:'Unknown', endOffset:null, appendedBytes:null, categories:Object.fromEntries(Object.entries(categories).map(([id,title])=>[id,{title,records:[]}])), issues:[] };
        const issue = text => model.issues.push(text);
        const add = (category,group,title,fields={},extra={}) => { const record={group,title,fields,...extra};model.categories[category].records.push(record);return record; };
        const zero = (data,start) => { const end=data.indexOf(0,start);if(end<0)throw new Error('Missing text-field terminator');return end; };
        const inflate = async data => { check(signal);const result=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());check(signal);return result; };
        const safe = async (label,run) => { try { await run(); } catch(error) { if(error.name==='AbortError')throw error;issue(`${label}: ${error.message}`); } };
        function textIndicator(text,offset,label) {
            const base64=text.match(/(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{48,}={0,2})(?:$|[^A-Za-z0-9+/=])/);
            if(base64)add('hidden','Encoded text','Possible base64',{Source:label,'Byte offset':offset,'Matched characters':base64[1].length});
        }
        function xml(data,offset,label) {
            const text=utf8.decode(data).replace(/\0+$/,'');
            add('xmp','Packets',label,{'Byte offset':offset,Bytes:data.length},{text,raw:data});
            const doc=new DOMParser().parseFromString(text,'application/xml');
            if(doc.querySelector('parsererror')){issue(`${label}: XML could not be parsed; the original packet is retained.`);return;}
            for(const element of doc.querySelectorAll('*')) {
                const path=[];for(let e=element;e;e=e.parentElement)path.unshift(e.nodeName);
                for(const attribute of element.attributes)if(!attribute.name.startsWith('xmlns'))add('xmp',element.prefix||'Properties',attribute.name,{Path:path.join('/'),Value:attribute.value});
                if(!element.children.length&&element.textContent.trim())add('xmp',element.prefix||'Properties',element.nodeName,{Path:path.join('/'),Value:element.textContent.trim()});
            }
            textIndicator(text,offset,label);
        }
        function icc(data,label,offset) {
            const record=add('icc','Profiles',label,{'Byte offset':offset,Bytes:data.length},{raw:data});
            if(data.length<132){issue(`${label}: ICC header or tag table is truncated.`);return;}
            const profile=new DataView(data.buffer,data.byteOffset,data.length),size=profile.getUint32(0);
            Object.assign(record.fields,{'Declared bytes':size,'Color space':ascii(data.subarray(16,20)),'Profile class':ascii(data.subarray(12,16)),PCS:ascii(data.subarray(20,24)),Signature:ascii(data.subarray(36,40))});
            if(size>data.length)issue(`${label}: declared ICC size exceeds available bytes.`);
            const count=profile.getUint32(128);
            if(132+count*12>data.length){issue(`${label}: ICC tag directory exceeds available bytes.`);return;}
            for(let i=0;i<count;i++){const at=132+i*12,tag=ascii(data.subarray(at,at+4)),start=profile.getUint32(at+4),length=profile.getUint32(at+8);if(start+length>data.length){issue(`${label}: ${tag} tag is out of bounds.`);continue;}add('icc','Profile tags',tag,{'Profile offset':start,Bytes:length,'Data preview':hex(data.subarray(start,start+length))},{raw:data.subarray(start,start+length)});}
        }
        function exif(data,offset,label) {
            if(ascii(data.subarray(0,6))==='Exif\0\0'){data=data.subarray(6);offset+=6;}
            const little=ascii(data.subarray(0,2))==='II';
            if(data.length<8||!['II','MM'].includes(ascii(data.subarray(0,2))))throw new Error('Invalid TIFF byte order');
            const t=new DataView(data.buffer,data.byteOffset,data.length),r16=at=>t.getUint16(at,little),r32=at=>t.getUint32(at,little);
            if(r16(2)!==42)throw new Error('Unsupported TIFF header');
            add('exif','Headers',label,{'Byte offset':offset,'Byte order':little?'Little endian':'Big endian',Bytes:data.length});
            const names={0x010e:'Image description',0x010f:'Make',0x0110:'Model',0x0112:'Orientation',0x011a:'X resolution',0x011b:'Y resolution',0x0128:'Resolution unit',0x0131:'Software',0x0132:'Date/time',0x013b:'Artist',0x8298:'Copyright',0x8769:'Exif IFD',0x8825:'GPS IFD',0x9003:'Original date/time',0x927c:'MakerNote',0x9286:'User comment',0xa005:'Interoperability IFD',0x0201:'Thumbnail offset',0x0202:'Thumbnail length'};
            const gps={0:'GPS version',1:'Latitude reference',2:'Latitude',3:'Longitude reference',4:'Longitude',5:'Altitude reference',6:'Altitude',7:'UTC time',29:'GPS date'};
            const sizes={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
            const queue=[{at:r32(4),path:'IFD0'}],seen=new Set();
            while(queue.length){check(signal);const {at,path}=queue.shift();if(!at||seen.has(at))continue;seen.add(at);if(at+2>data.length)throw new Error(`${path} offset is outside the TIFF data`);const count=r16(at);if(at+2+count*12+4>data.length)throw new Error(`${path} directory is truncated`);
                let thumbnailAt=null,thumbnailLength=null;
                for(let i=0;i<count;i++){
                    const entry=at+2+i*12,tag=r16(entry),type=r16(entry+2),countValue=r32(entry+4),size=sizes[type];
                    const title=(path.includes('GPS')?gps[tag]:names[tag])||`Tag 0x${tag.toString(16).padStart(4,'0')}`;
                    if(!size){add('exif',path,title,{Type:type,Count:countValue,'Inline bytes':hex(data.subarray(entry+8,entry+12))});continue;}
                    const length=size*countValue,start=length<=4?entry+8:r32(entry+8);if(start+length>data.length){issue(`${path} / ${title}: value is outside the TIFF data.`);continue;}
                    const raw=data.subarray(start,start+length),numbers=[];let value;
                    if(type===2)value=ascii(raw).replace(/\0+$/,'');
                    else if(type===7)value=tag===0x9286&&ascii(raw.subarray(0,8)).startsWith('ASCII')?ascii(raw.subarray(8)).replace(/\0+$/,''):hex(raw);
                    else {for(let n=0;n<countValue;n++){const pos=start+n*size;switch(type){case 1:numbers.push(data[pos]);break;case 3:numbers.push(r16(pos));break;case 4:numbers.push(r32(pos));break;case 5:case 10:{const signed=type===10,a=signed?t.getInt32(pos,little):r32(pos),b=signed?t.getInt32(pos+4,little):r32(pos+4);numbers.push(`${a}/${b}`);break;}case 6:numbers.push(t.getInt8(pos));break;case 8:numbers.push(t.getInt16(pos,little));break;case 9:numbers.push(t.getInt32(pos,little));break;case 11:numbers.push(t.getFloat32(pos,little));break;case 12:numbers.push(t.getFloat64(pos,little));break;}}value=numbers.length===1?numbers[0]:numbers;}
                    add('exif',path,title,{Value:value,Type:type,Count:countValue,'Byte offset':offset+start},{raw});
                    if([0x8769,0x8825,0xa005].includes(tag)&&type===4&&countValue===1)queue.push({at:numbers[0],path:path+'/'+(tag===0x8825?'GPS':tag===0x8769?'Exif':'Interop')});
                    if(tag===0x0201)thumbnailAt=numbers[0];if(tag===0x0202)thumbnailLength=numbers[0];
                }
                if(thumbnailAt!==null&&thumbnailLength!==null){if(thumbnailAt+thumbnailLength<=data.length){const raw=data.subarray(thumbnailAt,thumbnailAt+thumbnailLength);add('thumbnail','EXIF thumbnails',path,{'Byte offset':offset+thumbnailAt,Bytes:thumbnailLength},{raw,mime:raw[0]===255&&raw[1]===216?'image/jpeg':''});}else issue(`${path}: thumbnail exceeds available TIFF bytes.`);}
                const next=r32(at+2+count*12);if(next)queue.push({at:next,path:path==='IFD0'?'IFD1':path+'/Next'});
            }
        }
        function iptc(data,offset) {
            const marker=ascii(data.subarray(0,14));let at=marker==='Photoshop 3.0\0'?14:0;
            while(at+12<=data.length){if(ascii(data.subarray(at,at+4))!=='8BIM'){at++;continue;}
                const dv=new DataView(data.buffer,data.byteOffset,data.length),id=dv.getUint16(at+4),nameLength=data[at+6],name=ascii(data.subarray(at+7,at+7+nameLength));let start=at+6+1+nameLength+((1+nameLength)%2);if(start+4>data.length)throw new Error('Truncated Photoshop resource');const length=dv.getUint32(start);start+=4;if(start+length>data.length)throw new Error('Photoshop resource exceeds segment');
                const body=data.subarray(start,start+length),resource=id===0x0404?'IPTC datasets':`Photoshop resource 0x${id.toString(16)}`;
                add('iptc','Photoshop resources',resource,{Name:name,'Byte offset':offset+start,Bytes:length},{raw:body});
                if(id===0x0404){let cursor=0;while(cursor+5<=body.length){if(body[cursor]!==0x1c){cursor++;continue;}const record=body[cursor+1],dataset=body[cursor+2];let size=(body[cursor+3]<<8)|body[cursor+4],header=5;if(size&0x8000){const count=size&0x7fff;if(count>4||cursor+5+count>body.length)throw new Error('Unsupported IPTC extended length');size=0;for(let i=0;i<count;i++)size=size*256+body[cursor+5+i];header+=count;}if(cursor+header+size>body.length)throw new Error('Truncated IPTC dataset');const value=body.subarray(cursor+header,cursor+header+size);const labels={5:'Object name',25:'Keywords',80:'By-line',90:'City',95:'Province/state',101:'Country',105:'Headline',116:'Copyright',120:'Caption'};add('iptc',`Record ${record}`,labels[dataset]||`Dataset ${dataset}`,{Value:utf8.decode(value),'Byte offset':offset+start+cursor,Bytes:size},{raw:value});cursor+=header+size;}}
                at=start+length+(length%2);
            }
        }
        const profiles=[];
        async function png() {
            model.format='PNG';let at=8;
            while(at+12<=bytes.length){check(signal);const size=u32(at),type=ascii(bytes.subarray(at+4,at+8)),end=at+12+size;if(end>bytes.length){issue(`PNG ${type}: chunk at byte ${at} is truncated.`);break;}
                const data=bytes.subarray(at+8,at+8+size),record=add('png',type,type,{'Byte offset':at,Bytes:size,'Chunk class':type[0]===type[0].toUpperCase()?'Critical':'Ancillary'});
                if(typeof PolyCore!=='undefined'&&PolyCore.crc(bytes.subarray(at+4,at+8+size))!==u32(at+8+size))issue(`PNG ${type} at byte ${at}: CRC mismatch.`);
                if(type==='IHDR'&&size===13)Object.assign(record.fields,{Width:u32(at+8),Height:u32(at+12),'Bit depth':data[8],'Color type':data[9],Interlace:data[12]});
                if(['tEXt','zTXt','iTXt'].includes(type))await safe(`PNG ${type} at byte ${at}`,async()=>{const split=zero(data,0),keyword=ascii(data.subarray(0,split));let value,language='',translated='';
                    if(type==='tEXt')value=ascii(data.subarray(split+1));
                    if(type==='zTXt'){if(data[split+1]!==0)throw new Error('Unsupported compression method');value=ascii(await inflate(data.subarray(split+2)));}
                    if(type==='iTXt'){const flag=data[split+1],method=data[split+2],languageEnd=zero(data,split+3),translatedEnd=zero(data,languageEnd+1);language=ascii(data.subarray(split+3,languageEnd));translated=utf8.decode(data.subarray(languageEnd+1,translatedEnd));if(flag>1||method!==0)throw new Error('Unsupported text compression');const text=data.subarray(translatedEnd+1);value=utf8.decode(flag?await inflate(text):text);}
                    record.title=keyword||type;record.fields.Keyword=keyword;if(language)record.fields.Language=language;if(translated)record.fields['Translated keyword']=translated;record.text=value;
                    textIndicator(value,at,keyword);if(keyword==='XML:com.adobe.xmp')xml(new TextEncoder().encode(value),at+8,keyword);
                });
                if(type==='eXIf')await safe('PNG EXIF',()=>exif(data,at+8,'PNG eXIf'));
                if(type==='iCCP')await safe('PNG ICC profile',async()=>{const split=zero(data,0);if(data[split+1]!==0)throw new Error('Unsupported profile compression');icc(await inflate(data.subarray(split+2)),ascii(data.subarray(0,split)),at+8);});
                at=end;if(type==='IEND'){model.endOffset=end;break;}
            }
            if(model.endOffset===null)issue('PNG IEND was not found in the parsed chunk stream.');
        }
        async function jpeg() {
            model.format='JPEG';add('jpeg','SOI','Start of image',{'Byte offset':0,Bytes:2});let at=2;
            const names={0xc0:'SOF0',0xc2:'SOF2',0xc4:'DHT',0xdb:'DQT',0xda:'SOS',0xdd:'DRI',0xfe:'COM'};
            while(at<bytes.length){check(signal);if(bytes[at]!==255){at++;continue;}const start=at;while(bytes[at]===255)at++;if(at>=bytes.length)break;const marker=bytes[at++];if(marker===0||marker>=0xd0&&marker<=0xd7)continue;
                if(marker===0xd9){add('jpeg','EOI','End of image',{'Byte offset':start,Bytes:at-start});model.endOffset=at;break;}
                if(marker===0x01||marker===0xd8)continue;
                if(at+2>bytes.length){issue(`JPEG marker at byte ${start} is truncated.`);break;}const length=u16(at);if(length<2||at+length>bytes.length){issue(`JPEG segment at byte ${start} exceeds the file.`);break;}
                const begin=at+2,data=bytes.subarray(begin,at+length),type=marker>=0xe0&&marker<=0xef?'APP'+(marker-0xe0):names[marker]||'0x'+marker.toString(16);
                const record=add('jpeg',type,type,{'Byte offset':start,Bytes:length+2});
                if(marker===0xfe){record.text=ascii(data);textIndicator(record.text,start,'JPEG comment');}
                if([0xc0,0xc1,0xc2].includes(marker)&&data.length>=6)Object.assign(record.fields,{Precision:data[0],Height:(data[1]<<8)|data[2],Width:(data[3]<<8)|data[4],Components:data[5]});
                if(marker===0xe1){if(ascii(data.subarray(0,6))==='Exif\0\0')await safe('JPEG EXIF',()=>exif(data,begin,'JPEG APP1'));
                    else {const identifier='http://ns.adobe.com/xap/1.0/\0';if(ascii(data.subarray(0,identifier.length))===identifier)await safe('JPEG XMP',()=>xml(data.subarray(identifier.length),begin+identifier.length,'JPEG XMP'));}}
                if(marker===0xed)await safe('JPEG IPTC',()=>iptc(data,begin));
                if(marker===0xe2&&ascii(data.subarray(0,12))==='ICC_PROFILE\0'&&data.length>=14)profiles.push({sequence:data[12],count:data[13],data:data.subarray(14),offset:begin+14});
                if(marker===0xe0&&ascii(data.subarray(0,5))==='JFIF\0'&&data.length>=14){const width=data[12],height=data[13];if(width&&height&&14+width*height*3<=data.length)add('thumbnail','JFIF thumbnails','RGB thumbnail',{'Byte offset':begin+14,Width:width,Height:height,Bytes:width*height*3},{raw:data.subarray(14,14+width*height*3)});}
                at+=length;
            }
            if(model.endOffset===null)issue('JPEG end-of-image marker was not found in the parsed marker stream.');
            if(profiles.length){const count=profiles[0].count,parts=profiles.slice().sort((a,b)=>a.sequence-b.sequence);if(parts.length!==count||parts.some((p,i)=>p.sequence!==i+1||p.count!==count))issue('JPEG ICC profile is incomplete or has duplicated sequence numbers.');else{const data=new Uint8Array(parts.reduce((size,p)=>size+p.data.length,0));let at=0;for(const part of parts){data.set(part.data,at);at+=part.data.length;}icc(data,'JPEG ICC profile',parts[0].offset);}}
        }
        async function riff() {
            const kind=ascii(bytes.subarray(8,12));model.format=kind==='WEBP'?'WebP':kind==='WAVE'?'WAV':'RIFF';const end=u32(4,true)+8;
            add('format','Container','RIFF header',{'Declared bytes':end,'Actual bytes':bytes.length,'Form type':kind});if(end<=bytes.length)model.endOffset=end;else issue('RIFF declared size exceeds the file.');
            let at=12;while(at+8<=Math.min(end,bytes.length)){const type=ascii(bytes.subarray(at,at+4)),size=u32(at+4,true),begin=at+8;if(begin+size>bytes.length||begin+size>end){issue(`RIFF ${type} chunk exceeds its container.`);break;}const data=bytes.subarray(begin,begin+size),record=add('format',type,type,{'Byte offset':at,Bytes:size});
                if(type==='EXIF')await safe('WebP EXIF',()=>exif(data,begin,'WebP EXIF'));if(type==='XMP ')await safe('WebP XMP',()=>xml(data,begin,'WebP XMP'));if(type==='ICCP')icc(data,'WebP ICC profile',begin);
                if(kind==='WAVE'&&type==='fmt '&&size>=16)Object.assign(record.fields,{'Audio format':u16(begin,true),Channels:u16(begin+2,true),'Sample rate':u32(begin+4,true),'Bits per sample':u16(begin+14,true)});
                at=begin+size+(size%2);
            }
        }
        function gif() {
            model.format='GIF';if(bytes.length<13)throw new Error('GIF header is truncated');add('format','Header','GIF header',{Version:ascii(bytes.subarray(0,6)),Width:u16(6,true),Height:u16(8,true)});
            let at=13;if(bytes[10]&128)at+=3*(2**((bytes[10]&7)+1));
            function subblocks(){const parts=[];while(at<bytes.length){const size=bytes[at++];if(!size)return parts;if(at+size>bytes.length)throw new Error('GIF sub-block is truncated');parts.push(bytes.subarray(at,at+size));at+=size;}throw new Error('GIF sub-block terminator is missing');}
            while(at<bytes.length){const start=at,marker=bytes[at++];if(marker===0x3b){model.endOffset=at;break;}if(marker===0x21){const label=bytes[at++],parts=subblocks();const raw=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let p=0;for(const part of parts){raw.set(part,p);p+=part.length;}const record=add('format','Extensions',label===0xfe?'Comment':label===0xff?'Application extension':label===0xf9?'Graphic control':'Extension 0x'+label.toString(16),{'Byte offset':start,Bytes:at-start},{raw});if(label===0xfe){record.text=ascii(raw);textIndicator(record.text,start,'GIF comment');}}
                else if(marker===0x2c){if(at+9>bytes.length)throw new Error('GIF image descriptor is truncated');const flags=bytes[at+8];at+=9;if(flags&128)at+=3*(2**((flags&7)+1));at++;subblocks();add('format','Images','Image data',{'Byte offset':start,Bytes:at-start});}else throw new Error(`Unexpected GIF block at byte ${start}`);}
            if(model.endOffset===null)issue('GIF trailer was not found in the parsed block stream.');
        }
        check(signal);
        await safe('Container',async()=>{
            if(bytes.length>=8&&hex(bytes.subarray(0,8))==='89 50 4e 47 0d 0a 1a 0a')await png();
            else if(bytes[0]===255&&bytes[1]===216)await jpeg();
            else if(ascii(bytes.subarray(0,3))==='GIF')gif();
            else if(bytes.length>=12&&ascii(bytes.subarray(0,4))==='RIFF')await riff();
            else if(bytes.length>=54&&ascii(bytes.subarray(0,2))==='BM'){model.format='BMP';const end=u32(2,true),pixelOffset=u32(10,true),header=u32(14,true);add('format','Header','BMP header',{'Declared bytes':end,'Pixel-data offset':pixelOffset,'DIB header bytes':header,Width:view.getInt32(18,true),Height:view.getInt32(22,true),'Bits per pixel':u16(28,true)});if(end<=bytes.length)model.endOffset=end;else issue('BMP declared size exceeds the file.');if(pixelOffset>14+header)add('format','Header gap','Bytes before pixel data',{'Byte offset':14+header,Bytes:pixelOffset-14-header});}
        });
        if(model.endOffset!==null){model.appendedBytes=bytes.length-model.endOffset;if(model.appendedBytes>0)add('hidden','Appended data','Bytes after container end',{'Byte offset':model.endOffset,Bytes:model.appendedBytes,'Hex preview':hex(bytes.subarray(model.endOffset))},{raw:bytes.subarray(model.endOffset)});}
        const signatures=[['ZIP',[80,75,3,4]],['RAR',[82,97,114,33,26,7]],['7-Zip',[55,122,188,175,39,28]],['PDF',[37,80,68,70]],['PNG',[137,80,78,71,13,10,26,10]],['JPEG',[255,216,255]],['GIF',[71,73,70,56]],['Executable',[77,90]],['OpenStego',[111,112,115,116]],['STEG header',[83,84,69,71]]];
        for(const [title,pattern]of signatures){let at=1;while((at=bytes.indexOf(pattern[0],at))>=0){if(pattern.every((b,i)=>bytes[at+i]===b))add('hidden',title+' signatures',title,{'Byte offset':at,'Evidence':'Byte signature match; format and payload are not verified.'});at++;}check(signal);}
        return model;
    }
    window.ST3GGInspection = Object.freeze({ scan, categories });
})();

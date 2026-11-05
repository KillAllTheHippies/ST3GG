/* Shared automatic inspection and a counted, progressively disclosed results tree. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), cache = new WeakMap();
    let current = null, controller = null, revision = 0;
    const urls = [];
    function element(tag,text,className) { const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node; }
    const clean = value => String(value).replace(/[^a-z0-9_.-]+/gi,'_');
    let tooltipId = 0;
    function explain(label, info, control) {
        label.classList.add('inspection-term');
        const text=element('span',`${info.title}. ${info.description}`,'inspection-tooltip');
        text.id='inspection-tooltip-'+(++tooltipId);text.setAttribute('role','tooltip');label.append(text);
        control.setAttribute('aria-describedby',text.id);
        control.addEventListener('keydown',event=>{if(event.key==='Escape')text.hidden=true;});
        const position=()=>{
            text.hidden=false;
            const bounds=control.getBoundingClientRect();
            // Account for the app's CSS zoom and any transformed containing block.
            text.style.left='0px';text.style.top='0px';
            const origin=text.getBoundingClientRect(),scale=origin.width/text.offsetWidth;
            text.style.left=((Math.max(16,Math.min(bounds.left,innerWidth-origin.width-16))-origin.left)/scale)+'px';
            text.style.top=(((bounds.bottom+origin.height+12<innerHeight?bounds.bottom+7:Math.max(8,bounds.top-origin.height-7))-origin.top)/scale)+'px';
        };
        control.addEventListener('focusin',position);
        control.addEventListener('pointerenter',position);
    }
    function knowledgeLink(info, name) {
        const link=element('a','About','inspection-term-help');
        link.href=`knowledgebase.html#${info.article}${info.section?'/'+info.section:''}`;
        link.setAttribute('aria-label','Read about '+name);
        link.onclick=event=>{event.preventDefault();event.stopPropagation();ST3GGKnowledge.open(info.article,info.section);};
        return link;
    }
    function recordView(record) {
        const section=element('div',undefined,'inspection-record');
        section.append(element('h4',record.title));
        const fields=element('dl',undefined,'inspection-fields');
        for(const [key,value]of Object.entries(record.fields)){fields.append(element('dt',key),element('dd',typeof value==='object'?JSON.stringify(value):String(value)));}
        section.append(fields);
        if(record.text!==undefined)section.append(element('pre',record.text,'inspection-text'));
        if(record.mime?.startsWith('image/')&&record.raw){const url=URL.createObjectURL(new Blob([record.raw],{type:record.mime}));urls.push(url);const img=element('img');img.src=url;img.alt=record.title;img.className='inspection-thumbnail';section.append(img);}
        if(record.raw||record.text!==undefined){
            const actions=element('div',undefined,'result-actions'),text=record.text;
            const value=ST3GGWorkflow.fromBytes(text===undefined?record.raw:text,clean(record.title)+(text===undefined?'.bin':'.txt'),'File inspection');
            const button=element('button',text===undefined?'Download bytes':'Download text','btn btn-secondary btn-sm');button.onclick=()=>ST3GGTransfers.download(value);actions.append(button);ST3GGTransfers.mount(actions,()=>value);section.append(actions);
        }
        return section;
    }
    function render(model) {
        for(const url of urls)URL.revokeObjectURL(url);urls.length=0;
        const root=$('inspection-results');root.hidden=false;root.dataset.status='complete';root.dataset.file=model.name;
        $('inspection-status').textContent=`${model.name} · ${model.format} · ${formatSize(model.size)}`;
        const facts=$('file-structure-result');facts.replaceChildren();
        const list=element('dl',undefined,'inspection-fields');
        const values={'File type':model.format,'File size':`${model.size.toLocaleString()} bytes`,'Container end':model.endOffset===null?'Not determined':`Byte ${model.endOffset.toLocaleString()}`,'Appended data':model.appendedBytes===null?'Not determined':`${model.appendedBytes.toLocaleString()} bytes`};
        for(const [key,value]of Object.entries(values))list.append(element('dt',key),element('dd',value));facts.append(list);
        const issues=$('inspection-issues');issues.replaceChildren();issues.hidden=!model.issues.length;
        if(model.issues.length){issues.append(element('summary',`Inspection notes · ${model.issues.length}`));for(const note of model.issues)issues.append(element('p',note));}
        const tree=$('metadata-tree');tree.replaceChildren();
        const overview=$('metadata-overview');overview.replaceChildren();
        for(const [id,category]of Object.entries(model.categories)){
            const count=category.records.length,chip=element(count?'a':'span',undefined,'inspection-category-count');if(count)chip.href='#inspection-category-'+id;
            const categoryLabel=element('span',category.title),categoryInfo=ST3GGKnowledge.term(id);
            chip.append(categoryLabel,element('strong',String(count)));if(categoryInfo){if(!count)chip.tabIndex=0;explain(categoryLabel,categoryInfo,chip);}overview.append(chip);
            if(!count)continue;
            const section=element('section',undefined,'inspection-category');section.id='inspection-category-'+id;section.dataset.category=id;section.dataset.count=String(count);
            const heading=element('h3',`${category.title} · ${count} ${count===1?'record':'records'}`),headingRow=element('div',undefined,'inspection-category-heading');headingRow.append(heading);if(categoryInfo)headingRow.append(knowledgeLink(categoryInfo,category.title));section.append(headingRow);
            const groups=new Map();for(const record of category.records){if(!groups.has(record.group))groups.set(record.group,[]);groups.get(record.group).push(record);}
            for(const [name,records]of groups){
                const group=element('details',undefined,'inspection-group'),summary=element('summary'),label=element('span',undefined,'inspection-term-label'),info=ST3GGKnowledge.term(id,name);
                label.append(element('span',name));summary.append(label,element('span',String(records.length),'inspection-count'));
                if(info){explain(label,info,summary);summary.append(knowledgeLink(info,name));}group.append(summary);
                let populated=false;group.addEventListener('toggle',()=>{if(group.open&&!populated){for(const record of records)group.append(recordView(record));populated=true;}});
                section.append(group);
            }
            tree.append(section);
        }
        if(!tree.children.length)tree.append(element('p','No supported metadata records or byte-signature indicators were found.'));
        $('inspection-export').disabled=false;
    }
    function result(file,bytes,signal) {
        if(cache.has(file))return cache.get(file);
        const promise=(async()=>ST3GGInspection.scan(bytes||new Uint8Array(await file.arrayBuffer()),{name:file.name,signal}))();
        cache.set(file,promise);promise.catch(()=>cache.delete(file));return promise;
    }
    async function inspect(file,bytes) {
        if(current?.file===file)return current.promise;
        controller?.abort();controller=new AbortController();const request=++revision;
        const root=$('inspection-results');root.hidden=false;root.dataset.status='loading';root.dataset.file=file.name;
        $('inspection-status').textContent=`Inspecting ${file.name}…`;$('metadata-tree').replaceChildren();$('metadata-overview').replaceChildren();$('file-structure-result').textContent='Reading file structure…';$('inspection-export').disabled=true;$('inspection-issues').hidden=true;
        const promise=result(file,bytes,controller.signal);current={file,promise,model:null};
        try{const model=await promise;if(request!==revision)return model;current.model=model;render(model);state.analysisInspection=model;return model;}
        catch(error){if(error.name==='AbortError')return null;if(request===revision){root.dataset.status='error';$('inspection-status').textContent=`Could not inspect ${file.name}: ${error.message}`;current=null;}return null;}
    }
    async function structureReport(file) {
        const model=await result(file);return `║ FILE STRUCTURE:\n║ ${model.format} · ${model.size} bytes\n║ Container end: ${model.endOffset??'not determined'}\n║ Appended bytes: ${model.appendedBytes??'not determined'}\n`;
    }
    function report() { if(!current?.model)throw new Error('Inspection has not finished.');return JSON.stringify(current.model,(key,value)=>key==='raw'?undefined:value,2); }
    function exportReport() { ST3GGTransfers.download(ST3GGTransfers.artifact({text:report(),name:clean(current.file.name)+'.inspection.json',source:'File inspection'})); }
    document.addEventListener('DOMContentLoaded',()=>{
        $('inspection-export').onclick=exportReport;
        $('inspection-expand').onclick=()=>{for(const group of $('metadata-tree').querySelectorAll('.inspection-group'))group.open=true;};
        $('inspection-collapse').onclick=()=>{for(const group of $('metadata-tree').querySelectorAll('.inspection-group'))group.open=false;};
    });
    window.ST3GGAnalysis=Object.freeze({inspect,structureReport,report,exportReport});
})();

/* Shared presentation and result affordances; technique implementations stay separate. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), W = ST3GGWorkflow, T = ST3GGTransfers;
    function button(label, run, host) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary'; b.textContent = label; b.onclick = run; host.append(b); return b; }
    function modelSummary() {
        for (const item of document.querySelectorAll('.workflow-model-summary')) item.textContent = `Image model: ${$('aiagent-image-model').value || 'Choose in Configuration'}`;
    }
    document.addEventListener('DOMContentLoaded', () => {
        // One editable image-model field and planning default, wherever they are used.
        for (const [id, key] of [['aiagent-image-model','st3gg_image_model'], ['planning-model','st3gg_planning_model']]) {
            try { const value = localStorage.getItem(key); if (value !== null) $(id).value = value; } catch { /* Session-only settings remain usable. */ }
            $(id).addEventListener('input', () => { try { localStorage.setItem(key, $(id).value); } catch {} modelSummary(); });
        }
        modelSummary();
        for (const [id, kind] of [['aiagent-image-model','image'],['planning-model','planning']]) {
            const input=$(id), host=input.parentElement, wrap=document.createElement('div'), popup=document.createElement('div'), list=document.createElement('div');
            wrap.className='agent-model-picker';popup.className='agent-model-popup';list.className='agent-model-options';list.id=id+'-options';list.setAttribute('role','listbox');list.setAttribute('aria-label','Available '+kind+' models');popup.hidden=true;
            input.replaceWith(wrap);wrap.append(input,popup);popup.append(list);
            input.autocomplete='off';input.setAttribute('role','combobox');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');input.setAttribute('aria-autocomplete','list');
            const status = document.createElement('p'); status.className = 'workflow-model-status'; status.setAttribute('role','status');
            host.append(status);
            const price = document.createElement('p'); price.className = 'workflow-model-status workflow-model-price'; price.hidden=true; host.append(price);
            let catalog=[], fetched=false, searching=false, shown=40, active=-1;
            function close(){popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
            function draw(){
                list.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');
                const query=searching?input.value.trim().toLowerCase():'';
                const matches=catalog.filter(model=>(model.id+' '+(model.name||'')).toLowerCase().includes(query));
                for(const [index,model]of matches.slice(0,shown).entries()){
                    const option=document.createElement('button');option.type='button';option.className='agent-model-option';option.id=id+'-option-'+index;option.dataset.modelId=model.id;option.tabIndex=-1;option.setAttribute('role','option');option.setAttribute('aria-selected','false');
                    for(const [tag,text,cls]of [['span',model.name||model.id,'agent-model-name'],['small',model.id,''],['span',ST3GGModelPricing.describe(model),'agent-model-price']]){const item=document.createElement(tag);item.textContent=text;item.className=cls;option.append(item);}
                    option.onmousedown=event=>event.preventDefault();option.onclick=()=>{input.value=model.id;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.focus({preventScroll:true});close();};list.append(option);
                }
                if(matches.length>shown){const more=button('Show more models',()=>{shown+=40;draw();},list);more.onmousedown=event=>event.preventDefault();}
                if(!matches.length){const empty=document.createElement('p');empty.className='agent-model-status';empty.textContent=fetched?'No matching models. You can enter a model ID.':'Refresh to load available models.';list.append(empty);}
            }
            function open(){popup.hidden=false;input.setAttribute('aria-expanded','true');draw();}
            function showPrice() { const selected=catalog.find(model=>model.id===input.value.trim());price.hidden=!input.value.trim();price.textContent=ST3GGModelPricing.describe(selected); }
            input.addEventListener('input',()=>{searching=true;shown=40;showPrice();open();});input.addEventListener('change',showPrice);
            const discover = button('Refresh available models', async () => {
                discover.disabled = true; status.textContent = 'Loading available models…';
                try {
                    const models = await ST3GGImageAgent.models(undefined,kind); catalog=models;fetched=true;draw();showPrice();
                    status.textContent = `${models.length} models available. Type a name or enter a model ID.`;
                } catch (error) { status.textContent = error.message; }
                finally { discover.disabled = false; }
            }, host);
            discover.id=id+'-refresh';
            input.addEventListener('focus',()=>{searching=false;open();if(!fetched&&!discover.disabled)discover.click();});
            input.addEventListener('keydown',event=>{
                if(event.key==='Escape'){event.preventDefault();close();return;}
                if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(popup.hidden)open();const options=[...list.querySelectorAll('[role=option]')];if(!options.length)return;active=event.key==='ArrowDown'?Math.min(active+1,options.length-1):Math.max(0,active-1);options.forEach((option,index)=>option.setAttribute('aria-selected',String(index===active)));input.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}
                if(event.key==='Enter'&&!popup.hidden){event.preventDefault();const options=list.querySelectorAll('[role=option]');if(active>=0)options[active].click();else close();}
            });
            wrap.addEventListener('focusout',event=>{if(!wrap.contains(event.relatedTarget))close();});
            document.addEventListener('pointerdown',event=>{if(!wrap.contains(event.target))close();});
        }
        const textShortcut = button('Continue in Text Lab', () => {
            document.querySelector('.tabs [data-tab="textlab"]').click(); $('textlab-secret').focus();
        }, $('encode-text').parentElement);
        textShortcut.hidden = !textLabUnlocked;
        document.addEventListener('st3gg-feature-change', () => { textShortcut.hidden = !textLabUnlocked; });
        // A common action row for decoded nested/cipher payloads.
        for (const [hostId, key, nameKey, source] of [
            ['matryoshka-extracted','matryoshkaExtractedData','matryoshkaExtractedFilename','Nested image payloads'],
            ['godmode-decode-result','godmodeDecodedData','godmodeDecodedFilename','SPECTER']
        ]) {
            const row = document.createElement('div'); row.className = 'result-actions';
            const download = $(hostId).querySelector('button'); if (download) row.append(download);
            $(hostId).append(row);
            T.mount(row, () => { if (!state[key]) throw new Error('Decode a payload first.'); return W.fromBytes(state[key],state[nameKey] || 'decoded.bin',source); });
        }
        const analysisActions = document.createElement('div'); analysisActions.className = 'result-actions'; $('analyze-results-card').append(analysisActions);
        T.mount(analysisActions, () => { if (!state.analyzeFile) throw new Error('Choose media first.'); return W.fromFile(state.analyzeFile,'Analyze input'); });
        button('Use analysis report…', () => ST3GGWorkbench.open(), analysisActions);
        // Remove duplicated quick-download placement; one result row handles images and audio.
        $('quick-download-btn').hidden = true;
        for (const [id, source] of [['textlab-output','Text Lab encoded text'], ['textlab-decode-output','Text Lab decoded message']]) {
            const row = $(id).nextElementSibling;
            button('Download text', () => { try { T.download(W.textArtifact(id,source)); } catch (error) { notify(error.message,'error'); } }, row);
        }
    });
})();

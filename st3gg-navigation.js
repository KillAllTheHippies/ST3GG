/* One tab row with a compact, non-modal overflow list beneath its chevron. */
(() => {
    'use strict';
    document.addEventListener('DOMContentLoaded', () => {
        const nav=document.querySelector('.tabs'),tabs=[...nav.querySelectorAll('.tab')];
        nav.classList.add('app-tabs');nav.setAttribute('aria-label','Application tools');
        const strip=document.createElement('div');strip.className='tab-strip';nav.prepend(strip);
        const more=document.createElement('button');more.type='button';more.className='tab-overflow-toggle';more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');more.title='More tabs';more.hidden=true;
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M3 6l5 5 5-5');svg.append(path);more.append(svg);
        const popup=document.createElement('div');popup.id='tab-overflow';popup.className='tab-overflow-list';popup.setAttribute('role','menu');popup.setAttribute('aria-label','Additional tabs');popup.hidden=true;more.setAttribute('aria-controls',popup.id);nav.append(more,popup);
        let scheduled=false,focusActive=false;
        function close(restore=false){popup.hidden=true;more.setAttribute('aria-expanded','false');if(restore)more.focus({preventScroll:true});}
        function layout(){
            scheduled=false;if(!popup.hidden)return;
            const focused=document.activeElement,hadTabFocus=tabs.includes(focused);
            for(const tab of tabs){strip.append(tab);tab.removeAttribute('role');}
            const eligible=tabs.filter(tab=>!tab.hidden&&tab.style.display!=='none');more.hidden=false;
            const scale=nav.getBoundingClientRect().width/nav.offsetWidth,gap=4*scale;
            const widths=new Map(eligible.map(tab=>[tab,tab.getBoundingClientRect().width]));
            const total=eligible.reduce((sum,tab)=>sum+widths.get(tab),0)+Math.max(0,eligible.length-1)*gap,available=nav.getBoundingClientRect().width;
            if(total<=available)more.hidden=true;
            else{
                const budget=available-more.getBoundingClientRect().width-gap,active=eligible.find(tab=>tab.classList.contains('active'))||eligible[0];
                const visible=new Set(active?[active]:[]);let used=active?widths.get(active):0;
                for(const tab of eligible){if(tab===active)continue;const next=widths.get(tab)+(visible.size?gap:0);if(used+next<=budget){visible.add(tab);used+=next;}}
                for(const tab of eligible)if(!visible.has(tab)){tab.setAttribute('role','menuitem');popup.append(tab);}
                more.setAttribute('aria-label',`Show ${popup.children.length} additional tabs`);
            }
            if(focusActive){nav.querySelector('.tab.active')?.focus({preventScroll:true});focusActive=false;}
            else if(hadTabFocus){(focused.parentElement===popup?more:focused).focus({preventScroll:true});}
        }
        function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(layout);}}
        function focusItem(index){const items=[...popup.children],item=items[(index+items.length)%items.length];if(item){item.focus({preventScroll:true});if(item.offsetTop<popup.scrollTop)popup.scrollTop=item.offsetTop;else if(item.offsetTop+item.offsetHeight>popup.scrollTop+popup.clientHeight)popup.scrollTop=item.offsetTop+item.offsetHeight-popup.clientHeight;}}
        function open(last=false){
            layout();if(more.hidden)return;
            const bounds=nav.getBoundingClientRect(),scale=bounds.width/nav.offsetWidth,below=innerHeight-bounds.bottom-12,above=bounds.top-12,up=below<180&&above>below;
            popup.style.top=up?'auto':'calc(100% + 4px)';popup.style.bottom=up?'calc(100% + 4px)':'auto';popup.style.maxHeight=Math.min(360,Math.max(80,up?above:below)/scale)+'px';
            popup.hidden=false;popup.scrollTop=0;more.setAttribute('aria-expanded','true');focusItem(last?popup.children.length-1:0);
        }
        more.onclick=()=>popup.hidden?open():close(true);
        nav.addEventListener('keydown',event=>{
            if(event.key==='Escape'&&!popup.hidden){event.preventDefault();event.stopPropagation();close(true);}
            else if(event.target===more&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(event.key==='ArrowUp');}
            else if(popup.contains(event.target)&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const index=[...popup.children].indexOf(document.activeElement);focusItem(event.key==='Home'?0:event.key==='End'?popup.children.length-1:index+(event.key==='ArrowDown'?1:-1));}
        });
        popup.addEventListener('focusout',event=>{if(!popup.contains(event.relatedTarget)&&event.relatedTarget!==more)close();});
        document.addEventListener('pointerdown',event=>{if(!popup.contains(event.target)&&!more.contains(event.target))close();});
        nav.addEventListener('click',event=>{const tab=event.target.closest('.tab');if(!tab)return;if(!popup.hidden){focusActive=true;close();}schedule();});
        window.addEventListener('resize',()=>{const wasOpen=!popup.hidden,focused=document.activeElement;close();layout();if(wasOpen&&!more.hidden){open();if(popup.contains(focused))focused.focus({preventScroll:true});}});new ResizeObserver(schedule).observe(nav);
        new MutationObserver(records=>{if(records.some(record=>tabs.includes(record.target)))schedule();}).observe(nav,{subtree:true,attributes:true,attributeFilter:['style','hidden','class']});
        document.fonts?.ready.then(schedule);layout();
    });
})();

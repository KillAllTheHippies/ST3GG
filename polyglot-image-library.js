/* Browser-local carrier history. Archive contents and credentials are never stored here. */
(function () {
    'use strict';
    const memory=new Map();let database,loadPromise,warning='';
    function db(){
        if(!database)database=new Promise((resolve,reject)=>{
            const request=indexedDB.open('st3gg-image-library',1);
            request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'id'});
            request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
        });
        return database;
    }
    async function transaction(mode, action){
        const database=await db();
        return new Promise((resolve,reject)=>{
            const tx=database.transaction('images',mode),request=action(tx.objectStore('images'));
            tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        });
    }
    async function remember(name,bytes){
        const copy=bytes.slice(),digest=await crypto.subtle.digest('SHA-256',copy);
        const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        if(memory.has(id))return;
        const item={id,name,bytes:copy,created:Date.now()};memory.set(id,item);
        try{await transaction('readwrite',store=>store.put(item));}
        catch{warning='Browser storage is unavailable or full. New images are available for this visit only.';}
    }
    async function list(){
        if(!loadPromise)loadPromise=(async()=>{try{for(const item of await transaction('readonly',store=>store.getAll()))if(!memory.has(item.id))memory.set(item.id,item);}catch{warning='Saved image history is unavailable. Images from this visit are still available.';}})();
        await loadPromise;return [...memory.values()].sort((a,b)=>b.created-a.created);
    }
    window.PolyImageLibrary={remember,list,get warning(){return warning;}};
})();

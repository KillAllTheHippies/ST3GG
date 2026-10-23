/* OpenRouter authorization stays separate from the unsaved image/archive workspace. */
(function () {
    'use strict';
    let pending = null, message = '';
    const controls = new Set();
    const keyInput = document.getElementById('aiagent-api-key');
    const encoded = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const random = () => encoded(crypto.getRandomValues(new Uint8Array(32)));
    function update() {
        for (const view of controls) {
            if (!view.root.isConnected) { controls.delete(view); continue; }
            view.connect.disabled = !!pending;
            view.disconnect.hidden = !ST3GGImageAgent.settings().apiKey && !pending;
            view.disconnect.style.display = view.disconnect.hidden ? 'none' : '';
            view.status.textContent = message || (ST3GGImageAgent.settings().apiKey ? 'OpenRouter key loaded.' : 'Connect to use your OpenRouter credits.');
            view.manual.hidden = !pending?.manual;
            view.submit.disabled = !!pending?.exchanging;
        }
    }
    function finish(text) {
        if (pending) {
            clearInterval(pending.timer);
            pending.popup?.close();
            pending = null;
        }
        message = text;
        update();
    }
    function syncKey(key) {
        ST3GGImageAgent.configure({ apiKey: key });
        for (const field of document.querySelectorAll('[data-focus="api-key"]')) field.value = key;
        for (const status of document.querySelectorAll('.nw-key-status')) status.textContent = key ? 'Key loaded' : 'No key loaded';
        document.dispatchEvent(new CustomEvent('st3gg-openrouter-key-change'));
    }
    async function connect() {
        if (pending) return;
        if (!globalThis.isSecureContext || !crypto.subtle) {
            message = 'Open this app over HTTPS or localhost to connect OpenRouter.'; update(); return;
        }
        // Open synchronously so browsers recognize the user's click and allow the popup.
        const popup = window.open('about:blank', '_blank', 'popup,width=620,height=760');
        if (!popup) { message = 'Allow the sign-in window in your browser, then try again.'; update(); return; }
        try {
            const attempt = { popup, verifier: random(), state: random(), created: Date.now(), manual: location.protocol === 'file:', exchanging: false };
            pending = attempt;
            message = 'Complete authorization in the OpenRouter window.'; update();
            const challenge = encoded(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(attempt.verifier))));
            if (pending !== attempt) return;
            const url = new URL('https://openrouter.ai/auth');
            url.searchParams.set('code_challenge', challenge);
            url.searchParams.set('code_challenge_method', 'S256');
            url.searchParams.set('key_label', 'ST3GG');
            if (!attempt.manual) {
                url.searchParams.set('callback_url', new URL('openrouter-callback.html', location.href).href);
                url.searchParams.set('state', attempt.state);
            }
            popup.location.replace(url.href);
            attempt.timer = setInterval(() => {
                if (pending !== attempt || attempt.exchanging) return;
                if (Date.now() - attempt.created > 10 * 60 * 1000) finish('Sign-in expired. Connect again.');
                else if (!attempt.manual && popup.closed) finish('Sign-in window closed. You can try again.');
            }, 500);
        } catch { finish('Could not start sign-in. Try again.'); }
    }
    async function exchange(code) {
        const attempt = pending;
        if (!attempt || attempt.exchanging) return;
        if (typeof code !== 'string' || !code.trim()) { message = 'Paste the authorization code from OpenRouter.'; update(); return; }
        if (Date.now() - attempt.created > 10 * 60 * 1000) { finish('Sign-in expired. Connect again.'); return; }
        attempt.exchanging = true;
        attempt.controller = new AbortController();
        message = 'Connecting OpenRouter…'; update();
        try {
            const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code.trim(), code_verifier: attempt.verifier, code_challenge_method: 'S256' }),
                signal: AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(30000)])
            });
            const data = await response.json();
            if (pending !== attempt) return;
            if (!response.ok || typeof data.key !== 'string' || !data.key.startsWith('sk-or-')) throw Error('exchange failed');
            syncKey(data.key);
            finish('OpenRouter connected. Your account credits fund AI requests.');
        } catch {
            if (pending === attempt) finish('Could not complete sign-in. Connect again; your previous key is unchanged.');
        }
    }
    window.addEventListener('message', event => {
        if (!pending || pending.manual || event.origin !== location.origin || event.source !== pending.popup || event.data?.type !== 'st3gg-openrouter-callback') return;
        if (pending.exchanging) return;
        if (event.data.error) { finish('OpenRouter authorization was not completed. You can try again.'); return; }
        if (event.data.state !== pending.state) { finish('Sign-in could not be verified. Connect again.'); return; }
        void exchange(event.data.code);
    });
    function mount(root, buttonClass = 'btn btn-secondary btn-sm') {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0';
        const connectButton = document.createElement('button'), disconnect = document.createElement('button');
        connectButton.type = disconnect.type = 'button';
        connectButton.className = disconnect.className = buttonClass;
        connectButton.classList.remove('quiet', 'btn-secondary');
        connectButton.classList.add(connectButton.classList.contains('nw-button') ? 'primary' : 'btn-primary');
        connectButton.textContent = 'Connect OpenRouter'; disconnect.textContent = 'Disconnect';
        connectButton.addEventListener('click', connect);
        disconnect.addEventListener('click', () => {
            pending?.controller?.abort();
            syncKey('');
            finish('Disconnected from this browser. Revoke the key at openrouter.ai/keys if needed.');
        });
        row.append(connectButton, disconnect);
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        status.style.cssText = 'font-size:11px;line-height:1.5;margin:4px 0';
        const manual = document.createElement('div'), code = document.createElement('input'), submit = document.createElement('button');
        code.className = 'input'; code.placeholder = 'Paste authorization code'; code.setAttribute('aria-label', 'OpenRouter authorization code'); code.autocomplete = 'off';
        submit.type = 'button'; submit.className = connectButton.className; submit.textContent = 'Complete connection';
        submit.addEventListener('click', () => { const value = code.value; code.value = ''; void exchange(value); });
        manual.append(code, submit);
        root.append(row, status, manual);
        controls.add({ root, connect: connectButton, disconnect, status, manual, submit }); update();
    }
    keyInput.addEventListener('input', () => { message = ''; update(); });
    window.addEventListener('pagehide', () => pending?.popup?.close());
    window.ST3GGOpenRouterAuth = { mount };
    mount(document.getElementById('aiagent-openrouter-auth'));
})();

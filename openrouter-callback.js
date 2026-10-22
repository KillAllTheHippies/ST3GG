(function () {
    'use strict';
    const params = new URLSearchParams(location.search);
    const payload = { type: 'st3gg-openrouter-callback', code: params.get('code'), state: params.get('state'), error: params.get('error') };
    history.replaceState(null, '', location.pathname);
    const status = document.getElementById('status');
    if (!window.opener || window.opener.closed) {
        status.textContent = 'Return to ST3GG and connect again. Keep the original app window open during sign-in.';
        return;
    }
    if (!payload.code && !payload.error) payload.error = 'missing_code';
    window.opener.postMessage(payload, location.origin);
    status.textContent = 'Return to ST3GG to see the connection result. This window will close when the app finishes.';
})();

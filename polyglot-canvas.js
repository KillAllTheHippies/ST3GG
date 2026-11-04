/* Cursor-anchored canvas navigation, independent of workspace rendering. */
(() => {
    'use strict';
    function attach({ viewport, stage, width, height, camera, fit, onChange, onZoom }) {
        let drag = null, space = false, suppressClick = false, destroyed = false;
        viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Layer canvas. Drag the background to pan; scroll to zoom.');
        function paint() {
            stage.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
            viewport.dataset.cameraX = String(camera.x); viewport.dataset.cameraY = String(camera.y); viewport.dataset.zoom = String(camera.zoom);
            viewport.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
            onChange(camera); onZoom(camera.zoom);
        }
        function fitView() {
            camera.fit = true;
            camera.zoom = Math.max(.05, Math.min(1, (viewport.clientWidth - 40) / width, (viewport.clientHeight - 104) / height));
            camera.x = (viewport.clientWidth - width * camera.zoom) / 2;
            camera.y = 52 + (viewport.clientHeight - 104 - height * camera.zoom) / 2;
            paint();
        }
        function zoomAt(next, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
            next = Math.max(.05, Math.min(4, next));
            const worldX = (x - camera.x) / camera.zoom, worldY = (y - camera.y) / camera.zoom;
            camera.zoom = next; camera.x = x - worldX * next; camera.y = y - worldY * next; camera.fit = false; paint();
        }
        viewport.addEventListener('wheel', event => {
            if (event.target.closest('[data-canvas-interactive]') && !event.ctrlKey) return;
            event.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
            zoomAt(camera.zoom * Math.exp(-delta * .0015), event.clientX - rect.left, event.clientY - rect.top);
        }, { passive: false });
        viewport.addEventListener('pointerdown', event => {
            if (event.button !== 0 && event.button !== 1) return;
            if (event.button === 0 && !space && event.target.closest('button,a,input,textarea,select,summary,[role="button"],[data-canvas-interactive]')) return;
            event.preventDefault(); viewport.focus({ preventScroll: true });
            drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: camera.x, y: camera.y };
            suppressClick = false; viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-panning');
        });
        viewport.addEventListener('pointermove', event => {
            if (!drag) return;
            const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
            if (Math.hypot(dx, dy) > 3) suppressClick = true;
            camera.x = drag.x + dx; camera.y = drag.y + dy; camera.fit = false; paint();
        });
        function end() { drag = null; viewport.classList.remove('is-panning'); }
        viewport.addEventListener('pointerup', end); viewport.addEventListener('pointercancel', end); viewport.addEventListener('lostpointercapture', end);
        viewport.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } }, true);
        viewport.addEventListener('keydown', event => {
            if (event.target.closest('button,a,summary,input,textarea,select,[role="button"]')) return;
            if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); space = true; viewport.classList.add('is-grabbable'); }
            if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(camera.zoom * 1.15); }
            if (event.key === '-') { event.preventDefault(); zoomAt(camera.zoom / 1.15); }
            if (event.key === '0') { event.preventDefault(); fitView(); }
        }, true);
        viewport.addEventListener('keyup', event => { if (event.code === 'Space') { space = false; viewport.classList.remove('is-grabbable'); } });
        viewport.addEventListener('blur', () => { space = false; viewport.classList.remove('is-grabbable'); });
        const observer = new ResizeObserver(() => { if (!destroyed && camera.fit) fitView(); }); observer.observe(viewport);
        const frame = requestAnimationFrame(() => { if (!destroyed) { if (fit) fitView(); else paint(); } });
        return {
            fit: fitView, zoomBy: factor => zoomAt(camera.zoom * factor),
            reveal(element) {
                const x = parseFloat(element.style.left), y = parseFloat(element.style.top), z = camera.zoom;
                const left = x * z + camera.x, top = y * z + camera.y;
                if (left < 16) camera.x += 16 - left;
                else if (left + element.offsetWidth * z > viewport.clientWidth - 16) camera.x -= left + element.offsetWidth * z - viewport.clientWidth + 16;
                if (top < 48) camera.y += 48 - top;
                else if (top + element.offsetHeight * z > viewport.clientHeight - 40) camera.y -= top + element.offsetHeight * z - viewport.clientHeight + 40;
                paint();
            },
            destroy() { destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); }
        };
    }
    window.PolyCanvas = Object.freeze({ attach });
})();

/* OpenRouter catalog prices are USD per token; present comparable per-million rates. */
(() => {
    'use strict';
    function rate(value) {
        if (typeof value !== 'string' && typeof value !== 'number') return 'Unavailable';
        if (typeof value === 'string' && !value.trim()) return 'Unavailable';
        const amount = Number(value) * 1000000;
        return Number.isFinite(amount) && amount >= 0
            ? '$' + amount.toLocaleString('en-US', { maximumSignificantDigits: 6 })
            : 'Unavailable';
    }
    function describe(model) {
        return `Input ${rate(model?.pricing?.prompt)} · Output ${rate(model?.pricing?.completion)} / 1M tokens (USD)`;
    }
    window.ST3GGModelPricing = Object.freeze({ describe });
})();

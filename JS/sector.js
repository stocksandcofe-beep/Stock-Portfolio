// =============================================================================
// CONSTANTS
// =============================================================================
const HOLD_CSV      = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Files/holdings.csv';
const WKL_CSV       = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQVR2VvNcIVmx4XkQT4A92MLsfxxdO_J8HTzif8khgRy023wnHTeIVY7DrgXuJvG6_5bnXZSyUcOhTy/pub?gid=0&single=true&output=csv';
const LOGO_BASE_URL = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Images/';
const FINNHUB_KEY   = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g';

const SHEETS_TICKERS = new Set(['WKL']);

let holdingsData = [];
let livePriceMap = {};


// =============================================================================
// HELPERS
// =============================================================================
function cleanNum(val) {
    return parseFloat(val?.toString().replace(/[^0-9.-]+/g, '')) || 0;
}

function getCol(row, keys) {
    const rowKeys = Object.keys(row);
    for (const k of keys) {
        const match = rowKeys.find(rk => rk.toLowerCase().trim() === k.toLowerCase().trim());
        if (match) return row[match];
    }
    return null;
}

function formatGBP(val, decimals = 2) {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency', currency: 'GBP',
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(val);
}

function tickerCurrency(ticker) {
    if (ticker.endsWith('.L'))  return 'GBP_PENCE';
    if (/\.(AS|PA|DE|MI|MC|BR|HE|ST|CO|OL)$/.test(ticker)) return 'EUR';
    return 'USD';
}

function parseCsv(url, opts = {}) {
    return new Promise(resolve => {
        Papa.parse(url, {
            download: true, skipEmptyLines: true, ...opts,
            complete: results => resolve(results.data),
            error:    ()      => resolve([]),
        });
    });
}


// =============================================================================
// CHART COLOURS
// =============================================================================
const CHART_COLOURS = [
    '#10b981', '#6366f1', '#f59e0b', '#3b82f6', '#ec4899',
    '#14b8a6', '#f97316', '#8b5cf6', '#ef4444', '#84cc16',
    '#06b6d4', '#d946ef', '#0ea5e9', '#a3e635', '#fb923c',
];

const COUNTRY_NAMES = {
    US: 'United States', GB: 'United Kingdom', DE: 'Germany',
    FR: 'France',        JP: 'Japan',          CN: 'China',
    CA: 'Canada',        AU: 'Australia',       CH: 'Switzerland',
    NL: 'Netherlands',   SE: 'Sweden',          DK: 'Denmark',
    IE: 'Ireland',       SG: 'Singapore',       HK: 'Hong Kong',
    IN: 'India',         BR: 'Brazil',          KR: 'South Korea',
    ES: 'Spain',         IT: 'Italy',           NO: 'Norway',
    FI: 'Finland',       NZ: 'New Zealand',     MX: 'Mexico',
    ZA: 'South Africa',
};


// =============================================================================
// DATA LOADING
// =============================================================================
async function fetchSheetsQuotes() {
    const rows = await parseCsv(WKL_CSV, { header: false });
    const map  = {};
    rows.forEach(row => {
        const ticker = row[0]?.toUpperCase().trim();
        if (!ticker) return;
        map[ticker] = {
            price:        cleanNum(row[1]),
            currencyCode: row[3]?.toUpperCase().trim() || 'EUR',
        };
    });
    return map;
}

async function fetchFinnhubQuote(ticker, retry = true) {
    try {
        const res  = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`);
        const data = await res.json();
        if (data.error) {
            if (retry) {
                await new Promise(r => setTimeout(r, 2000));
                return fetchFinnhubQuote(ticker, false);
            }
            return { ticker, price: 0 };
        }
        return { ticker, price: data.c || 0 };
    } catch (e) {
        return { ticker, price: 0 };
    }
}

async function fetchFinnhubQuotesBatched(tickers, batchSize = 5, delayMs = 300) {
    const results = [];
    for (let i = 0; i < tickers.length; i += batchSize) {
        const batch        = tickers.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(t => fetchFinnhubQuote(t)));
        results.push(...batchResults);
        if (i + batchSize < tickers.length) await new Promise(r => setTimeout(r, delayMs));
    }
    return results;
}

async function fetchProfile(ticker) {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`;
    try {
        const res  = await fetch(url);
        const data = await res.json();
        if (!data?.name) {
            await new Promise(r => setTimeout(r, 1000));
            return await (await fetch(url)).json();
        }
        return data;
    } catch (e) {
        return {};
    }
}


// =============================================================================
// TREEMAP
// =============================================================================
function binaryTreemap(items, x, y, w, h) {
    if (!items.length) return [];
    if (items.length === 1) return [{ ...items[0], x, y, w, h }];
    const total = items.reduce((s, i) => s + i.value, 0);
    let sum = 0, splitIdx = 0;
    for (let i = 0; i < items.length - 1; i++) {
        sum += items[i].value;
        splitIdx = i + 1;
        if (sum >= total / 2) break;
    }
    const ratio = sum / total;
    const a = items.slice(0, splitIdx);
    const b = items.slice(splitIdx);
    if (w >= h) {
        return [
            ...binaryTreemap(a, x,           y, w * ratio,       h),
            ...binaryTreemap(b, x + w * ratio, y, w * (1 - ratio), h),
        ];
    } else {
        return [
            ...binaryTreemap(a, x, y,           w, h * ratio),
            ...binaryTreemap(b, x, y + h * ratio, w, h * (1 - ratio)),
        ];
    }
}

function renderSectorTreemap(sortedSectors, totalSector, sectorHoldingsMap) {
    const container = document.getElementById('sector-treemap');
    if (!container) return;
    container.innerHTML = '';

    const W       = container.offsetWidth || 600;
    const sectors = sortedSectors ? sortedSectors.length : 8;
    // Dynamic height: ~60px per sector row (3 cols), minimum 240, max 480
    const rows    = Math.ceil(sectors / 3);
    const H       = Math.min(Math.max(rows * 120, 280), 560);
    const GAP     = 4;
    container.style.cssText = `position:relative;height:${H}px;`;

    const sectorItems = sortedSectors.map(([label, value], i) => ({
        label, value,
        colour:   CHART_COLOURS[i % CHART_COLOURS.length],
        holdings: (sectorHoldingsMap[label] || []).sort((a, b) => b.value - a.value),
    }));

    const layout = binaryTreemap(sectorItems, 0, 0, W, H);

    layout.forEach(block => {
        const { x, y, w, h, label, value, colour, holdings } = block;
        const pct = totalSector > 0 ? ((value / totalSector) * 100).toFixed(1) : '0.0';

        // ── Sector block ──────────────────────────────────────────────────────
        const sDiv = document.createElement('div');
        sDiv.style.cssText = `
            position:absolute;
            left:${x + GAP / 2}px; top:${y + GAP / 2}px;
            width:${Math.max(w - GAP, 1)}px; height:${Math.max(h - GAP, 1)}px;
            background:${colour}16; border:1.5px solid ${colour}40;
            border-radius:10px; overflow:hidden;
            transition:border-color 0.2s, background 0.15s;
            box-sizing:border-box;
        `;
        sDiv.addEventListener('mouseenter', () => {
            sDiv.style.borderColor = colour;
            sDiv.style.background  = colour + '28';
        });
        sDiv.addEventListener('mouseleave', () => {
            sDiv.style.borderColor = colour + '40';
            sDiv.style.background  = colour + '16';
        });
        // ── Header ────────────────────────────────────────────────────────────
        const hdrH   = w > 100 ? 44 : 28;
        const header = document.createElement('div');
        header.style.cssText = `
            padding:${w > 100 ? '7px 10px 4px' : '4px 6px'};
            background:${colour}28; border-bottom:1px solid ${colour}30;
            height:${hdrH}px; box-sizing:border-box; overflow:hidden;
        `;
        if (w > 55) {
            header.innerHTML = `
                <div style="font-size:${w > 130 ? 11 : 9}px;font-weight:700;color:${colour};
                     white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2">
                    ${label}
                </div>
                ${w > 90 ? `<div style="font-size:9px;color:#a1a1aa;margin-top:2px">
                    ${pct}%&nbsp;&nbsp;${formatGBP(value, 0)}
                </div>` : `<div style="font-size:8px;color:#a1a1aa">${pct}%</div>`}
            `;
        } else {
            header.innerHTML = `<div style="font-size:8px;font-weight:700;color:${colour}">${pct}%</div>`;
        }
        sDiv.appendChild(header);

        // ── Company sub-tiles ─────────────────────────────────────────────────
        const compH = h - GAP - hdrH;
        const compW = w - GAP;

        if (holdings.length && compH > 18 && compW > 18) {
            const compArea = document.createElement('div');
            compArea.style.cssText = `position:relative;width:${compW}px;height:${compH}px;overflow:hidden;`;

            const compLayout = binaryTreemap(holdings.map(c => ({ ...c })), 0, 0, compW, compH);

            compLayout.forEach(c => {
                const cDiv = document.createElement('div');
                const cPct = value > 0 ? ((c.value / value) * 100).toFixed(1) : '0';
                cDiv.title = `${c.company} · ${formatGBP(c.value, 0)} · ${cPct}% of sector`;
                cDiv.style.cssText = `
                    position:absolute;
                    left:${c.x + 1}px; top:${c.y + 1}px;
                    width:${Math.max(c.w - 2, 1)}px; height:${Math.max(c.h - 2, 1)}px;
                    background:${colour}0e; border:1px solid ${colour}25;
                    border-radius:5px; overflow:hidden;
                    display:flex; flex-direction:column;
                    align-items:center; justify-content:center;
                    transition:background 0.15s;
                    box-sizing:border-box;
                `;
                if (c.w > 36 && c.h > 22) {
                    cDiv.innerHTML = `
                        <span style="font-size:${c.w > 65 ? 10 : 8}px;font-weight:700;color:#e4e4e7;
                              text-align:center;padding:0 3px;white-space:nowrap;overflow:hidden;
                              text-overflow:ellipsis;max-width:100%;display:block">
                            ${c.ticker}
                        </span>
                        ${c.h > 40 ? `<span style="font-size:8px;color:#71717a;margin-top:1px">${cPct}%</span>` : ''}
                    `;
                }
                cDiv.addEventListener('mouseenter', () => cDiv.style.background = colour + '28');
                cDiv.addEventListener('mouseleave', () => cDiv.style.background = colour + '0e');
                compArea.appendChild(cDiv);
            });

            sDiv.appendChild(compArea);
        }

        container.appendChild(sDiv);
    });
}


// =============================================================================
// REGION DOUGHNUT — treemap-matched style, no legend, full-width
// =============================================================================
function renderRegionDoughnut(sortedRegions, totalRegion) {
    const wrap = document.getElementById('region-chart-wrap');
    if (!wrap) return;

    wrap.innerHTML = '';
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:24px;';

    const labels        = sortedRegions.map(([k]) => k);
    const values        = sortedRegions.map(([, v]) => v);
    const bgColours     = CHART_COLOURS.slice(0, labels.length).map(c => c + '28');
    const borderColours = CHART_COLOURS.slice(0, labels.length).map(c => c + '99');
    const hoverColours  = CHART_COLOURS.slice(0, labels.length).map(c => c + '55');

    // Doughnut — fixed size, centred
    const SZ         = 260;
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = `width:${SZ}px;height:${SZ}px;flex-shrink:0;position:relative;`;
    const canvas = document.createElement('canvas');
    canvas.id = 'region-chart';
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);

    new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data:                 values,
                backgroundColor:      bgColours,
                borderColor:          borderColours,
                borderWidth:          2,
                hoverBackgroundColor: hoverColours,
                hoverBorderColor:     CHART_COLOURS.slice(0, labels.length),
                hoverOffset:          6,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const t = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            return `  ${ctx.label}: ${formatGBP(ctx.parsed)} (${((ctx.parsed / t) * 100).toFixed(1)}%)`;
                        },
                    },
                },
            },
        },
    });

    // Legend stacked below — two-column grid to fill width
    const legend = document.createElement('div');
    legend.style.cssText = 'width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;';
    sortedRegions.forEach(([label, val], i) => {
        const colour = CHART_COLOURS[i % CHART_COLOURS.length];
        const pct    = totalRegion > 0 ? ((val / totalRegion) * 100).toFixed(1) : '0.0';
        const row    = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';
        row.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;min-width:0">
                <span style="width:9px;height:9px;border-radius:3px;flex-shrink:0;
                             background:${colour}28;border:1.5px solid ${colour}99;"></span>
                <span style="font-size:11px;color:#a1a1aa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
            </div>
            <span style="font-size:11px;font-weight:600;color:#e4e4e7;flex-shrink:0">${pct}%</span>
        `;
        legend.appendChild(row);
    });
    wrap.appendChild(legend);
}

async function loadAll() {
    const loadingEl = document.getElementById('charts-loading');
    const errorEl   = document.getElementById('charts-error');
    const contentEl = document.getElementById('charts-content');

    try {
        const [holdRows, fxData, sheetsMap] = await Promise.all([
            parseCsv(HOLD_CSV, { header: true }),
            fetch('https://api.frankfurter.app/latest?from=GBP&to=USD,EUR')
                .then(r => r.json())
                .catch(() => ({})),
            fetchSheetsQuotes(),
        ]);

        const fxRates = { USD: 1.0, EUR: 1.0, GBP: 1.0, GBP_PENCE: 0.01 };
        if (fxData?.rates) {
            fxRates.USD       = fxData.rates.USD ? 1 / fxData.rates.USD : 1.0;
            fxRates.EUR       = fxData.rates.EUR ? 1 / fxData.rates.EUR : 1.0;
            fxRates.GBP_PENCE = fxRates.GBP * 0.01;
        }

        holdingsData = holdRows.filter(
            r => getCol(r, ['Ticker']) && cleanNum(getCol(r, ['Shares'])) > 0
        );

        if (!holdingsData.length) throw new Error('No holdings data');

        const allTickers     = holdingsData.map(r => getCol(r, ['Ticker'])?.toUpperCase().trim());
        const finnhubTickers = allTickers.filter(t => !SHEETS_TICKERS.has(t));
        const finnhubQuotes  = await fetchFinnhubQuotesBatched(finnhubTickers);

        finnhubQuotes.forEach(({ ticker, price }) => {
            const currency = tickerCurrency(ticker);
            livePriceMap[ticker] = {
                price,
                rate:         fxRates[currency] ?? 1.0,
                currencyCode: currency === 'GBP_PENCE' ? 'GBP' : currency,
            };
        });

        SHEETS_TICKERS.forEach(ticker => {
            const data     = sheetsMap[ticker];
            const currency = data?.currencyCode || 'EUR';
            livePriceMap[ticker] = {
                price:        data?.price || 0,
                rate:         fxRates[currency] ?? 1.0,
                currencyCode: currency,
            };
        });

        // Fetch Finnhub profiles for sector/region
        const profiles = [];
        for (let i = 0; i < holdingsData.length; i++) {
            const ticker = getCol(holdingsData[i], ['Ticker'])?.toUpperCase().trim();
            if (i > 0 && i % 5 === 0) await new Promise(r => setTimeout(r, 500));
            profiles.push(fetchProfile(ticker));
        }
        const profileResults = await Promise.allSettled(profiles);

        const sectorMap         = {};
        const regionMap         = {};
        const sectorHoldingsMap = {};

        holdingsData.forEach((row, i) => {
            const ticker      = getCol(row, ['Ticker'])?.toUpperCase().trim();
            const company     = getCol(row, ['Company']) || ticker;
            const ld          = livePriceMap[ticker];
            const shares      = cleanNum(getCol(row, ['Shares']));
            const curValueGBP = ld ? shares * ld.price * ld.rate : 0;
            const profile     = profileResults[i].status === 'fulfilled' ? profileResults[i].value : {};
            const sector      = profile?.finnhubIndustry || 'Other';
            const countryCode = profile?.country || '';
            const country     = COUNTRY_NAMES[countryCode] || (countryCode || 'Other');

            sectorMap[sector]  = (sectorMap[sector]  || 0) + curValueGBP;
            regionMap[country] = (regionMap[country] || 0) + curValueGBP;
            if (!sectorHoldingsMap[sector]) sectorHoldingsMap[sector] = [];
            sectorHoldingsMap[sector].push({ company, ticker, value: curValueGBP });
        });

        const sortedSectors = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]);
        const sortedRegions = Object.entries(regionMap).sort((a, b) => b[1] - a[1]);
        const totalSector   = sortedSectors.reduce((s, [, v]) => s + v, 0);
        const totalRegion   = sortedRegions.reduce((s, [, v]) => s + v, 0);

        // Concentration warnings
        const maxSectorPct = sortedSectors[0] ? (sortedSectors[0][1] / totalSector) * 100 : 0;
        const maxRegionPct = sortedRegions[0] ? (sortedRegions[0][1] / totalRegion) * 100 : 0;
        const sectorWarn   = document.getElementById('sector-warning');
        const regionWarn   = document.getElementById('region-warning');
        if (sectorWarn) sectorWarn.classList.toggle('hidden', maxSectorPct < 40);
        if (regionWarn) regionWarn.classList.toggle('hidden', maxRegionPct < 40);

        loadingEl.classList.add('hidden');
        contentEl.style.display = 'block';

        // Render after content is visible so offsetWidth returns the real card width
        requestAnimationFrame(() => {
            renderSectorTreemap(sortedSectors, totalSector, sectorHoldingsMap);
            renderRegionDoughnut(sortedRegions, totalRegion);
        });

    } catch (e) {
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}





// =============================================================================
// INIT
// =============================================================================
function toggleHoldingsMenu(btn) {
    const parent  = btn.parentElement;
    const submenu = parent.querySelector('.holdings-submenu');
    const chevron = btn.querySelector('.holdings-chevron');
    if (submenu) submenu.classList.toggle('collapsed');
    if (chevron) chevron.classList.toggle('rotated');
}

loadAll();

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

        function makeChartConfig(sorted, total, legendId, drillMap) {
            const labels  = sorted.map(([k]) => k);
            const values  = sorted.map(([, v]) => v);
            const colours = CHART_COLOURS.slice(0, sorted.length);

            const legendEl = document.getElementById(legendId);
            if (legendEl) {
                legendEl.innerHTML = sorted.map(([label, val], i) => {
                    const pct      = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
                    const safeData = JSON.stringify(drillMap[label] || []).replace(/"/g, '&quot;');
                    return `<div class="flex items-center justify-between gap-2 text-xs cursor-pointer hover:text-white transition-colors"
                                 onclick="showDrill('${label.replace(/'/g, "\\'")}', ${safeData}, ${total})">
                        <div class="flex items-center gap-2 min-w-0">
                            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${colours[i]}"></span>
                            <span class="text-zinc-400 truncate">${label}</span>
                        </div>
                        <span class="text-zinc-300 font-semibold flex-shrink-0">${pct}%</span>
                    </div>`;
                }).join('');
            }

            return {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{ data: values, backgroundColor: colours, borderColor: '#0B0E11', borderWidth: 3, hoverOffset: 6 }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '65%',
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => {
                            const t = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            return `  ${ctx.label}: ${formatGBP(ctx.parsed)} (${((ctx.parsed / t) * 100).toFixed(1)}%)`;
                        }}},
                    },
                    onClick: (_, elements) => {
                        if (!elements.length) return;
                        const label = labels[elements[0].index];
                        showDrill(label, drillMap[label] || [], total);
                    },
                },
            };
        }

        new Chart(document.getElementById('sector-chart'), makeChartConfig(sortedSectors, totalSector, 'sector-legend', sectorHoldingsMap));
        new Chart(document.getElementById('region-chart'), makeChartConfig(sortedRegions, totalRegion, 'region-legend', {}));

        loadingEl.classList.add('hidden');
        contentEl.style.display = 'block';

    } catch (e) {
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}


// =============================================================================
// DRILL DOWN PANEL
// =============================================================================
function showDrill(label, holdings, total) {
    const panel   = document.getElementById('sector-drill');
    const titleEl = document.getElementById('sector-drill-title');
    const bodyEl  = document.getElementById('sector-drill-body');
    if (!panel || !titleEl || !bodyEl) return;

    const sectorTotal = holdings.reduce((s, h) => s + h.value, 0);
    const pct         = total > 0 ? ((sectorTotal / total) * 100).toFixed(1) : '0.0';
    titleEl.textContent = `${label} — ${pct}% of portfolio`;

    const sorted = [...holdings].sort((a, b) => b.value - a.value);
    bodyEl.innerHTML = sorted.map(h => {
        const hPct = sectorTotal > 0 ? ((h.value / sectorTotal) * 100).toFixed(1) : '0.0';
        return `<div class="flex items-center justify-between gap-3 bg-zinc-900/60 rounded-xl px-4 py-3">
            <div class="flex items-center gap-2 min-w-0">
                <div class="w-7 h-7 rounded-lg bg-white flex items-center justify-center overflow-hidden flex-shrink-0 border border-zinc-800">
                    <img src="${LOGO_BASE_URL}${h.ticker}.png"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
                         class="w-full h-full object-contain p-0.5" alt="${h.ticker}">
                    <div class="hidden w-full h-full items-center justify-center text-[9px] font-bold text-zinc-500 bg-zinc-900 uppercase">${h.ticker.substring(0, 2)}</div>
                </div>
                <span class="text-zinc-200 text-sm font-medium truncate">${h.company}</span>
            </div>
            <div class="text-right flex-shrink-0">
                <p class="text-white text-sm font-semibold">${formatGBP(h.value, 0)}</p>
                <p class="text-zinc-500 text-xs">${hPct}%</p>
            </div>
        </div>`;
    }).join('');

    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


// =============================================================================
// INIT
// =============================================================================
function toggleHoldingsMenu(btn) {
    const parent  = btn.parentElement;
    const submenu = parent.querySelector('.holdings-submenu');
    const chevron = btn.querySelector('.holdings-chevron');
    if (submenu) submenu.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotate-180');
}

loadAll();

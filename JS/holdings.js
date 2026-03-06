// =============================================================================
// CONSTANTS & STATE
// =============================================================================
const HOLD_CSV      = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Files/holdings.csv';
const WKL_CSV       = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQVR2VvNcIVmx4XkQT4A92MLsfxxdO_J8HTzif8khgRy023wnHTeIVY7DrgXuJvG6_5bnXZSyUcOhTy/pub?gid=0&single=true&output=csv'; // Google Sheets published CSV — WKL only
const LOGO_BASE_URL = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Images/';
const FINNHUB_KEY   = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g';

// Tickers to fetch from Google Sheets instead of Finnhub
const SHEETS_TICKERS = new Set(['WKL']);

let currentHoldingsData = [];
let livePriceMap        = {};
let totalValLatest      = 0;
let sortKey             = '';
let sortDir             = 1;
let lastRefreshedAt     = null;

const urlParams  = new URLSearchParams(window.location.search);
const activeView = urlParams.get('view') || 'table';


// =============================================================================
// VIEW SWITCHING
// =============================================================================
function initView() {
    const isCharts = activeView === 'charts';
    document.getElementById('view-table').classList.toggle('hidden', isCharts);
    document.getElementById('view-charts').classList.toggle('hidden', !isCharts);
    document.getElementById('page-title').textContent = isCharts ? 'Sector & Region' : 'Holdings';
    document.querySelectorAll('.holdings-submenu').forEach(submenu => {
        submenu.querySelectorAll('.sub-nav-item').forEach(link => {
            const isActive = isCharts ? link.href.includes('view=charts') : link.href.includes('view=table');
            link.classList.toggle('text-emerald-400', isActive);
            link.classList.toggle('bg-emerald-500/10', isActive);
            link.classList.toggle('text-zinc-400', !isActive);
        });
    });
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.classList.toggle('hidden', isCharts);
}

function toggleHoldingsMenu(btn) {
    const parent  = btn.parentElement;
    const submenu = parent.querySelector('.holdings-submenu');
    const chevron = btn.querySelector('.holdings-chevron');
    if (submenu) submenu.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotate-180');
}


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

function getCurrencySymbol(ticker) {
    const liveData = livePriceMap[ticker];
    if (!liveData) return '$';
    const map = { GBP: '£', EUR: '€', USD: '$' };
    return map[liveData.currencyCode] || '$';
}

function tickerCurrency(ticker) {
    if (ticker.endsWith('.L'))  return 'GBP_PENCE';
    if (/\.(AS|PA|DE|MI|MC|BR|HE|ST|CO|OL)$/.test(ticker)) return 'EUR';
    return 'USD';
}


// =============================================================================
// DATA LOADING
// =============================================================================
function parseCsv(url, opts = {}) {
    return new Promise(resolve => {
        Papa.parse(url, {
            download: true, skipEmptyLines: true, ...opts,
            complete: results => resolve(results.data),
            error:    ()      => resolve([]),
        });
    });
}

function showTableError(msg) {
    const tbody = document.getElementById('holdings-table-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-rose-400 text-sm">${msg}</td></tr>`;
}

// Fetch a single quote from Finnhub, with one retry on rate limit
async function fetchFinnhubQuote(ticker, retry = true) {
    try {
        const res  = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`);
        const data = await res.json();
        if (data.error) {
            // Rate limited — wait 2s and retry once
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

// Fetch Finnhub quotes in batches to avoid rate limits
// Free tier = 60 calls/min — batches of 5 with 300ms gap is safe
async function fetchFinnhubQuotesBatched(tickers, batchSize = 5, delayMs = 300) {
    const results = [];
    for (let i = 0; i < tickers.length; i += batchSize) {
        const batch = tickers.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(t => fetchFinnhubQuote(t)));
        results.push(...batchResults);
        if (i + batchSize < tickers.length) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    return results;
}

// Fetch WKL price from Google Sheets CSV
// Expected sheet columns: Ticker, Price, ..., Currency
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

async function loadAll() {
    // Fire holdings CSV, FX rates, and Google Sheets (WKL) all in parallel
    const [holdRows, fxData, sheetsMap] = await Promise.all([
        parseCsv(HOLD_CSV, { header: true }),
        fetch('https://api.frankfurter.app/latest?from=GBP&to=USD,EUR')
            .then(r => r.json())
            .catch(() => ({})),
        fetchSheetsQuotes(),
    ]);

    // FX rates — Frankfurter returns rates FROM GBP so invert them
    const fxRates = { USD: 1.0, EUR: 1.0, GBP: 1.0, GBP_PENCE: 0.01 };
    if (fxData?.rates) {
        fxRates.USD       = fxData.rates.USD ? 1 / fxData.rates.USD : 1.0;
        fxRates.EUR       = fxData.rates.EUR ? 1 / fxData.rates.EUR : 1.0;
        fxRates.GBP_PENCE = fxRates.GBP * 0.01;
    }

    // Filter valid holdings
    currentHoldingsData = holdRows.filter(
        r => getCol(r, ['Ticker']) && cleanNum(getCol(r, ['Shares'])) > 0
    );

    if (!currentHoldingsData.length) {
        showTableError('No holdings data found. Check that the CSV is up to date and has a Ticker and Shares column.');
        return;
    }

    // Split tickers: Google Sheets vs Finnhub
    const allTickers     = currentHoldingsData.map(r => getCol(r, ['Ticker'])?.toUpperCase().trim());
    const finnhubTickers = allTickers.filter(t => !SHEETS_TICKERS.has(t));

    // Fetch all Finnhub quotes in parallel
    const finnhubQuotes = await fetchFinnhubQuotesBatched(finnhubTickers);

    // Build live price map — Finnhub tickers
    finnhubQuotes.forEach(({ ticker, price }) => {
        const currency = tickerCurrency(ticker);
        livePriceMap[ticker] = {
            price,
            rate:         fxRates[currency] ?? 1.0,
            currencyCode: currency === 'GBP_PENCE' ? 'GBP' : currency,
        };
    });

    // Build live price map — Google Sheets tickers (WKL)
    SHEETS_TICKERS.forEach(ticker => {
        const data     = sheetsMap[ticker];
        const currency = data?.currencyCode || 'EUR';
        livePriceMap[ticker] = {
            price:        data?.price || 0,
            rate:         fxRates[currency] ?? 1.0,
            currencyCode: currency,
        };
    });

    // Compute portfolio total from live prices
    totalValLatest = currentHoldingsData.reduce((sum, row) => {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const ld     = livePriceMap[ticker];
        const shares = cleanNum(getCol(row, ['Shares']));
        return sum + (ld ? shares * ld.price * ld.rate : 0);
    }, 0);

    if (activeView === 'charts') {
        buildCharts(currentHoldingsData);
    } else {
        displayHoldings(currentHoldingsData);
    }
}

loadAll();

function refreshLivePrices() {
    ['refresh-btn', 'header-refresh-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = true;
            const icon = btn.querySelector('svg');
            if (icon) icon.style.animation = 'spin 0.8s linear infinite';
        }
    });
    livePriceMap = {};
    loadAll();
}

function stopRefreshSpin() {
    ['refresh-btn', 'header-refresh-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = false;
            const icon = btn.querySelector('svg');
            if (icon) icon.style.animation = '';
        }
    });
    lastRefreshedAt = new Date();
    updateRefreshLabel();
}

function updateRefreshLabel() {
    const el = document.getElementById('last-refreshed');
    if (!el || !lastRefreshedAt) return;
    const mins = Math.floor((new Date() - lastRefreshedAt) / 60000);
    el.textContent = mins === 0 ? 'just now' : mins + 'm ago';
}


// =============================================================================
// SORTING
// =============================================================================
function sortHoldings(key) {
    if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = 1; }

    document.querySelectorAll('.sort-arrow').forEach(el => {
        el.textContent = '↕';
        el.classList.remove('text-emerald-400');
        el.classList.add('text-zinc-600');
    });
    const activeArrow = document.getElementById(`sort-${key}`);
    if (activeArrow) {
        activeArrow.textContent = sortDir === 1 ? '↓' : '↑';
        activeArrow.classList.remove('text-zinc-600');
        activeArrow.classList.add('text-emerald-400');
    }

    function liveGBP(row) {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const ld     = livePriceMap[ticker];
        const shares = cleanNum(getCol(row, ['Shares']));
        return ld ? shares * ld.price * ld.rate : 0;
    }

    currentHoldingsData.sort((a, b) => {
        let valA, valB;
        if (key === 'Company') {
            return (getCol(a, ['Company']) || '').localeCompare(getCol(b, ['Company']) || '') * sortDir;
        } else if (key === 'BEP') {
            valA = cleanNum(getCol(a, ['BEP Price']));
            valB = cleanNum(getCol(b, ['BEP Price']));
        } else if (key === 'Shares') {
            valA = cleanNum(getCol(a, ['Shares']));
            valB = cleanNum(getCol(b, ['Shares']));
        } else if (key === 'Cost Basis') {
            valA = cleanNum(getCol(a, ['Total Purchase Cost']));
            valB = cleanNum(getCol(b, ['Total Purchase Cost']));
        } else if (key === 'Current Value' || key === 'Allocation') {
            valA = liveGBP(a); valB = liveGBP(b);
        } else if (key === 'Total Unrealised P/L') {
            valA = liveGBP(a) - cleanNum(getCol(a, ['Total Purchase Cost']));
            valB = liveGBP(b) - cleanNum(getCol(b, ['Total Purchase Cost']));
        } else if (key === '% Return') {
            const costA = cleanNum(getCol(a, ['Total Purchase Cost']));
            const costB = cleanNum(getCol(b, ['Total Purchase Cost']));
            valA = costA !== 0 ? liveGBP(a) / costA : 0;
            valB = costB !== 0 ? liveGBP(b) / costB : 0;
        } else {
            valA = cleanNum(getCol(a, [key]));
            valB = cleanNum(getCol(b, [key]));
        }
        return valA > valB ? sortDir : valA < valB ? -sortDir : 0;
    });

    displayHoldings(currentHoldingsData);
}


// =============================================================================
// TABLE DISPLAY
// =============================================================================
function displayHoldings(data) {
    const tbody = document.getElementById('holdings-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const fragment = document.createDocumentFragment();

    data.forEach(row => {
        const ticker           = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const shares           = cleanNum(getCol(row, ['Shares']));
        const bepLocal         = cleanNum(getCol(row, ['BEP Price']));
        const liveData         = livePriceMap[ticker];
        const activePriceLocal = liveData ? liveData.price : 0;
        const activeRate       = liveData ? liveData.rate  : 1.0;
        const curValueGBP      = shares * activePriceLocal * activeRate;
        const weight           = totalValLatest > 0 ? (curValueGBP / totalValLatest) * 100 : 0;
        const costGBP          = cleanNum(getCol(row, ['Total Purchase Cost']));
        const profitGBP        = curValueGBP - costGBP;
        const percReturn       = costGBP !== 0 ? ((curValueGBP / costGBP) - 1) * 100 : 0;
        const sym              = getCurrencySymbol(ticker);
        const profitSign       = profitGBP  >= 0 ? '+' : '-';
        const returnSign       = percReturn >= 0 ? '+' : '-';
        const profitClass      = profitGBP  >= 0 ? 'text-emerald-400' : 'text-rose-400';
        const returnClass      = percReturn >= 0 ? 'text-emerald-400' : 'text-rose-400';

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-white/5 transition border-b border-zinc-800/50 text-sm';
        tr.innerHTML = `
            <td class="p-4 text-left">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center overflow-hidden flex-shrink-0 border border-zinc-800">
                        <img src="${LOGO_BASE_URL}${ticker}.png"
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
                             class="w-full h-full object-contain p-1" alt="${ticker} logo">
                        <div class="hidden w-full h-full items-center justify-center text-[10px] font-bold text-zinc-500 bg-zinc-900 uppercase">
                            ${ticker.substring(0, 2)}
                        </div>
                    </div>
                    <div class="font-bold text-white leading-tight">${getCol(row, ['Company'])}</div>
                </div>
            </td>
            <td class="p-4 text-center text-zinc-400">${shares.toLocaleString()}</td>
            <td class="p-4 text-center text-zinc-300">${sym}${bepLocal.toFixed(2)}</td>
            <td class="p-4 text-center text-zinc-400">${formatGBP(costGBP, 0)}</td>
            <td class="p-4 text-center text-emerald-400">${liveData ? sym + activePriceLocal.toFixed(2) : '--'}</td>
            <td class="p-4 text-center text-white">${formatGBP(curValueGBP)}</td>
            <td class="p-4 text-center ${profitClass}">${profitSign}${formatGBP(Math.abs(profitGBP), 0)}</td>
            <td class="p-4 text-center ${returnClass}">${returnSign}${Math.abs(percReturn).toFixed(2)}%</td>
            <td class="p-4 text-center text-zinc-300">
                <div class="flex flex-col items-center gap-1">
                    <span>${weight.toFixed(1)}%</span>
                    <div class="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div class="h-full bg-emerald-500 rounded-full" style="width:${Math.min(weight, 100).toFixed(1)}%"></div>
                    </div>
                </div>
            </td>
        `;
        fragment.appendChild(tr);
    });

    // Totals row
    let totalValue = 0, totalCost = 0, totalProfit = 0, totalShares = 0;
    data.forEach(row => {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const ld     = livePriceMap[ticker];
        const shares = cleanNum(getCol(row, ['Shares']));
        const val    = ld ? shares * ld.price * ld.rate : 0;
        const cost   = cleanNum(getCol(row, ['Total Purchase Cost']));
        totalValue  += val;
        totalCost   += cost;
        totalProfit += val - cost;
        totalShares += shares;
    });

    const totalReturn      = totalCost !== 0 ? ((totalValue / totalCost) - 1) * 100 : 0;
    const totalProfitClass = totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400';
    const totalReturnClass = totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400';
    const totalProfitSign  = totalProfit >= 0 ? '+' : '';
    const totalReturnSign  = totalReturn >= 0 ? '+' : '';

    tbody.appendChild(fragment);

    // Update summary bar
    const sumValue  = document.getElementById('sum-value');
    const sumCost   = document.getElementById('sum-cost');
    const sumPl     = document.getElementById('sum-pl');
    const sumReturn = document.getElementById('sum-return');
    if (sumValue)  sumValue.textContent  = formatGBP(totalValue);
    if (sumCost)   sumCost.textContent   = formatGBP(totalCost, 0);
    if (sumPl) {
        sumPl.textContent  = (totalProfit >= 0 ? '+' : '') + formatGBP(totalProfit, 0);
        sumPl.className    = `text-base font-bold ${totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }
    if (sumReturn) {
        sumReturn.textContent = (totalReturn >= 0 ? '+' : '') + totalReturn.toFixed(2) + '%';
        sumReturn.className   = `text-base font-bold ${totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    stopRefreshSpin();
}


// =============================================================================
// CHARTS — Sector & Region breakdown
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

async function buildCharts(data) {
    const loadingEl = document.getElementById('charts-loading');
    const errorEl   = document.getElementById('charts-error');
    const contentEl = document.getElementById('charts-content');

    try {
        const profiles = [];
        for (let i = 0; i < data.length; i++) {
            const ticker = getCol(data[i], ['Ticker'])?.toUpperCase().trim();
            if (i > 0 && i % 5 === 0) await new Promise(r => setTimeout(r, 500));
            profiles.push(fetchProfile(ticker));
        }
        const profileResults = await Promise.allSettled(profiles);

        const sectorMap         = {};
        const regionMap         = {};
        const sectorHoldingsMap = {}; // sector -> [{company, ticker, value, pct}]

        data.forEach((row, i) => {
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

        // Chart config — no built-in legend (we build HTML legends)
        function makeChartConfig(sorted, total, canvasId, legendId, drillMap) {
            const labels = sorted.map(([k]) => k);
            const values = sorted.map(([, v]) => v);
            const colours = CHART_COLOURS.slice(0, sorted.length);

            // HTML legend
            const legendEl = document.getElementById(legendId);
            if (legendEl) {
                legendEl.innerHTML = sorted.map(([label, val], i) => {
                    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
                    return `<div class="flex items-center justify-between gap-2 text-xs cursor-pointer hover:text-white transition-colors"
                                 onclick="showSectorDrill('${label.replace(/'/g, "\'")}', ${JSON.stringify(drillMap[label] || []).replace(/"/g, '&quot;')}, ${total})">
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
                        showSectorDrill(label, drillMap[label] || [], total);
                    },
                },
            };
        }

        new Chart(document.getElementById('sector-chart'), makeChartConfig(sortedSectors, totalSector, 'sector-chart', 'sector-legend', sectorHoldingsMap));
        new Chart(document.getElementById('region-chart'), makeChartConfig(sortedRegions, totalRegion, 'region-chart', 'region-legend', {}));

        loadingEl.classList.add('hidden');
        contentEl.style.display = 'block';

    } catch (e) {
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

function showSectorDrill(label, holdings, total) {
    const panel     = document.getElementById('sector-drill');
    const titleEl   = document.getElementById('sector-drill-title');
    const bodyEl    = document.getElementById('sector-drill-body');
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
initView();

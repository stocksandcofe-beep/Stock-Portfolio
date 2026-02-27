// =============================================================================
// CONSTANTS & STATE
// =============================================================================
const PERF_CSV      = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Files/performance.csv';
const HOLD_CSV      = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Files/holdings.csv';
const LIVE_CSV      = '/live-prices/spreadsheets/d/e/2PACX-1vQVR2VvNcIVmx4XkQT4A92MLsfxxdO_J8HTzif8khgRy023wnHTeIVY7DrgXuJvG6_5bnXZSyUcOhTy/pub?gid=0&single=true&output=csv';
const LOGO_BASE_URL = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Images/';
const FINNHUB_KEY   = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g';

let currentHoldingsData = [];
let livePriceMap        = {};
let totalValLatest      = 0;
let sortKey             = '';
let sortDir             = 1;

// Read which view to show from the URL — defaults to 'table'
const urlParams  = new URLSearchParams(window.location.search);
const activeView = urlParams.get('view') || 'table';


// =============================================================================
// VIEW SWITCHING — show/hide table vs charts, highlight correct sub-nav item,
// keep accordion open, update page title
// =============================================================================
function initView() {
    const isCharts = activeView === 'charts';

    // Show/hide main content areas
    document.getElementById('view-table').classList.toggle('hidden', isCharts);
    document.getElementById('view-charts').classList.toggle('hidden', !isCharts);

    // Update page title
    document.getElementById('page-title').textContent = isCharts ? 'Sector & Region' : 'Holdings';

    // Highlight correct sub-nav item in both desktop and mobile sidebars
    document.querySelectorAll('.holdings-submenu').forEach(submenu => {
        submenu.querySelectorAll('.sub-nav-item').forEach(link => {
            const isActive = isCharts
                ? link.href.includes('view=charts')
                : link.href.includes('view=table');
            link.classList.toggle('text-emerald-400', isActive);
            link.classList.toggle('bg-emerald-500/10', isActive);
            link.classList.toggle('text-zinc-400', !isActive);
        });
    });

    // Refresh button lives in the Live Price column header — hide whole table view on charts
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.closest('th')?.closest('thead')?.closest('table')?.closest('div');
}

// Accordion toggle — only toggles the submenu and chevron within the same nav block
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
    if (liveData.currencyCode) {
        const map = { GBP: '£', EUR: '€', USD: '$' };
        return map[liveData.currencyCode] || '$';
    }
    return '$';
}


// =============================================================================
// DATA LOADING — chained: Portfolio Total → Live Prices → Holdings
// On load, routes to either the table display or the charts display
// =============================================================================
Papa.parse(PERF_CSV, {
    download: true, header: false, skipEmptyLines: true,
    complete(results) {
        const latest = results.data.filter(r => r[0] && r[47]).pop();
        totalValLatest = cleanNum(latest?.[47]);
        fetchLivePrices();
    },
});

function fetchLivePrices() {
    Papa.parse(LIVE_CSV, {
        download: true, header: false, skipEmptyLines: true,
        complete(results) {
            results.data.forEach(row => {
                const ticker = row[0]?.toUpperCase().trim();
                if (!ticker) return;
                    console.log('LIVE ROW:', row[0], row[1], row[2], row[3]);
                livePriceMap[ticker] = {
                    price:        cleanNum(row[1]),
                    rate:         cleanNum(row[2]) || 1.0,
                    currencyCode: row[3]?.toUpperCase().trim() || null,
                };
            });
            fetchHoldings();
        },
    });
}

function fetchHoldings() {
    Papa.parse(HOLD_CSV, {
        download: true, header: true, skipEmptyLines: true,
        complete(results) {
            currentHoldingsData = results.data.filter(
                r => getCol(r, ['Ticker']) && cleanNum(getCol(r, ['Shares'])) > 0
            );
            if (activeView === 'charts') {
                buildCharts(currentHoldingsData);
            } else {
                displayHoldings(currentHoldingsData);
            }
        },
    });
}

function refreshLivePrices() {
    const btn = document.getElementById('refresh-btn');
    if (btn) {
        btn.disabled = true;
        const icon = btn.querySelector('svg') || btn.querySelector('i');
        if (icon) icon.style.animation = 'spin 0.8s linear infinite';
    }
    livePriceMap = {};
    fetchLivePrices();
}

function stopRefreshSpin() {
    const btn = document.getElementById('refresh-btn');
    if (btn) {
        btn.disabled = false;
        const icon = btn.querySelector('svg');
        if (icon) icon.style.animation = '';
    }
}


// =============================================================================
// SORTING
// =============================================================================
function sortHoldings(key) {
    if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = 1; }

    // Update all sort arrows — reset to neutral, highlight active one
    document.querySelectorAll('.sort-arrow').forEach(el => {
        el.textContent = '↕';
        el.classList.remove('text-emerald-400', 'text-white');
        el.classList.add('text-zinc-600');
    });
    const activeArrow = document.getElementById(`sort-${key}`);
    if (activeArrow) {
        activeArrow.textContent = sortDir === 1 ? '↓' : '↑';
        activeArrow.classList.remove('text-zinc-600');
        activeArrow.classList.add('text-emerald-400');
    }

    currentHoldingsData.sort((a, b) => {
        let valA, valB;
        if (key === 'Allocation') {
            valA = cleanNum(getCol(a, ['Current Value']));
            valB = cleanNum(getCol(b, ['Current Value']));
        } else if (key === 'BEP') {
            valA = cleanNum(getCol(a, ['BEP Price']));
            valB = cleanNum(getCol(b, ['BEP Price']));
        } else if (key === 'Company') {
            valA = getCol(a, ['Company']) || '';
            valB = getCol(b, ['Company']) || '';
            return valA.localeCompare(valB) * sortDir;
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
        const activePriceLocal = liveData ? liveData.price : cleanNum(getCol(row, ['Current Price']));
        const activeRate       = liveData ? liveData.rate : 1.0;

        const curValueGBP = shares * activePriceLocal * activeRate;
        const weight      = totalValLatest > 0 ? (curValueGBP / totalValLatest) * 100 : 0;
        const costGBP     = cleanNum(getCol(row, ['Current Value'])) - cleanNum(getCol(row, ['Total Unrealised P/L']));
        const profitGBP   = curValueGBP - costGBP;
        const percReturn  = costGBP !== 0 ? ((curValueGBP / costGBP) - 1) * 100 : 0;

        const sym         = getCurrencySymbol(ticker);
        const profitSign  = profitGBP  >= 0 ? '+' : '-';
        const returnSign  = percReturn >= 0 ? '+' : '-';
        const profitClass = profitGBP  >= 0 ? 'text-emerald-400' : 'text-rose-400';
        const returnClass = percReturn >= 0 ? 'text-emerald-400' : 'text-rose-400';

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-white/5 transition border-b border-zinc-800/50 text-sm';
        tr.innerHTML = `
            <td class="p-4 text-left" style="background: linear-gradient(90deg, rgba(16,185,129,0.1) ${weight}%, transparent ${weight}%);">
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
            <td class="p-4 text-center font-mono text-zinc-400">${shares}</td>
            <td class="p-4 text-center text-zinc-300">${sym}${bepLocal.toFixed(2)}</td>
            <td class="p-4 text-center font-bold text-emerald-400">${liveData ? sym + activePriceLocal.toFixed(2) : '--'}</td>
            <td class="p-4 text-center font-medium text-white">${formatGBP(curValueGBP)}</td>
            <td class="p-4 text-center font-semibold ${profitClass}">${profitSign}${formatGBP(Math.abs(profitGBP), 0)}</td>
            <td class="p-4 text-center font-bold ${returnClass}">${returnSign}${Math.abs(percReturn).toFixed(2)}%</td>
            <td class="p-4 text-center font-medium text-zinc-300">${weight.toFixed(1)}%</td>
        `;
        fragment.appendChild(tr);
    });

    // --- Totals row — prepended as first row of tbody ---
    let totalValue  = 0;
    let totalCost   = 0;
    let totalProfit = 0;
    let totalShares = 0;

    data.forEach(row => {
        const ticker           = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const liveData         = livePriceMap[ticker];
        const shares           = cleanNum(getCol(row, ['Shares']));
        const activePriceLocal = liveData ? liveData.price : cleanNum(getCol(row, ['Current Price']));
        const activeRate       = liveData ? liveData.rate : 1.0;
        const curValueGBP      = shares * activePriceLocal * activeRate;
        const costGBP          = cleanNum(getCol(row, ['Current Value'])) - cleanNum(getCol(row, ['Total Unrealised P/L']));
        totalValue  += curValueGBP;
        totalCost   += costGBP;
        totalProfit += (curValueGBP - costGBP);
        totalShares += cleanNum(getCol(row, ['Shares']));
    });

    const totalReturn      = totalCost !== 0 ? ((totalValue / totalCost) - 1) * 100 : 0;
    const totalProfitClass = totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400';
    const totalReturnClass = totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400';
    const totalProfitSign  = totalProfit >= 0 ? '+' : '';
    const totalReturnSign  = totalReturn >= 0 ? '+' : '';

    const totalTr = document.createElement('tr');
    totalTr.className = 'border-b-2 border-zinc-700 bg-zinc-900/60 text-sm font-bold';
    totalTr.innerHTML = `
        <td class="p-4 text-left text-zinc-300 uppercase text-xs tracking-wider">Total Portfolio</td>
        <td class="p-4 text-center font-mono text-zinc-300">${totalShares.toLocaleString()}</td>
        <td class="p-4" colspan="2"></td>
        <td class="p-4 text-center text-white">${formatGBP(totalValue)}</td>
        <td class="p-4 text-center ${totalProfitClass}">${totalProfitSign}${formatGBP(totalProfit, 0)}</td>
        <td class="p-4 text-center ${totalReturnClass}">${totalReturnSign}${totalReturn.toFixed(2)}%</td>
        <td class="p-4 text-center text-zinc-400">100%</td>
    `;

    // Append all data rows first, then insert totals at the very top
    tbody.appendChild(fragment);
    tbody.insertBefore(totalTr, tbody.firstChild);
    stopRefreshSpin();
}


// =============================================================================
// CHARTS — Sector & Region breakdown
// Fetches Finnhub profile for each ticker in parallel, aggregates by GBP value,
// then renders two donut charts via Chart.js
// =============================================================================
const CHART_COLOURS = [
    '#10b981', '#6366f1', '#f59e0b', '#3b82f6', '#ec4899',
    '#14b8a6', '#f97316', '#8b5cf6', '#ef4444', '#84cc16',
    '#06b6d4', '#d946ef', '#0ea5e9', '#a3e635', '#fb923c',
];

// Maps ISO 2-letter country codes to readable names
const COUNTRY_NAMES = {
    US: 'United States', GB: 'United Kingdom', DE: 'Germany',
    FR: 'France', JP: 'Japan', CN: 'China', CA: 'Canada',
    AU: 'Australia', CH: 'Switzerland', NL: 'Netherlands',
    SE: 'Sweden', DK: 'Denmark', IE: 'Ireland', SG: 'Singapore',
    HK: 'Hong Kong', IN: 'India', BR: 'Brazil', KR: 'South Korea',
    ES: 'Spain', IT: 'Italy', NO: 'Norway', FI: 'Finland',
    NZ: 'New Zealand', MX: 'Mexico', ZA: 'South Africa',
};

// Fetches a Finnhub profile with one retry on empty/rate-limited responses
async function fetchProfile(ticker) {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`;
    try {
        const res  = await fetch(url);
        const data = await res.json();
        // If response is empty (rate limited), wait 1s and retry once
        if (!data?.name) {
            await new Promise(r => setTimeout(r, 1000));
            const res2  = await fetch(url);
            const data2 = await res2.json();
            return data2;
        }
        return data;
    } catch (e) {
        return {};
    }
}

async function buildCharts(data) {
    const loading = document.getElementById('charts-loading');
    const content = document.getElementById('charts-content');

    // Fetch all profiles — stagger slightly to avoid hitting rate limits
    const profiles = [];
    for (let i = 0; i < data.length; i++) {
        const ticker = getCol(data[i], ['Ticker'])?.toUpperCase().trim();
        if (i > 0 && i % 5 === 0) await new Promise(r => setTimeout(r, 500));
        profiles.push(fetchProfile(ticker));
    }
    const profileResults = await Promise.allSettled(profiles);

    // Aggregate sector and country values weighted by current GBP value
    const sectorMap = {};
    const regionMap = {};

    data.forEach((row, i) => {
        const ticker           = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const liveData         = livePriceMap[ticker];
        const shares           = cleanNum(getCol(row, ['Shares']));
        const activePriceLocal = liveData ? liveData.price : cleanNum(getCol(row, ['Current Price']));
        const activeRate       = liveData ? liveData.rate : 1.0;
        const curValueGBP      = shares * activePriceLocal * activeRate;

        const profile = profileResults[i].status === 'fulfilled' ? profileResults[i].value : {};

        const sector      = profile?.finnhubIndustry || 'Other';
        const countryCode = profile?.country || '';
        const country     = COUNTRY_NAMES[countryCode] || (countryCode || 'Other');

        sectorMap[sector]  = (sectorMap[sector]  || 0) + curValueGBP;
        regionMap[country] = (regionMap[country] || 0) + curValueGBP;
    });

    // Sort by value descending
    const sortedSectors  = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]);
    const sortedRegions  = Object.entries(regionMap).sort((a, b) => b[1] - a[1]);

    const chartDefaults = {
        type: 'doughnut',
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#a1a1aa',
                        font: { family: 'Plus Jakarta Sans', size: 11 },
                        padding: 16,
                        usePointStyle: true,
                        pointStyleWidth: 8,
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct   = ((ctx.parsed / total) * 100).toFixed(1);
                            return `  ${ctx.label}: ${formatGBP(ctx.parsed)} (${pct}%)`;
                        },
                    },
                },
            },
        },
    };

    // Sector chart
    new Chart(document.getElementById('sector-chart'), {
        ...chartDefaults,
        data: {
            labels:   sortedSectors.map(([k]) => k),
            datasets: [{
                data:            sortedSectors.map(([, v]) => v),
                backgroundColor: CHART_COLOURS.slice(0, sortedSectors.length),
                borderColor:     '#0B0E11',
                borderWidth:     3,
                hoverOffset:     6,
            }],
        },
    });

    // Region chart
    new Chart(document.getElementById('region-chart'), {
        ...chartDefaults,
        data: {
            labels:   sortedRegions.map(([k]) => k),
            datasets: [{
                data:            sortedRegions.map(([, v]) => v),
                backgroundColor: CHART_COLOURS.slice(0, sortedRegions.length),
                borderColor:     '#0B0E11',
                borderWidth:     3,
                hoverOffset:     6,
            }],
        },
    });

    // Reveal charts, hide spinner
    loading.classList.add('hidden');
    content.classList.remove('hidden');
}


// =============================================================================
// INIT — run view setup as soon as the script loads
// =============================================================================
initView();

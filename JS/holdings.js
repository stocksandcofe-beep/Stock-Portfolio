// =============================================================================
// CONSTANTS & STATE
// =============================================================================
// PERF_CSV removed — totalValLatest computed from live prices directly,
// eliminating the heaviest network request from the load chain.
const HOLD_CSV      = `https://cdn.jsdelivr.net/gh/stocksandcohe-beep/Stock-Portfolio@main/Files/holdings.csv?t=${Date.now()}`;
const LIVE_CSV      = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQVR2VvNcIVmx4XkQT4A92MLsfxxdO_J8HTzif8khgRy023wnHTeIVY7DrgXuJvG6_5bnXZSyUcOhTy/pub?gid=0&single=true&output=csv';
const LOGO_BASE_URL = 'https://cdn.jsdelivr.net/gh/stocksandcohe-beep/Stock-Portfolio@main/Images/';
const FINNHUB_KEY   = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g';

let currentHoldingsData = [];
let livePriceMap        = {};
let totalValLatest      = 0;
let sortKey             = '';
let sortDir             = 1;

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


// =============================================================================
// DATA LOADING — 3 parallel requests
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

async function loadAll() {
    const [liveRows, holdRows, fxData] = await Promise.all([
        parseCsv(LIVE_CSV, { header: false }),
        parseCsv(HOLD_CSV, { header: true }),
        fetch('https://api.frankfurter.app/latest?from=GBP&to=USD,EUR')
            .then(r => r.json())
            .catch(() => ({})),
    ]);

    // FX rates — Frankfurter returns rates FROM GBP so invert them
    const fxRates = { USD: 1.0, EUR: 1.0, GBP: 1.0 };
    if (fxData?.rates) {
        fxRates.USD = fxData.rates.USD ? 1 / fxData.rates.USD : 1.0;
        fxRates.EUR = fxData.rates.EUR ? 1 / fxData.rates.EUR : 1.0;
    }

    // Build live price map
    liveRows.forEach(row => {
        const ticker       = row[0]?.toUpperCase().trim();
        const currencyCode = row[3]?.toUpperCase().trim() || 'USD';
        if (!ticker) return;
        livePriceMap[ticker] = {
            price:        cleanNum(row[1]),
            rate:         fxRates[currencyCode] ?? 1.0,
            currencyCode: currencyCode,
        };
    });

    // Filter valid holdings rows
    currentHoldingsData = holdRows.filter(
        r => getCol(r, ['Ticker']) && cleanNum(getCol(r, ['Shares'])) > 0
    );

    if (!currentHoldingsData.length) {
        showTableError('No holdings data found. Check that the CSV is up to date and has a Ticker and Shares column.');
        return;
    }

    // Compute portfolio total from live prices — replaces old PERF_CSV fetch
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
    const btn = document.getElementById('refresh-btn');
    if (btn) {
        btn.disabled = true;
        const icon = btn.querySelector('svg');
        if (icon) icon.style.animation = 'spin 0.8s linear infinite';
    }
    livePriceMap = {};
    loadAll();
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
        } else if (key === 'Current Value' || key === 'Allocation') {
            valA = liveGBP(a);
            valB = liveGBP(b);
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
            <td class="p-4 text-center text-emerald-400">${liveData ? sym + activePriceLocal.toFixed(2) : '--'}</td>
            <td class="p-4 text-center text-white">${formatGBP(curValueGBP)}</td>
            <td class="p-4 text-center ${profitClass}">${profitSign}${formatGBP(Math.abs(profitGBP), 0)}</td>
            <td class="p-4 text-center ${returnClass}">${returnSign}${Math.abs(percReturn).toFixed(2)}%</td>
            <td class="p-4 text-center text-zinc-300">${weight.toFixed(1)}%</td>
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

    const totalTr = document.createElement('tr');
    totalTr.className = 'border-t-2 border-zinc-700 bg-zinc-900/60 text-sm font-bold';
    totalTr.innerHTML = `
        <td class="p-4 text-left text-zinc-300 uppercase text-xs tracking-wider">Total Portfolio</td>
        <td class="p-4 text-center text-zinc-300">${totalShares.toLocaleString()}</td>
        <td class="p-4" colspan="2"></td>
        <td class="p-4 text-center text-white">${formatGBP(totalValue)}</td>
        <td class="p-4 text-center ${totalProfitClass}">${totalProfitSign}${formatGBP(totalProfit, 0)}</td>
        <td class="p-4 text-center ${totalReturnClass}">${totalReturnSign}${totalReturn.toFixed(2)}%</td>
        <td class="p-4 text-center text-zinc-400">100%</td>
    `;
    tbody.appendChild(fragment);
    tbody.appendChild(totalTr);
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
    const loading = document.getElementById('charts-loading');
    const content = document.getElementById('charts-content');

    const profiles = [];
    for (let i = 0; i < data.length; i++) {
        const ticker = getCol(data[i], ['Ticker'])?.toUpperCase().trim();
        if (i > 0 && i % 5 === 0) await new Promise(r => setTimeout(r, 500));
        profiles.push(fetchProfile(ticker));
    }
    const profileResults = await Promise.allSettled(profiles);

    const sectorMap = {};
    const regionMap = {};

    data.forEach((row, i) => {
        const ticker      = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const ld          = livePriceMap[ticker];
        const shares      = cleanNum(getCol(row, ['Shares']));
        const curValueGBP = ld ? shares * ld.price * ld.rate : 0;
        const profile     = profileResults[i].status === 'fulfilled' ? profileResults[i].value : {};
        const sector      = profile?.finnhubIndustry || 'Other';
        const countryCode = profile?.country || '';
        const country     = COUNTRY_NAMES[countryCode] || (countryCode || 'Other');
        sectorMap[sector]  = (sectorMap[sector]  || 0) + curValueGBP;
        regionMap[country] = (regionMap[country] || 0) + curValueGBP;
    });

    const sortedSectors = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]);
    const sortedRegions = Object.entries(regionMap).sort((a, b) => b[1] - a[1]);

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
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct   = ((ctx.parsed / total) * 100).toFixed(1);
                            return `  ${ctx.label}: ${formatGBP(ctx.parsed)} (${pct}%)`;
                        },
                    },
                },
            },
        },
    };

    new Chart(document.getElementById('sector-chart'), {
        ...chartDefaults,
        data: {
            labels:   sortedSectors.map(([k]) => k),
            datasets: [{ data: sortedSectors.map(([, v]) => v), backgroundColor: CHART_COLOURS.slice(0, sortedSectors.length), borderColor: '#0B0E11', borderWidth: 3, hoverOffset: 6 }],
        },
    });

    new Chart(document.getElementById('region-chart'), {
        ...chartDefaults,
        data: {
            labels:   sortedRegions.map(([k]) => k),
            datasets: [{ data: sortedRegions.map(([, v]) => v), backgroundColor: CHART_COLOURS.slice(0, sortedRegions.length), borderColor: '#0B0E11', borderWidth: 3, hoverOffset: 6 }],
        },
    });

    loading.classList.add('hidden');
    content.style.display = 'grid';
}


// =============================================================================
// INIT
// =============================================================================
initView();

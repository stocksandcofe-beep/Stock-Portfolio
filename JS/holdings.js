// =============================================================================
// CONSTANTS & STATE
// =============================================================================
const HOLD_CSV      = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Files/holdings.csv';
const WKL_CSV       = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQVR2VvNcIVmx4XkQT4A92MLsfxxdO_J8HTzif8khgRy023wnHTeIVY7DrgXuJvG6_5bnXZSyUcOhTy/pub?gid=0&single=true&output=csv';
const LOGO_BASE_URL = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Images/';
const FINNHUB_KEY   = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g';

const SHEETS_TICKERS = new Set(['WKL']);

let currentHoldingsData = [];
let livePriceMap        = {};
let totalValLatest      = 0;
let sortKey             = '';
let sortDir             = 1;
let lastRefreshedAt     = null;


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
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-rose-400 text-sm">${msg}</td></tr>`;
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
        const batch = tickers.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(t => fetchFinnhubQuote(t)));
        results.push(...batchResults);
        if (i + batchSize < tickers.length) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    return results;
}

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

    currentHoldingsData = holdRows.filter(
        r => getCol(r, ['Ticker']) && cleanNum(getCol(r, ['Shares'])) > 0
    );

    if (!currentHoldingsData.length) {
        showTableError('No holdings data found. Check that the CSV is up to date and has a Ticker and Shares column.');
        return;
    }

    const allTickers     = currentHoldingsData.map(r => getCol(r, ['Ticker'])?.toUpperCase().trim());
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

    totalValLatest = currentHoldingsData.reduce((sum, row) => {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const ld     = livePriceMap[ticker];
        const shares = cleanNum(getCol(row, ['Shares']));
        return sum + (ld ? shares * ld.price * ld.rate : 0);
    }, 0);

    displayHoldings(currentHoldingsData);
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

    let totalValue = 0, totalCost = 0, totalProfit = 0;
    data.forEach(row => {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const ld     = livePriceMap[ticker];
        const shares = cleanNum(getCol(row, ['Shares']));
        const val    = ld ? shares * ld.price * ld.rate : 0;
        const cost   = cleanNum(getCol(row, ['Total Purchase Cost']));
        totalValue  += val;
        totalCost   += cost;
        totalProfit += val - cost;
    });

    const totalReturn = totalCost !== 0 ? ((totalValue / totalCost) - 1) * 100 : 0;

    tbody.appendChild(fragment);

    const sumValue  = document.getElementById('sum-value');
    const sumCost   = document.getElementById('sum-cost');
    const sumPl     = document.getElementById('sum-pl');
    const sumReturn = document.getElementById('sum-return');
    if (sumValue)  sumValue.textContent  = formatGBP(totalValue);
    if (sumCost)   sumCost.textContent   = formatGBP(totalCost, 0);
    if (sumPl) {
        sumPl.textContent = (totalProfit >= 0 ? '+' : '') + formatGBP(totalProfit, 0);
        sumPl.className   = `text-base font-bold ${totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }
    if (sumReturn) {
        sumReturn.textContent = (totalReturn >= 0 ? '+' : '') + totalReturn.toFixed(2) + '%';
        sumReturn.className   = `text-base font-bold ${totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    stopRefreshSpin();
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

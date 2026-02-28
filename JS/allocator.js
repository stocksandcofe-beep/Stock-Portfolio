// =============================================================================
// CONSTANTS & STATE
// =============================================================================
const FINNHUB_KEY = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g';
const searchInput = document.getElementById('asset-search');
const resultsDiv  = document.getElementById('search-results');

let allocatorSocket      = null;
let lastAllocPrice       = 0;
let searchTimeout        = null;
let calcDebounceTimer    = null; // debounce for investment input
let currentLocalCurrency = 'USD';


// =============================================================================
// FX RATES — Frankfurter API, cached per portfolio currency
// =============================================================================
const fxCache = {};

async function getFxRates(portfolioCurrency) {
    if (fxCache[portfolioCurrency]) return fxCache[portfolioCurrency];

    try {
        const res   = await fetch(`https://api.frankfurter.app/latest?from=${portfolioCurrency}`);
        const data  = await res.json();
        const rates = { ...data.rates, [portfolioCurrency]: 1.0 };
        fxCache[portfolioCurrency] = rates;
        return rates;
    } catch (e) {
        console.warn('FX fetch failed:', e);
        return { [portfolioCurrency]: 1.0 };
    }
}


// =============================================================================
// CURRENCY FORMATTERS
// =============================================================================
function formatLocalCurrency(value, currencyCode) {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency', currency: currencyCode,
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(value);
}

function formatPrice(value) {
    return formatLocalCurrency(value, currentLocalCurrency);
}


// =============================================================================
// 1. SEARCH
// =============================================================================
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim().toUpperCase();
    if (query.length < 2) { resultsDiv.classList.add('hidden'); return; }
    searchTimeout = setTimeout(() => fetchResults(query), 300);
});

async function fetchResults(query) {
    try {
        const response = await fetch(`https://finnhub.io/api/v1/search?q=${query}&token=${FINNHUB_KEY}`);
        const data = await response.json();
        if (data.result) displaySearchResults(data.result.slice(0, 6));
    } catch (e) {
        console.error('Search error:', e);
    }
}

function displaySearchResults(assets) {
    resultsDiv.innerHTML = '';
    resultsDiv.classList.remove('hidden');
    assets.forEach(asset => {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-4 hover:bg-emerald-500/10 cursor-pointer border-b border-zinc-800/50 last:border-0 transition-colors group';
        item.innerHTML = `
            <div class="flex flex-col">
                <span class="text-white font-bold group-hover:text-emerald-400">${asset.symbol}</span>
                <span class="text-zinc-500 text-xs truncate max-w-[200px]">${asset.description}</span>
            </div>
            <span class="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-1 rounded uppercase font-mono">${asset.type || 'Stock'}</span>
        `;
        item.onclick = () => selectAsset(asset.symbol, asset.description);
        resultsDiv.appendChild(item);
    });
}


// =============================================================================
// 2. ASSET SELECTION
// =============================================================================
async function selectAsset(ticker, name) {
    resultsDiv.classList.add('hidden');
    searchInput.value = '';

    document.getElementById('selected-ticker').textContent = ticker;
    document.getElementById('selected-name').textContent   = name;
    document.getElementById('asset-label').textContent     = `${name} (${ticker})`;

    window.priceMultiplier = ticker.endsWith('.L') ? 0.01 : 1.0;

    const safeFetch = async (fn, label) => {
        try { await fn(ticker); }
        catch (e) { console.warn(`${label} failed:`, e); }
    };

    // All five fetches fire simultaneously — financials also runs Finnhub+Yahoo in parallel internally
    await Promise.all([
        safeFetch(fetchQuotes,     'Quotes'),
        safeFetch(fetchFinancials, 'Financials'),
        safeFetch(fetchProfile,    'Profile'),
        safeFetch(fetchNews,       'News'),
        safeFetch(initWebSocket,   'WebSocket'),
    ]);
}


// =============================================================================
// 3. QUOTES
// =============================================================================
async function fetchQuotes(symbol) {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d   = await res.json();
    const m   = window.priceMultiplier || 1.0;

    if (symbol.endsWith('.L'))                                                           currentLocalCurrency = 'GBP';
    else if (symbol.endsWith('.PA') || symbol.endsWith('.AS') || symbol.endsWith('.DE')) currentLocalCurrency = 'EUR';
    else                                                                                 currentLocalCurrency = 'USD';

    document.getElementById('metric-price').textContent = formatPrice(d.c * m);

    const prevCloseEl = document.getElementById('metric-pc');
    if (prevCloseEl) prevCloseEl.textContent = formatPrice(d.pc * m);

    const hloEl = document.getElementById('metric-hlo');
    if (hloEl) hloEl.textContent = `${formatPrice(d.h * m)} / ${formatPrice(d.l * m)} / ${formatPrice(d.o * m)}`;

    document.getElementById('metric-change').innerHTML = `
        <span class="${d.d >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            ${d.d >= 0 ? '+' : ''}${(d.d * m).toFixed(2)} (${d.dp.toFixed(2)}%)
        </span>`;

    lastAllocPrice = d.c * m;

    // Store volume for use in fetchFinancials
    window.lastQuoteVolume = d.v ?? null;
}


// =============================================================================
// 4. FINANCIALS
// FIX: Finnhub and Yahoo now fire in parallel via Promise.allSettled.
// Previously they were sequential — Yahoo only started after Finnhub finished,
// doubling the wait time on every asset selection.
// =============================================================================
async function fetchFinancials(symbol) {
    const formatValue    = (val) => val != null ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'N/A';
    const formatBillions = (val) => val != null ? (val / 1000).toFixed(2) + 'B' : 'N/A';

    // Both requests fire at the same time
    const [finnhubResult, yahooResult] = await Promise.allSettled([
        fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_KEY}`).then(r => r.json()),
        fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,defaultKeyStatistics,financialData,price`).then(r => r.json()),
    ]);

    const m  = finnhubResult.status === 'fulfilled' ? (finnhubResult.value?.metric || null) : null;
    let   yf = null;

    // Yahoo as fallback for fields Finnhub may miss
    if (yahooResult.status === 'fulfilled') {
        try {
            const result = yahooResult.value?.quoteSummary?.result?.[0] || {};
            const sd = result?.summaryDetail        || {};
            const ks = result?.defaultKeyStatistics || {};
            yf = {
                divYield: sd?.dividendYield?.raw || sd?.trailingAnnualDividendYield?.raw || null,
                pe:       sd?.trailingPE?.raw    || ks?.forwardPE?.raw                  || null,
                peg:      ks?.pegRatio?.raw      || null,
                beta:     sd?.beta?.raw          || null,
                mcap:     sd?.marketCap?.raw     || null,
                high52:   sd?.fiftyTwoWeekHigh?.raw || null,
                low52:    sd?.fiftyTwoWeekLow?.raw  || null,
            };
        } catch (e) {
            console.warn('Yahoo parse failed:', e);
        }
    }

    // Finnhub primary, Yahoo fills nulls
    const mcap     = m?.marketCapitalization ?? (yf?.mcap ? yf.mcap / 1_000_000 : null);
    const divYield = m?.dividendYieldIndicatedAnnual || m?.dividendYield || m?.dividendYieldNormalizedAnnual || yf?.divYield || null;
    const pe       = m?.peBasicExclExtraTTM ?? yf?.pe   ?? null;
    const peg      = m?.pegRatio            ?? yf?.peg  ?? null;
    const beta     = m?.beta                ?? yf?.beta ?? null;
    const high52   = m?.['52WeekHigh']      ?? yf?.high52 ?? null;
    const low52    = m?.['52WeekLow']       ?? yf?.low52  ?? null;
    const volume   = window.lastQuoteVolume ?? null;

    document.getElementById('metric-mcap').textContent = formatBillions(mcap);
    document.getElementById('metric-div').textContent  = divYield != null ? `${(divYield * 100 > 1 ? divYield : divYield * 100).toFixed(2)}%` : 'N/A';
    document.getElementById('metric-pe').textContent   = formatValue(pe);
    document.getElementById('metric-peg').textContent  = formatValue(peg);
    document.getElementById('metric-52w').textContent  = (high52 && low52) ? `${formatLocalCurrency(high52, currentLocalCurrency)} / ${formatLocalCurrency(low52, currentLocalCurrency)}` : 'N/A';
    document.getElementById('metric-beta').textContent = formatValue(beta);
    document.getElementById('metric-volume').textContent = volume != null ? volume.toLocaleString() : 'N/A';
}


// =============================================================================
// 5. WEBSOCKET — live price stream
// =============================================================================
function initWebSocket(symbol) {
    if (allocatorSocket) allocatorSocket.close();
    allocatorSocket = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
    allocatorSocket.onopen = () => {
        allocatorSocket.send(JSON.stringify({ type: 'subscribe', symbol }));
    };
    allocatorSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'trade') updatePriceUI(data.data[0].p);
    };
}

function updatePriceUI(price) {
    const m = window.priceMultiplier || 1.0;
    lastAllocPrice = price * m;
    const priceEl = document.getElementById('live-price');
    if (priceEl) priceEl.textContent = formatPrice(lastAllocPrice);
}


// =============================================================================
// 6. NEWS
// =============================================================================
async function fetchNews(symbol) {
    const today = new Date().toISOString().split('T')[0];
    const res   = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${today}&to=${today}&token=${FINNHUB_KEY}`);
    const news  = await res.json();

    const container = document.getElementById('news-container');
    container.innerHTML = news.length
        ? ''
        : '<p class="text-zinc-600 italic text-xs">No recent news found.</p>';

    news.slice(0, 5).forEach(item => {
        const article = document.createElement('div');
        article.className = 'border-b border-zinc-800/50 pb-3 last:border-0';
        article.innerHTML = `
            <a href="${item.url}" target="_blank" class="hover:text-emerald-400 transition-colors">
                <p class="text-xs font-bold leading-tight mb-1">${item.headline}</p>
            </a>
            <p class="text-[10px] text-zinc-500 uppercase">${item.source} • ${new Date(item.datetime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        `;
        container.appendChild(article);
    });
}


// =============================================================================
// 7. COMPANY PROFILE
// =============================================================================
async function fetchProfile(symbol) {
    const res  = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const data = await res.json();

    if (!data.name) return;

    if (data.currency) currentLocalCurrency = data.currency.toUpperCase();

    document.getElementById('profile-industry').textContent = data.finnhubIndustry || '-';
    document.getElementById('profile-country').textContent  = data.country  || '-';
    document.getElementById('profile-exchange').textContent = data.exchange || '-';
    document.getElementById('profile-website').innerHTML    = `<a href="${data.weburl}" target="_blank" class="text-emerald-400 hover:underline">Visit Site</a>`;
}


// =============================================================================
// 8. CALCULATOR — FX-aware portfolio allocation table
// =============================================================================
let portfolioItems = [];

const calcTableBody   = document.getElementById('calc-table-body');
const calcEmptyRow    = document.getElementById('calc-empty-row');
const addBtn          = document.getElementById('add-to-calc-btn');
const investmentInput = document.getElementById('calc-investment');
const currencySelect  = document.getElementById('calc-currency');
const manualForm      = document.getElementById('manual-form');
const toggleBtn       = document.getElementById('toggle-manual-form');
const submitManualBtn = document.getElementById('submit-manual');

// Show "Add to Calculator" button only when an asset is selected
const tickerObserver = new MutationObserver(() => {
    const ticker = document.getElementById('selected-ticker').innerText;
    if (ticker && ticker !== '---') {
        addBtn.classList.remove('opacity-0', 'pointer-events-none');
    } else {
        addBtn.classList.add('opacity-0', 'pointer-events-none');
    }
});
tickerObserver.observe(document.getElementById('selected-ticker'), { childList: true });

// Toggle manual ETF form
toggleBtn.addEventListener('click', () => {
    const isHidden = manualForm.classList.contains('hidden');
    if (isHidden) {
        manualForm.classList.remove('hidden');
        manualForm.classList.add('grid', 'grid-cols-1', 'md:grid-cols-4', 'gap-4');
    } else {
        manualForm.classList.add('hidden');
        manualForm.classList.remove('grid', 'grid-cols-1', 'md:grid-cols-4', 'gap-4');
    }
});

// Add asset from search
addBtn.addEventListener('click', () => {
    const ticker   = document.getElementById('selected-ticker').innerText.trim();
    const name     = document.getElementById('selected-name').innerText.trim();
    const priceStr = document.getElementById('metric-price').innerText.trim();
    const mcapStr  = document.getElementById('metric-mcap').innerText.trim();

    const price = parseFloat(priceStr.replace(/[^0-9.-]+/g, '')) || 0;
    const mcap  = parseMcapValue(mcapStr);

    if (!ticker || ticker === '---') return;
    if (price === 0) { alert('Price data has not loaded yet. Please wait a moment and try again.'); return; }
    if (mcap  === 0) { alert('Market cap data has not loaded yet. Please wait a moment and try again.'); return; }
    if (portfolioItems.find(item => item.ticker === ticker)) return;

    portfolioItems.push({ ticker, name, price, mcap, localCurrency: currentLocalCurrency });
    updateCalculatorUI();
});

// Add asset manually
submitManualBtn.addEventListener('click', () => {
    const name      = document.getElementById('man-name').value.trim();
    const ticker    = document.getElementById('man-ticker').value.trim();
    const price     = parseFloat(document.getElementById('man-price').value);
    const mcapRaw   = document.getElementById('man-mcap').value.trim();
    const localCurr = document.getElementById('man-currency').value;

    if (!name || !ticker || isNaN(price) || !mcapRaw) {
        alert('Please fill in all fields correctly.');
        return;
    }

    portfolioItems.push({
        ticker: ticker.toUpperCase(),
        name, price,
        mcap:          parseMcapValue(mcapRaw.toUpperCase()),
        localCurrency: localCurr,
    });

    document.getElementById('man-name').value   = '';
    document.getElementById('man-ticker').value = '';
    document.getElementById('man-price').value  = '';
    document.getElementById('man-mcap').value   = '';
    manualForm.classList.add('hidden');
    manualForm.classList.remove('grid', 'grid-cols-1', 'md:grid-cols-4', 'gap-4');

    updateCalculatorUI();
});

// Parse shorthand strings like "3.2T" or "500B" into raw numbers
function parseMcapValue(str) {
    if (!str) return 0;
    const num = parseFloat(str.replace(/[^0-9.-]+/g, '')) || 0;
    if (str.includes('T')) return num * 1_000_000_000_000;
    if (str.includes('B')) return num * 1_000_000_000;
    if (str.includes('M')) return num * 1_000_000;
    return num;
}

// Rebuild the allocation table with FX-aware share calculations
// FIX: rows are now built into a DocumentFragment and appended once (no repeated reflows)
// FIX: lucide.createIcons() is called once after all rows are in the DOM
// FIX: FX rates fetched BEFORE clearing rows to avoid blank-table flicker during async wait
async function updateCalculatorUI() {
    if (portfolioItems.length === 0) {
        calcTableBody.querySelectorAll('.asset-row').forEach(row => row.remove());
        calcEmptyRow.style.display = 'table-row';
        return;
    }

    const portfolioCurrency = currencySelect.value;
    const totalMcap         = portfolioItems.reduce((acc, item) => acc + item.mcap, 0);
    const totalInvestment   = parseFloat(investmentInput.value) || 0;

    // Fetch FX rates FIRST — before touching the DOM — so the table is never
    // visibly empty while waiting for the async response
    const fxRates = await getFxRates(portfolioCurrency);

    // Now safe to clear and rebuild
    calcTableBody.querySelectorAll('.asset-row').forEach(row => row.remove());
    calcEmptyRow.style.display = 'none';

    // Build all rows off-DOM then append once to avoid repeated reflows
    const fragment = document.createDocumentFragment();

    for (const [index, item] of portfolioItems.entries()) {
        const weight                    = item.mcap / totalMcap;
        const targetInPortfolioCurrency = totalInvestment * weight;
        const fxRate                    = item.localCurrency === portfolioCurrency
            ? 1.0
            : (fxRates[item.localCurrency] || 1.0);
        const targetInLocalCurrency     = targetInPortfolioCurrency * fxRate;
        const shares                    = item.price > 0 ? Math.floor(targetInLocalCurrency / item.price) : 0;

        const fxTooltip = item.localCurrency !== portfolioCurrency
            ? `<div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                   1 ${portfolioCurrency} = ${fxRate.toFixed(4)} ${item.localCurrency}
               </div>`
            : '';

        const row = document.createElement('tr');
        row.className = 'asset-row border-b border-zinc-800/30 hover:bg-zinc-900/40 transition-colors';
        row.innerHTML = `
            <td class="py-4 px-2 text-white font-medium">${item.name}</td>
            <td class="py-4 text-center font-mono text-zinc-400">${item.ticker}</td>
            <td class="py-4 text-center font-mono text-zinc-300 relative group">
                <span class="${item.localCurrency !== portfolioCurrency ? 'cursor-help' : ''}">${formatLocalCurrency(item.price, item.localCurrency)}</span>
                ${fxTooltip}
            </td>
            <td class="py-4 text-center">
                <span class="text-emerald-400 font-bold text-[10px] bg-emerald-500/10 px-2 py-1 rounded">
                    ${(weight * 100).toFixed(1)}%
                </span>
            </td>
            <td class="py-4 text-right font-bold text-white">${shares.toLocaleString()}</td>
            <td class="py-4 text-right">
                <button onclick="removeAsset(${index})" class="text-zinc-600 hover:text-rose-500 transition-colors" aria-label="Remove ${item.ticker}">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </td>
        `;
        fragment.appendChild(row);
    }

    // Single DOM write + single icon scan
    calcTableBody.appendChild(fragment);
    lucide.createIcons();
}

function removeAsset(index) {
    portfolioItems.splice(index, 1);
    updateCalculatorUI();
}

// FIX: Investment input is debounced — only recalculates 300ms after typing stops,
// not on every single keystroke
investmentInput.addEventListener('input', () => {
    clearTimeout(calcDebounceTimer);
    calcDebounceTimer = setTimeout(updateCalculatorUI, 300);
});

// FIX: Currency change now clears the ENTIRE cache so fresh rates are always
// fetched for the new currency. Previously it deleted the wrong (new) key.
currencySelect.addEventListener('change', () => {
    Object.keys(fxCache).forEach(k => delete fxCache[k]);
    updateCalculatorUI();
});

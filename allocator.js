// =============================================================================
// CONSTANTS & STATE
// =============================================================================
const FINNHUB_KEY = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g';
const searchInput = document.getElementById('asset-search');
const resultsDiv  = document.getElementById('search-results');

let allocatorSocket = null;
let lastAllocPrice  = 0;
let searchTimeout   = null;


// =============================================================================
// CURRENCY HELPER
// Reads the selected currency from the dropdown and formats any value with the
// correct symbol automatically — no more hardcoded £ signs.
// =============================================================================
function formatPrice(value) {
    const currency = document.getElementById('calc-currency').value;
    return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

// Re-render the live price whenever the user switches currency
document.getElementById('calc-currency').addEventListener('change', () => {
    if (lastAllocPrice) updatePriceUI(lastAllocPrice);
});


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
    // Hide results and clear input immediately
    resultsDiv.classList.add('hidden');
    searchInput.value = '';

    // Update header labels
    document.getElementById('selected-ticker').textContent = ticker;
    document.getElementById('selected-name').textContent = name;

    // London Stock Exchange prices are quoted in pence — divide by 100
    window.priceMultiplier = ticker.endsWith('.L') ? 0.01 : 1.0;

    // Run all fetches in parallel; a failure in one won't block the others
    const safeFetch = async (fn, label) => {
        try { await fn(ticker); }
        catch (e) { console.warn(`${label} failed:`, e); }
    };

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

    // Current price
    document.getElementById('metric-price').textContent = formatPrice(d.c * m);

    // Previous close
    const prevCloseEl = document.getElementById('metric-pc');
    if (prevCloseEl) prevCloseEl.textContent = formatPrice(d.pc * m);

    // High / Low / Open — these are relative values so we format without symbol
    const hloEl = document.getElementById('metric-hlo');
    if (hloEl) {
        hloEl.textContent = `${(d.h * m).toFixed(2)} / ${(d.l * m).toFixed(2)} / ${(d.o * m).toFixed(2)}`;
    }

    // Change & % change
    document.getElementById('metric-change').innerHTML = `
        <span class="${d.d >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            ${d.d >= 0 ? '+' : ''}${(d.d * m).toFixed(2)} (${d.dp.toFixed(2)}%)
        </span>`;

    // Store raw price so we can reformat if currency changes
    lastAllocPrice = d.c;
}


// =============================================================================
// 4. FINANCIALS
// =============================================================================
async function fetchFinancials(symbol) {
    const res  = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_KEY}`);
    const data = await res.json();
    const m    = data.metric;

    if (!m) return;

    const formatValue   = (val) => val != null ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'N/A';
    const formatBillions = (val) => val != null ? (val / 1000).toFixed(2) + 'B' : 'N/A';

    document.getElementById('metric-mcap').textContent  = formatBillions(m.marketCapitalization);
    document.getElementById('metric-div').textContent   = m.dividendYieldIndicatedAnnual
        ? `${m.dividendYieldIndicatedAnnual.toFixed(2)}%`
        : '0.00%';
    document.getElementById('metric-pe').textContent    = formatValue(m.peBasicExclExtraTTM);
    document.getElementById('metric-peg').textContent   = formatValue(m.pegRatio);
    document.getElementById('metric-eps').textContent   = formatValue(m.epsGrowthNext5Y) + '%';
    document.getElementById('metric-52w').textContent   = `${m['52WeekHigh']} / ${m['52WeekLow']}`;
    document.getElementById('metric-beta').textContent  = formatValue(m.beta);

    const terEl = document.getElementById('metric-ter');
    if (terEl) terEl.textContent = '-';
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
    lastAllocPrice = price;
    const priceEl = document.getElementById('live-price');
    if (priceEl) priceEl.textContent = formatPrice(price * m);
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

    document.getElementById('profile-industry').textContent = data.finnhubIndustry || '-';
    document.getElementById('profile-country').textContent  = data.country  || '-';
    document.getElementById('profile-exchange').textContent = data.exchange || '-';
    document.getElementById('profile-website').innerHTML    = `<a href="${data.weburl}" target="_blank" class="text-emerald-400 hover:underline">Visit Site</a>`;
}


// =============================================================================
// 8. MANUAL FORM TOGGLE
// Shows/hides the manual ETF entry form correctly by swapping display classes,
// fixing the hidden + grid conflict that was causing it to always be visible.
// =============================================================================
document.getElementById('toggle-manual-form').addEventListener('click', () => {
    const form     = document.getElementById('manual-form');
    const isHidden = form.classList.contains('hidden');

    if (isHidden) {
        form.classList.remove('hidden');
        form.classList.add('grid', 'grid-cols-1', 'md:grid-cols-4', 'gap-4');
    } else {
        form.classList.add('hidden');
        form.classList.remove('grid', 'grid-cols-1', 'md:grid-cols-4', 'gap-4');
    }
});

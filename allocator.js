const FINNHUB_KEY = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g';
const searchInput = document.getElementById('asset-search');
const resultsDiv = document.getElementById('search-results');
let allocatorSocket = null;
let lastAllocPrice = 0;

// 1. Search Logic
let searchTimeout = null;
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
    } catch (e) { console.error("Search Error:", e); }
}

function displaySearchResults(assets) {
    resultsDiv.innerHTML = '';
    resultsDiv.classList.remove('hidden');
    assets.forEach(asset => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-4 hover:bg-emerald-500/10 cursor-pointer border-b border-zinc-800/50 last:border-0 transition-colors group";
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

// 2. Asset Selection & Data Orchestration
async function selectAsset(ticker, name) {
    document.getElementById('selected-ticker').textContent = ticker;
    document.getElementById('selected-name').textContent = name;
    resultsDiv.classList.add('hidden');
    searchInput.value = "";

    // Global multiplier for LSE stocks (pence to pounds)
    window.priceMultiplier = ticker.endsWith('.L') ? 0.01 : 1.0;

    await Promise.all([
        fetchQuotes(ticker),
        fetchFinancials(ticker),
        fetchNews(ticker),
        initWebSocket(ticker)
    ]);
}

// 3. Fetching Functions
async function fetchQuotes(symbol) {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await res.json();
    const m = window.priceMultiplier || 1.0;
    
    document.getElementById('metric-price').textContent = `£${(d.c * m).toFixed(2)}`;
    document.getElementById('metric-pc').textContent = `£${(d.pc * m).toFixed(2)}`;
    document.getElementById('metric-hlo').textContent = `${(d.h * m).toFixed(2)} / ${(d.l * m).toFixed(2)} / ${(d.o * m).toFixed(2)}`;
    
    document.getElementById('metric-change').innerHTML = `
        <span class="${d.d >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            ${d.d >= 0 ? '+' : ''}${(d.d * m).toFixed(2)} (${d.dp.toFixed(2)}%)
        </span>`;
}

async function fetchFinancials(symbol) {
    const res = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_KEY}`);
    const data = await res.json();
    const m = data.metric;

    if (!m) return;

    const formatValue = (val) => val ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'N/A';
    const formatBillions = (val) => val ? (val / 1000).toFixed(2) + 'B' : 'N/A';

    // MCAP & 52W High/Low work for both
    document.getElementById('metric-mcap').textContent = formatBillions(m.marketCapitalization);
    document.getElementById('metric-52w').textContent = `${m['52WeekHigh']} / ${m['52WeekLow']}`;
    document.getElementById('metric-beta').textContent = formatValue(m.beta);

    // ETF Specific: Total Expense Ratio (TER)
    const ter = m.expenseRatio || m.itdExpenseRatio || null;
    document.getElementById('metric-ter').textContent = ter ? `${ter.toFixed(2)}%` : 'N/A';

    // Asset Category Fallback for Table Logic
    const assetType = m.assetClass || (m.peBasicExclExtraTTM ? 'Equity' : 'ETF/Commodity');
    
    // Update P/E and Div Yield (ETFs often have 0 P/E)
    document.getElementById('metric-pe').textContent = m.peBasicExclExtraTTM ? formatValue(m.peBasicExclExtraTTM) : 'N/A (ETF)';
    document.getElementById('metric-div').textContent = m.dividendYieldIndicatedAnnual ? `${m.dividendYieldIndicatedAnnual.toFixed(2)}%` : '0.00%';
    
    // Custom check for Silver/Gold ETFs
    if (symbol === 'SSLN.L') {
        document.getElementById('metric-pe').textContent = 'N/A (Physical)';
    }
}

async function fetchNews(symbol) {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${today}&to=${today}&token=${FINNHUB_KEY}`);
    const news = await res.json();
    
    const container = document.getElementById('news-container');
    container.innerHTML = news.length ? '' : '<p class="text-zinc-600 italic text-xs">No recent news found.</p>';
    
    news.slice(0, 5).forEach(item => {
        const article = document.createElement('div');
        article.className = "border-b border-zinc-800/50 pb-3 last:border-0";
        article.innerHTML = `
            <a href="${item.url}" target="_blank" class="hover:text-emerald-400 transition-colors">
                <p class="text-xs font-bold leading-tight mb-1">${item.headline}</p>
            </a>
            <p class="text-[10px] text-zinc-500 uppercase">${item.source} • ${new Date(item.datetime * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
        `;
        container.appendChild(article);
    });
}

// 4. WebSocket (Live Update)
function initWebSocket(symbol) {
    if (allocatorSocket) allocatorSocket.close();
    allocatorSocket = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
    allocatorSocket.onopen = () => allocatorSocket.send(JSON.stringify({'type':'subscribe', 'symbol': symbol}));
    allocatorSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'trade') updatePriceUI(data.data[0].p);
    };
}

function updatePriceUI(price) {
    const m = window.priceMultiplier || 1.0;
    const correctedPrice = price * m;
    const priceEl = document.getElementById('live-price');
    priceEl.textContent = `£${correctedPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    // ... existing indicator logic
}

// Init Lucide
lucide.createIcons();

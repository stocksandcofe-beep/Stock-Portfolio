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

// 2. Asset Selection
async function selectAsset(ticker, name) {
    // 1. Immediate UI Feedback: Hide results and clear input
    resultsDiv.classList.add('hidden');
    searchInput.value = "";
    
    // 2. Update Header Labels
    document.getElementById('selected-ticker').textContent = ticker;
    document.getElementById('selected-name').textContent = name;

    // 3. Set Currency Multiplier for London Stocks
    window.priceMultiplier = ticker.endsWith('.L') ? 0.01 : 1.0;

    // 4. Fetch Data with individual "Safety Wrappers"
    // This ensures that if fetchProfile fails, fetchQuotes still runs.
    const safeFetch = async (fn, label) => {
        try { await fn(ticker); } 
        catch (e) { console.warn(`${label} failed:`, e); }
    };

    await Promise.all([
        safeFetch(fetchQuotes, "Quotes"),
        safeFetch(fetchFinancials, "Financials"),
        safeFetch(fetchProfile, "Profile"),
        safeFetch(fetchNews, "News"),
        safeFetch(initWebSocket, "WebSocket")
    ]);
}

async function fetchQuotes(symbol) {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await res.json();
    const m = window.priceMultiplier || 1.0;
    
    // 1. Update Live Price
    document.getElementById('metric-price').textContent = `£${(d.c * m).toFixed(2)}`;
    
    // 2. Update Previous Close (Yesterday's Close)
    const prevCloseEl = document.getElementById('metric-pc');
    if (prevCloseEl) {
        prevCloseEl.textContent = `£${(d.pc * m).toFixed(2)}`;
    }

    // 3. Update High/Low/Open Table row
    const hloEl = document.getElementById('metric-hlo');
    if (hloEl) {
        hloEl.textContent = `${(d.h * m).toFixed(2)} / ${(d.l * m).toFixed(2)} / ${(d.o * m).toFixed(2)}`;
    }

    // 4. Update Change Indicator
    document.getElementById('metric-change').innerHTML = `
        <span class="${d.d >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            ${d.d >= 0 ? '+' : ''}${(d.d * m).toFixed(2)} (${d.dp.toFixed(2)}%)
        </span>`;
    
    lastAllocPrice = d.c;
}

async function fetchFinancials(symbol) {
    const res = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_KEY}`);
    const data = await res.json();
    const m = data.metric;

    if (!m) return;

    // Helper functions for consistent formatting
    const formatValue = (val) => val ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'N/A';
    const formatBillions = (val) => val ? (val / 1000).toFixed(2) + 'B' : 'N/A';

    // 1. Market Cap (Fund Size for ETFs)
    document.getElementById('metric-mcap').textContent = formatBillions(m.marketCapitalization);

    // 2. Dividend Yield
    document.getElementById('metric-div').textContent = m.dividendYieldIndicatedAnnual 
        ? `${m.dividendYieldIndicatedAnnual.toFixed(2)}%` 
        : '0.00%';

    // 3. Stock Fundamental Metrics
    document.getElementById('metric-pe').textContent = formatValue(m.peBasicExclExtraTTM);
    document.getElementById('metric-peg').textContent = formatValue(m.pegRatio);
    document.getElementById('metric-eps').textContent = formatValue(m.epsGrowthNext5Y) + '%';
    
    // 4. Price Action Metrics
    document.getElementById('metric-52w').textContent = `${m['52WeekHigh']} / ${m['52WeekLow']}`;
    document.getElementById('metric-beta').textContent = formatValue(m.beta);

    // Explicitly hide TER for common stocks
    const terEl = document.getElementById('metric-ter');
    if (terEl) terEl.textContent = '-';
}

// 3. WebSocket & News (Existing logic restored)
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
    const priceEl = document.getElementById('live-price');
    priceEl.textContent = `£${(price * m).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
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
function displayNews(news) {
    const container = document.getElementById('allocator-news');
    container.innerHTML = '';
    news.forEach(item => {
        const article = document.createElement('div');
        article.className = "p-4 bg-zinc-900/50 rounded-xl border border-zinc-800/50";
        article.innerHTML = `
            <a href="${item.url}" target="_blank" class="hover:text-emerald-400 transition-colors">
                <p class="text-xs font-bold leading-tight mb-1">${item.headline}</p>
            </a>
            <p class="text-[10px] text-zinc-500 uppercase">${item.source}</p>
        `;
        container.appendChild(article);
    });
}

async function fetchProfile(symbol) {
    try {
        const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_KEY}`);
        const data = await res.json();

        if (data.name) {
            // Populate your Company Profile table IDs
            document.getElementById('profile-industry').textContent = data.finnhubIndustry || '-';
            document.getElementById('profile-country').textContent = data.country || '-';
            document.getElementById('profile-exchange').textContent = data.exchange || '-';
            document.getElementById('profile-website').innerHTML = `<a href="${data.weburl}" target="_blank" class="text-emerald-400 hover:underline">Visit Site</a>`;
        }
    } catch (e) {
        console.error("Profile Fetch Error:", e);
    }
}

// Manual Form Toggle
document.getElementById('toggle-manual-form').addEventListener('click', () => {
    const form = document.getElementById('manual-form');
    const isHidden = form.classList.contains('hidden');

    if (isHidden) {
        form.classList.remove('hidden');
        form.classList.add('grid', 'grid-cols-1', 'md:grid-cols-4', 'gap-4');
    } else {
        form.classList.add('hidden');
        form.classList.remove('grid', 'grid-cols-1', 'md:grid-cols-4', 'gap-4');
    }
});

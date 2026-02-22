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
// 8. CALCULATOR — portfolio allocation table
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

// Add asset from search results
addBtn.addEventListener('click', () => {
    const ticker   = document.getElementById('selected-ticker').innerText;
    const name     = document.getElementById('selected-name').innerText;
    const priceStr = document.getElementById('metric-price').innerText;
    const mcapStr  = document.getElementById('metric-mcap').innerText;

    if (portfolioItems.find(item => item.ticker === ticker)) return;

    portfolioItems.push({
        ticker,
        name,
        price: parseFloat(priceStr.replace(/[^0-9.-]+/g, '')) || 0,
        mcap: parseMcapValue(mcapStr),
        currency: currencySelect.value,
    });

    updateCalculatorUI();
});

// Add asset manually (for ETFs)
submitManualBtn.addEventListener('click', () => {
    const name    = document.getElementById('man-name').value;
    const ticker  = document.getElementById('man-ticker').value;
    const price   = parseFloat(document.getElementById('man-price').value);
    const mcapRaw = document.getElementById('man-mcap').value;

    if (!name || !ticker || isNaN(price) || !mcapRaw) {
        alert('Please fill in all fields correctly.');
        return;
    }

    portfolioItems.push({
        ticker: ticker.toUpperCase(),
        name,
        price,
        mcap: parseMcapValue(mcapRaw.toUpperCase()),
        currency: currencySelect.value,
    });

    // Clear fields and hide form
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

// Rebuild the allocation table
function updateCalculatorUI() {
    calcTableBody.querySelectorAll('.asset-row').forEach(row => row.remove());

    if (portfolioItems.length === 0) {
        calcEmptyRow.style.display = 'table-row';
        return;
    }

    calcEmptyRow.style.display = 'none';

    const totalMcap       = portfolioItems.reduce((acc, item) => acc + item.mcap, 0);
    const totalInvestment = parseFloat(investmentInput.value) || 0;

    portfolioItems.forEach((item, index) => {
        const weight       = item.mcap / totalMcap;
        const targetAmount = totalInvestment * weight;
        const shares       = targetAmount / item.price;

        const row = document.createElement('tr');
        row.className = 'asset-row border-b border-zinc-800/30 hover:bg-zinc-900/40 transition-colors';
        row.innerHTML = `
            <td class="py-4 px-2 text-white font-medium">${item.name}</td>
            <td class="py-4 text-center font-mono text-zinc-400">${item.ticker}</td>
            <td class="py-4 text-center font-mono text-zinc-300">${formatCurrency(item.price, item.currency)}</td>
            <td class="py-4 text-center">
                <span class="text-emerald-400 font-bold text-[10px] bg-emerald-500/10 px-2 py-1 rounded">
                    ${(weight * 100).toFixed(1)}%
                </span>
            </td>
            <td class="py-4 text-right font-bold text-white">${Math.floor(shares).toLocaleString()}</td>
            <td class="py-4 text-right">
                <button onclick="removeAsset(${index})" class="text-zinc-600 hover:text-rose-500 transition-colors">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </td>
        `;
        calcTableBody.appendChild(row);
    });

    lucide.createIcons();
}

function removeAsset(index) {
    portfolioItems.splice(index, 1);
    updateCalculatorUI();
}

function formatCurrency(val, curr) {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: curr || currencySelect.value,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(val);
}

// Recalculate when investment amount or currency changes
investmentInput.addEventListener('input', updateCalculatorUI);
currencySelect.addEventListener('change', () => {
    if (lastAllocPrice) updatePriceUI(lastAllocPrice);
    updateCalculatorUI();
});


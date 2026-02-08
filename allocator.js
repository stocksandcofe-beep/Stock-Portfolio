// Configuration
const FINNHUB_KEY = 'd5ikb29r01qrgjmcpo80d5ikb29r01qrgjmcpo8g'; // Replace with your actual key
const searchInput = document.getElementById('asset-search');
const resultsDiv = document.getElementById('search-results');
const selectionContainer = document.getElementById('selection-container');

let allocatorSocket = null;
let lastAllocPrice = 0;

console.log("Allocator.js loaded successfully");

// 1. Search Logic
let searchTimeout = null;
if (searchInput) {
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = searchInput.value.trim().toUpperCase();
        
        if (query.length < 2) {
            resultsDiv.classList.add('hidden');
            return;
        }

        searchTimeout = setTimeout(() => {
            console.log("Searching for:", query);
            fetchResults(query);
        }, 300);
    });
}

async function fetchResults(query) {
    try {
        const response = await fetch(`https://finnhub.io/api/v1/search?q=${query}&token=${FINNHUB_KEY}`);
        const data = await response.json();
        
        if (data.result && data.result.length > 0) {
            displayResults(data.result.slice(0, 6));
        } else {
            resultsDiv.innerHTML = '<div class="p-4 text-zinc-500 text-sm">No results found</div>';
            resultsDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error("Finnhub Search Error:", error);
    }
}

function displayResults(assets) {
    resultsDiv.innerHTML = '';
    resultsDiv.classList.remove('hidden');

    assets.forEach(asset => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-4 hover:bg-emerald-500/10 cursor-pointer border-b border-zinc-800/50 last:border-0 transition-colors group";
        
        item.innerHTML = `
            <div class="flex flex-col">
                <span class="text-white font-bold group-hover:text-emerald-400">${asset.symbol}</span>
                <span class="text-zinc-500 text-xs truncate max-w-[250px]">${asset.description}</span>
            </div>
            <span class="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-1 rounded uppercase font-mono">${asset.type || 'Stock'}</span>
        `;

        item.onclick = () => {
            console.log("Selected:", asset.symbol);
            selectAsset(asset.symbol, asset.description, asset.type);
        };
        resultsDiv.appendChild(item);
    });
}

// 2. Selection & WebSocket Logic
function selectAsset(ticker, name, type) {
    document.getElementById('selected-ticker').textContent = ticker;
    document.getElementById('selected-name').textContent = name;
    document.getElementById('selected-type').textContent = type || 'Asset';
    
    selectionContainer.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    searchInput.value = ""; 

    initWebSocket(ticker);
}

function initWebSocket(symbol) {
    if (allocatorSocket) {
        console.log("Closing previous socket");
        allocatorSocket.close();
    }
    
    allocatorSocket = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);

    allocatorSocket.onopen = () => {
        console.log("WebSocket Connected for:", symbol);
        allocatorSocket.send(JSON.stringify({'type':'subscribe', 'symbol': symbol}));
    };

    allocatorSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'trade') {
            updatePriceUI(data.data[0].p);
        }
    };

    allocatorSocket.onerror = (err) => console.error("WebSocket Error:", err);
}

function updatePriceUI(price) {
    const priceEl = document.getElementById('live-price');
    const indicator = document.getElementById('price-indicator');
    
    priceEl.textContent = `£${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    if (price > lastAllocPrice) {
        indicator.className = "w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]";
    } else if (price < lastAllocPrice) {
        indicator.className = "w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]";
    }
    
    lastAllocPrice = price;
    setTimeout(() => { 
        if(indicator) indicator.className = "w-2 h-2 rounded-full bg-zinc-700"; 
    }, 500);
}

// Initialize Lucide Icons
lucide.createIcons();

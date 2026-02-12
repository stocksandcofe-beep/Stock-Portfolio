// calculator.js - Logic for the Market Cap Rebalancing Table with Manual Entry
let portfolioItems = [];

const calcTableBody = document.getElementById('calc-table-body');
const calcEmptyRow = document.getElementById('calc-empty-row');
const addBtn = document.getElementById('add-to-calc-btn');
const investmentInput = document.getElementById('calc-investment');
const currencySelect = document.getElementById('calc-currency');

// Manual Form Elements
const manualForm = document.getElementById('manual-form');
const toggleBtn = document.getElementById('toggle-manual-form');
const submitManualBtn = document.getElementById('submit-manual');

// 1. OBSERVER: Show "Add" button only when a search result is selected
const tickerObserver = new MutationObserver(() => {
    const ticker = document.getElementById('selected-ticker').innerText;
    if (ticker && ticker !== '---') {
        addBtn.classList.remove('opacity-0', 'pointer-events-none');
    } else {
        addBtn.classList.add('opacity-0', 'pointer-events-none');
    }
});
tickerObserver.observe(document.getElementById('selected-ticker'), { childList: true });

// 2. TOGGLE: Show/Hide Manual Form
toggleBtn.addEventListener('click', () => {
    manualForm.classList.toggle('hidden');
});

// 3. ACTION: Add from Search Results
addBtn.addEventListener('click', () => {
    const ticker = document.getElementById('selected-ticker').innerText;
    const name = document.getElementById('selected-name').innerText;
    const priceStr = document.getElementById('metric-price').innerText;
    const mcapStr = document.getElementById('metric-mcap').innerText;

    if (portfolioItems.find(item => item.ticker === ticker)) return;

    portfolioItems.push({
        ticker,
        name,
        price: parseFloat(priceStr.replace(/[^0-9.-]+/g, "")) || 0,
        mcap: parseMcapValue(mcapStr),
        currency: priceStr.includes('$') ? 'USD' : (priceStr.includes('€') ? 'EUR' : 'GBP')
    });

    updateCalculatorUI();
});

// 4. ACTION: Add Manually (For ETFs)
submitManualBtn.addEventListener('click', () => {
    const name = document.getElementById('man-name').value;
    const ticker = document.getElementById('man-ticker').value;
    const price = parseFloat(document.getElementById('man-price').value);
    const mcapRaw = document.getElementById('man-mcap').value;
    const currentCurrency = currencySelect.value;

    if (!name || !ticker || isNaN(price) || !mcapRaw) {
        alert("Please fill in all fields correctly.");
        return;
    }

    portfolioItems.push({
        ticker: ticker.toUpperCase(),
        name: name,
        price: price,
        mcap: parseMcapValue(mcapRaw.toUpperCase()),
        currency: currentCurrency 
    });

    // Clear and Hide
    document.getElementById('man-name').value = '';
    document.getElementById('man-ticker').value = '';
    document.getElementById('man-price').value = '';
    document.getElementById('man-mcap').value = '';
    manualForm.classList.add('hidden');

    updateCalculatorUI();
});

// 5. HELPER: Parse strings like "3.2T" or "500B" into numbers
function parseMcapValue(str) {
    if (!str) return 0;
    const num = parseFloat(str.replace(/[^0-9.-]+/g, "")) || 0;
    if (str.includes('T')) return num * 1000000000000;
    if (str.includes('B')) return num * 1000000000;
    if (str.includes('M')) return num * 1000000;
    return num;
}

// 6. CORE: Update the Table UI and Math
function updateCalculatorUI() {
    const existingRows = calcTableBody.querySelectorAll('.asset-row');
    existingRows.forEach(row => row.remove());

    if (portfolioItems.length === 0) {
        calcEmptyRow.style.display = 'table-row';
        return;
    }

    calcEmptyRow.style.display = 'none';

    const totalMcap = portfolioItems.reduce((acc, item) => acc + item.mcap, 0);
    const totalInvestment = parseFloat(investmentInput.value) || 0;

    portfolioItems.forEach((item, index) => {
        const weight = item.mcap / totalMcap;
        const targetAmount = totalInvestment * weight;
        const shares = targetAmount / item.price;

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
    const symbol = curr === 'USD' ? '$' : (curr === 'EUR' ? '€' : '£');
    return `${symbol}${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

// Listeners for re-calculation
investmentInput.addEventListener('input', updateCalculatorUI);
currencySelect.addEventListener('change', updateCalculatorUI);

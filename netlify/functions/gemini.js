exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { portfolio, investment, currency } = body;
    if (!portfolio || !portfolio.length) {
        return { statusCode: 400, body: JSON.stringify({ error: 'No portfolio data' }) };
    }

    const assetList = portfolio.map(a =>
        `- ${a.name} (${a.ticker}): ${a.weight}% weight, price ${a.price} ${a.localCurrency}`
    ).join('\n');

    const prompt = `You are a concise, balanced portfolio analyst. A user has built the following investment portfolio:

Total Investment: ${investment} ${currency}

Assets:
${assetList}

Provide a short, honest analysis using bullet points only. Cover:
• Overall diversification quality
• Any concentration risks (single stock, sector, or geographic)
• ETF vs individual stock balance
• Any notable gaps or missing asset classes
• One overall verdict (e.g. Balanced, Concentrated, Growth-heavy, etc.)

Keep it to 6–8 bullet points. Be direct and specific. No preamble, no sign-off.`;

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
                }),
            }
        );

        const data = await res.json();

        if (!res.ok) {
            return {
                statusCode: res.status,
                body: JSON.stringify({ error: data?.error?.message || 'Gemini API error' }),
            };
        }

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result: text }),
        };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

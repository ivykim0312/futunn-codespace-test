// collector.js

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- 配置區 (優先使用環境變數) ---
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "7983228284:AAHQS3kD3gUuiA603EmfNI1QDGN0LPPHlLA";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "8013998184";
const FUTUNN_API_URL = process.env.FUTUNN_API_URL || "https://news.futunn.com/news-site-api/main/get-flash-list?pageSize=30";
const SENT_KEYS_FILE = process.env.SENT_KEYS_FILE || path.join(__dirname, 'futunn_sent_news_ids.json');
const MIN_INTERVAL_MS = parseInt(process.env.MIN_INTERVAL_MS, 10) || 10000;
const MAX_INTERVAL_MS = parseInt(process.env.MAX_INTERVAL_MS, 10) || 30000;
// --- 配置區結束 ---

if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.warn('警告: TG_BOT_TOKEN 或 TG_CHAT_ID 未設定。建議透過環境變數提供憑證，避免把敏感資訊放在程式碼裡。');
}

// ==================== 輔助函數 ====================
const escapeMarkdown = (text) => {
    if (!text) return '';
    return text
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_')
        .replace(/\[/g, '\\[')
        .replace(/]/g, '\\]')
        .replace(/`/g, '\\`');
};

const loadSentIds = async () => {
    try {
        if (fs.existsSync(SENT_KEYS_FILE)) {
            const data = fs.readFileSync(SENT_KEYS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("無法讀取存儲文件:", e.message);
    }
    return [];
};

const saveSentIds = async (ids) => {
    try {
        const finalIds = ids.length > 5000 ? ids.slice(ids.length - 5000) : ids;
        fs.writeFileSync(SENT_KEYS_FILE, JSON.stringify(finalIds, null, 2), 'utf8');
    } catch (e) {
        console.error("無法寫入存儲文件:", e.message);
    }
};

const sendTelegramMessage = async (message, title) => {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
        console.error('Telegram 憑證缺失，無法發送消息。');
        return;
    }
    const tgUrl = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
    const payload = {
        chat_id: TG_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    };

    try {
        const res = await axios.post(tgUrl, payload);
        return res.data;
    } catch (error) {
        console.error(`Telegram 推送失敗 (${title})。錯誤訊息:`, error.response?.data || error.message);
    }
};

// ==================== 核心採集和推送邏輯 ====================
let stopped = false;

async function startScrapingAndPush() {
    console.log(`[${new Date().toLocaleString()}] 腳本運行：開始從 API 採集數據...`);

    let sentNewsIds = await loadSentIds();
    const sentKeysSet = new Set(sentNewsIds);
    const newIdsBuffer = [];
    let newNewsCount = 0;

    const timestamp = Date.now();
    const apiUrlWithTimestamp = `${FUTUNN_API_URL}&_t=${timestamp}`;

    try {
        const response = await axios.get(apiUrlWithTimestamp, { timeout: 10000 });
        const data = response.data;
        const newsList = data?.data?.data?.news || [];

        // reverse 保持與原始腳本一致（從舊到新順序處理）
        newsList.reverse().forEach(item => {
            const uniqueId = item?.id;
            if (uniqueId && !sentKeysSet.has(uniqueId)) {
                const rawTitle = item.title || item.content || '';
                const isImportant = (typeof item.level === 'number') ? item.level > 0 : false;

                const clean_title = rawTitle.replace(/\n/g, ' ').trim();
                const safe_title = escapeMarkdown(clean_title);

                const prefix = isImportant ? '🚨 ' : '';
                const message = `${prefix}*${safe_title}*`;

                // 非同步發送，但等待一個短暫間隔以降低短時間內大量請求
                sendTelegramMessage(message, clean_title).catch(err => {
                    console.error('sendTelegramMessage error:', err?.message || err);
                });

                newIdsBuffer.push(uniqueId);
                newNewsCount++;
            }
        });

        if (newIdsBuffer.length > 0) {
            sentNewsIds.push(...newIdsBuffer);
            await saveSentIds(sentNewsIds);
        }

        if (newNewsCount > 0) {
            console.log(`[${new Date().toLocaleTimeString()}] 採集完畢。發現新新聞 ${newNewsCount} 條並已推送。`);
        }

    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] API 連線或解析失敗:`, error.message || error);
    }
}

// ==================== 定時運行邏輯 ====================
const scheduleNextRun = () => {
    if (stopped) return;
    const randomDelay = Math.floor(Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS + 1)) + MIN_INTERVAL_MS;

    setTimeout(async () => {
        await startScrapingAndPush();
        scheduleNextRun();
    }, randomDelay);

    console.log(`[${new Date().toLocaleTimeString()}] 下一次採集將在 ${Math.round(randomDelay / 1000)} 秒後開始...`);
};

// 優雅關閉
const shutdown = () => {
    if (stopped) return;
    stopped = true;
    console.log('收到終止信號，正在停止腳本...');
    setTimeout(() => {
        console.log('已停止。');
        process.exit(0);
    }, 1500);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 首次啟動
(async () => {
    await startScrapingAndPush(); // 立即運行一次
    scheduleNextRun();
})();

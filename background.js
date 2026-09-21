// background.js - Chrome扩展后台脚本

// 定时器名称
const ALARM_NAME = 'tokenRefresh';

const FLOW_URL = 'https://flow.google.com/';
const MODERN_FLOW_COOKIE_NAMES = new Set(['OSID', '__Secure-OSID']);
const GOOGLE_ACCOUNT_COOKIE_NAMES = new Set(['SID', 'HSID', 'SSID', 'APISID', 'SAPISID']);
const COOKIE_QUERIES = [
    { label: 'Flow新版页面', query: { url: FLOW_URL } },
    { label: 'Flow新版域名', query: { domain: 'flow.google.com' } },
    { label: 'Google账号域名', query: { domain: '.google.com' } }
];

// 日志系统
const Logger = {
    async log(level, message, details = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            details
        };

        console.log(`[${level}] ${message}`, details || '');

        // 存储到chrome.storage.local（单次会话有效）
        const { logs = [] } = await chrome.storage.local.get(['logs']);
        logs.unshift(logEntry); // 最新的在前面

        // 只保留最近50条日志
        if (logs.length > 50) {
            logs.splice(50);
        }

        await chrome.storage.local.set({ logs });
    },

    info(message, details) {
        return this.log('INFO', message, details);
    },

    error(message, details) {
        return this.log('ERROR', message, details);
    },

    success(message, details) {
        return this.log('SUCCESS', message, details);
    },

    async getLogs() {
        const { logs = [] } = await chrome.storage.local.get(['logs']);
        return logs;
    },

    async clearLogs() {
        await chrome.storage.local.set({ logs: [] });
    }
};

// 初始化：设置定时器
chrome.runtime.onInstalled.addListener(async () => {
    await Logger.info('Flow2API Token Updater installed');
    await setupAlarm();
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateConfig') {
        // 更新配置后重新设置定时器
        setupAlarm().then(async () => {
            await Logger.info('Config updated, alarm reset');
        });
    } else if (request.action === 'testNow') {
        // 立即执行一次
        extractAndSendToken().then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // 保持消息通道开启
    } else if (request.action === 'getLogs') {
        // 获取日志
        Logger.getLogs().then((logs) => {
            sendResponse({ success: true, logs });
        });
        return true;
    } else if (request.action === 'clearLogs') {
        // 清除日志
        Logger.clearLogs().then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
});

// 监听定时器触发
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        await Logger.info('Alarm triggered, extracting token...');
        const result = await extractAndSendToken();

        // 发送通知
        if (result.success) {
            const title = result.action === 'updated' ? '✅ Token已更新' : '✅ Token已添加';
            const message = result.displayMessage || result.message || 'Token已成功同步到Flow2API';

            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: title,
                message: message
            });
        } else {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: '❌ Token同步失败',
                message: result.error || '未知错误'
            });
        }
    }
});

// 设置定时器
async function setupAlarm() {
    // 清除旧的定时器
    await chrome.alarms.clear(ALARM_NAME);

    // 获取配置
    const config = await chrome.storage.sync.get(['refreshInterval']);
    const intervalMinutes = config.refreshInterval || 60;

    // 创建新的定时器
    chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: intervalMinutes
    });

    await Logger.info(`Alarm set to ${intervalMinutes} minutes`);
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function waitForTabReady(tabId, timeoutMs = 15000) {
    return new Promise((resolve) => {
        let settled = false;

        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
        };

        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                finish();
            }
        };

        const timer = setTimeout(finish, timeoutMs);
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId).then((currentTab) => {
            if (currentTab && currentTab.status === 'complete') {
                finish();
            }
        }).catch(finish);
    });
}

function normalizeCookieDomain(domain) {
    return String(domain || '').replace(/^\./, '').toLowerCase();
}

function cookieKey(cookie) {
    const partitionSite = cookie.partitionKey && cookie.partitionKey.topLevelSite
        ? cookie.partitionKey.topLevelSite
        : '';
    return [cookie.name, cookie.domain, cookie.path, cookie.storeId, partitionSite].join('\u0000');
}

function deduplicateCookies(cookies) {
    return Array.from(new Map(cookies.map(cookie => [cookieKey(cookie), cookie])).values());
}

function isGoogleCookieDomain(domain) {
    const normalizedDomain = normalizeCookieDomain(domain);
    return normalizedDomain === 'google.com' || normalizedDomain.endsWith('.google.com');
}

function isGoogleAccountCookieDomain(domain) {
    const normalizedDomain = normalizeCookieDomain(domain);
    return normalizedDomain === 'google.com' || normalizedDomain === 'accounts.google.com';
}

function cookiePreferenceScore(cookie) {
    const domain = normalizeCookieDomain(cookie.domain);
    let score = String(cookie.path || '').length;

    if (MODERN_FLOW_COOKIE_NAMES.has(cookie.name) && domain === 'flow.google.com') {
        score += 10000;
    }
    if (GOOGLE_ACCOUNT_COOKIE_NAMES.has(cookie.name)) {
        if (domain === 'google.com') {
            score += 10000;
        } else if (domain === 'accounts.google.com') {
            score += 9000;
        }
    }

    return score;
}

function buildCookieHeader(cookies) {
    const selectedCookies = new Map();

    for (const cookie of cookies) {
        if (!cookie.name || !cookie.value) {
            continue;
        }

        const domain = normalizeCookieDomain(cookie.domain);
        const isRelevantDomain = domain === 'flow.google.com' || isGoogleCookieDomain(domain);

        if (!isRelevantDomain) {
            continue;
        }

        const existing = selectedCookies.get(cookie.name);
        const cookieScore = cookiePreferenceScore(cookie);
        const existingScore = existing ? cookiePreferenceScore(existing) : -1;
        if (!existing || cookieScore > existingScore) {
            selectedCookies.set(cookie.name, cookie);
        }
    }

    return Array.from(selectedCookies.values())
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ');
}

async function collectRelevantCookies() {
    const cookies = [];

    for (const source of COOKIE_QUERIES) {
        try {
            const found = await chrome.cookies.getAll(source.query);
            cookies.push(...found);
            await Logger.info(`从${source.label}找到 ${found.length} 个cookies`);
        } catch (error) {
            await Logger.error(`读取${source.label} cookies失败`, { error: error.message });
        }
    }

    return deduplicateCookies(cookies);
}

async function closeTemporaryTab(tab) {
    if (!tab || typeof tab.id !== 'number') {
        return;
    }

    try {
        await chrome.tabs.remove(tab.id);
        await Logger.info('标签页已关闭');
    } catch (error) {
        await Logger.info('临时标签页已不存在');
    }
}

function parseServerErrorMessage(responseText) {
    const raw = String(responseText || '').trim();
    if (!raw) {
        return '';
    }

    try {
        const payload = JSON.parse(raw);
        const message = payload.detail || payload.message || payload.error;
        if (typeof message === 'string') {
            return message.slice(0, 300);
        }
    } catch (error) {
        // 非JSON响应直接使用截断后的文本
    }

    return raw.slice(0, 300);
}

// 提取cookie并发送到服务器
async function extractAndSendToken() {
    let tab = null;

    try {
        await Logger.info('开始提取Token...');

        // 获取配置
        const config = await chrome.storage.sync.get(['apiUrl', 'connectionToken']);

        if (!config.apiUrl || !config.connectionToken) {
            await Logger.error('配置未设置');
            return { success: false, error: '配置未设置' };
        }

        await Logger.info('配置已加载', { apiUrl: config.apiUrl });

        // 1. 打开新版Flow页面（在后台），让浏览器刷新当前登录态
        await Logger.info('正在打开Google Flow页面...');
        tab = await chrome.tabs.create({
            url: FLOW_URL,
            active: false
        });

        await Logger.info('页面已创建，等待加载...', { tabId: tab.id });

        await waitForTabReady(tab.id);

        await Logger.info('页面加载完成，等待JavaScript执行...');

        await sleep(5000);

        await Logger.info('开始提取Cookies...');

        // 2. 提取新版Flow会话与Google账号Cookie
        const uniqueCookies = await collectRelevantCookies();

        await Logger.info(`总共找到 ${uniqueCookies.length} 个唯一cookies`, {
            cookieNames: uniqueCookies.map(c => ({ name: c.name, domain: c.domain }))
        });

        const modernFlowCookie = uniqueCookies.find(cookie => (
            MODERN_FLOW_COOKIE_NAMES.has(cookie.name)
            && normalizeCookieDomain(cookie.domain) === 'flow.google.com'
            && cookie.value
        ));
        const googleAccountCookie = uniqueCookies.find(cookie => (
            GOOGLE_ACCOUNT_COOKIE_NAMES.has(cookie.name)
            && isGoogleAccountCookieDomain(cookie.domain)
            && cookie.value
        ));
        const googleCookies = buildCookieHeader(uniqueCookies);

        if (modernFlowCookie) {
            await Logger.success('找到新版Flow Cookie', {
                name: modernFlowCookie.name,
                domain: modernFlowCookie.domain,
                path: modernFlowCookie.path,
                length: modernFlowCookie.value.length
            });
        }

        // 关闭标签页
        await closeTemporaryTab(tab);
        tab = null;

        if (!modernFlowCookie) {
            await Logger.error('未找到Flow登录Cookie', {
                foundCookies: uniqueCookies.map(c => ({
                    name: c.name,
                    domain: c.domain
                }))
            });

            return {
                success: false,
                error: '未找到Flow登录Cookie。请先登录Google Flow，并确认首页或项目页可以正常打开。'
            };
        }

        if (modernFlowCookie && !googleAccountCookie) {
            await Logger.error('未找到Google账号Cookie', {
                requiredNames: Array.from(GOOGLE_ACCOUNT_COOKIE_NAMES)
            });
            return {
                success: false,
                error: '已找到新版Flow会话，但未读取到Google账号Cookie。请重新登录Google后再试。'
            };
        }

        if (!googleCookies) {
            await Logger.error('Cookie序列化失败');
            return { success: false, error: '未生成可同步的Cookie数据。' };
        }

        await Logger.info('Flow Cookie提取成功', {
            mode: 'modern-cookie',
            cookieCount: googleCookies.split('; ').length
        });

        // 3. 发送到服务器
        await Logger.info('正在发送到服务器...');

        const payload = {
            google_cookies: googleCookies,
            protocol_mode: 'protocol'
        };

        const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.connectionToken}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            const serverError = parseServerErrorMessage(errorText);
            await Logger.error('服务器错误', {
                status: response.status,
                error: serverError
            });

            return {
                success: false,
                error: serverError
                    ? `服务器错误 ${response.status}: ${serverError}`
                    : `服务器错误: ${response.status}`
            };
        }

        const result = await response.json();

        // 根据action显示不同的日志信息
        if (result.action === 'updated') {
            await Logger.success('✅ Token已更新到上游', {
                action: '更新现有Token',
                message: result.message
            });
        } else if (result.action === 'added') {
            await Logger.success('✅ Token已添加到上游', {
                action: '添加新Token',
                message: result.message
            });
        } else {
            await Logger.success('✅ Token已同步到上游', result);
        }

        return {
            success: true,
            message: result.message || 'Token更新成功',
            action: result.action,
            displayMessage: result.action === 'updated'
                ? `✅ 成功更新到上游\n${result.message}`
                : `✅ 成功添加到上游\n${result.message}`
        };

    } catch (error) {
        await Logger.error('提取过程出错', {
            error: error.message,
            stack: error.stack
        });

        await closeTemporaryTab(tab);

        return { success: false, error: error.message };
    }
}

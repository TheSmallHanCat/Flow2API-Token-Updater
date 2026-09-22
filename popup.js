// popup.js - Chrome扩展配置界面脚本

document.addEventListener('DOMContentLoaded', async () => {
    // 加载已保存的配置
    const config = await chrome.storage.sync.get(['apiUrl', 'connectionToken', 'loginAccount', 'refreshInterval']);

    if (config.apiUrl) {
        document.getElementById('apiUrl').value = config.apiUrl;
    }
    if (config.connectionToken) {
        document.getElementById('connectionToken').value = config.connectionToken;
    }
    if (config.loginAccount) {
        document.getElementById('loginAccount').value = config.loginAccount;
    }
    if (config.refreshInterval) {
        document.getElementById('refreshInterval').value = config.refreshInterval;
    }

    // 保存配置
    document.getElementById('saveBtn').addEventListener('click', async () => {
        const apiUrl = document.getElementById('apiUrl').value.trim();
        const connectionToken = document.getElementById('connectionToken').value.trim();
        const loginAccount = document.getElementById('loginAccount').value.trim();
        const refreshInterval = parseInt(document.getElementById('refreshInterval').value);

        if (!apiUrl || !connectionToken) {
            showStatus('请填写完整的配置信息', 'error');
            return;
        }

        if (refreshInterval < 1 || refreshInterval > 1440) {
            showStatus('刷新间隔必须在1-1440分钟之间', 'error');
            return;
        }

        // 保存配置
        await chrome.storage.sync.set({
            apiUrl,
            connectionToken,
            loginAccount,
            refreshInterval
        });

        // 通知background script更新定时器
        chrome.runtime.sendMessage({
            action: 'updateConfig',
            config: { apiUrl, connectionToken, loginAccount, refreshInterval }
        });

        showStatus('配置保存成功！', 'success');
    });

    // 立即测试
    document.getElementById('testBtn').addEventListener('click', async () => {
        const apiUrl = document.getElementById('apiUrl').value.trim();
        const connectionToken = document.getElementById('connectionToken').value.trim();

        if (!apiUrl || !connectionToken) {
            showStatus('请先填写并保存配置', 'error');
            return;
        }

        showStatus('正在测试连接...', 'info');

        // 通知background script立即执行一次
        chrome.runtime.sendMessage({
            action: 'testNow'
        }, (response) => {
            if (response && response.success) {
                // 根据action显示不同的成功信息
                let statusMessage = '';
                if (response.action === 'updated') {
                    statusMessage = `✅ 测试成功！Token已更新到上游\n${response.message}`;
                } else if (response.action === 'added') {
                    statusMessage = `✅ 测试成功！Token已添加到上游\n${response.message}`;
                } else {
                    statusMessage = `✅ 测试成功！${response.message}`;
                }
                showStatus(statusMessage, 'success');
            } else {
                showStatus(`❌ 测试失败：${response ? response.error : '未知错误'}`, 'error');
            }
        });
    });

    // 查看日志
    document.getElementById('logsBtn').addEventListener('click', () => {
        window.location.href = 'logs.html';
    });
});

function showStatus(message, type) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';

    // 3秒后自动隐藏
    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 3000);
}

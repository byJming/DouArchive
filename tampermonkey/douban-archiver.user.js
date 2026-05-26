// ==UserScript==
// @name         豆藏 - 豆瓣数据采集工具
// @namespace    https://github.com/byJming/DouArchive
// @version      2.5.0
// @description  豆瓣电影/读书/音乐数据一键采集，支持同步至本地后端
// @author       byJming
// @match        https://*.douban.com/*
// @match        https://douban.com/*
// @exclude      https://*.douban.com/api/*
// @require      https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      127.0.0.1
// @license      PolyForm-Noncommercial-1.0.0
// ==/UserScript==

(function () {
    'use strict';

    // ========================================================================
    // 常量与配置
    // ========================================================================

    const STORAGE_KEYS = {
        DATA: 'da_scrape_data',
        STATUS: 'da_scrape_status',
        CONFIG: 'da_scrape_config',
        PROGRESS: 'da_scrape_progress',
        TASK_QUEUE: 'da_task_queue',
        PANEL_OPEN: 'da_panel_open',
        MAX_PAGES: 'da_max_pages',
        SELECTED_MEDIA: 'da_selected_media',
        SELECTED_STATUS: 'da_selected_status',
    };

    const ANTI_BAN = {
        minDelay: 2000,
        maxDelay: 5000,
        maxPagesPerRun: 50,
        cooldownAfter: 10,
        cooldownTime: 30000,
        maxRetries: 3,
        retryDelay: 10000,
    };

    const BACKEND_URL = 'http://127.0.0.1:18080';

    const MEDIA_TYPE_NAMES = {
        movie: '电影',
        book: '读书',
        music: '音乐',
    };

    const MARK_STATUS_NAMES = {
        movie: { wish: '想看', do: '在看', collect: '看过' },
        book: { wish: '想读', do: '在读', collect: '读过' },
        music: { wish: '想听', do: '在听', collect: '听过' },
    };

    // 豆瓣页面 URL 模板
    const DOUBAN_URLS = {
        movie: {
            wish: 'https://movie.douban.com/mine?status=wish&mode=list',
            do: 'https://movie.douban.com/mine?status=do&mode=list',
            collect: 'https://movie.douban.com/mine?status=collect&mode=list',
        },
        book: {
            wish: 'https://book.douban.com/mine?status=wish&mode=list',
            do: 'https://book.douban.com/mine?status=do&mode=list',
            collect: 'https://book.douban.com/mine?status=collect&mode=list',
        },
        music: {
            wish: 'https://music.douban.com/mine?status=wish&mode=list',
            do: 'https://music.douban.com/mine?status=do&mode=list',
            collect: 'https://music.douban.com/mine?status=collect&mode=list',
        },
    };

    // ========================================================================
    // 工具函数
    // ========================================================================

    function detectMediaType() {
        const host = window.location.hostname;
        if (host.includes('movie')) return 'movie';
        if (host.includes('book')) return 'book';
        if (host.includes('music')) return 'music';
        return 'unknown';
    }

    function detectMarkStatus() {
        const url = window.location.href;
        if (url.includes('status=wish') || url.includes('/wish')) return 'wish';
        if (url.includes('status=do') || url.includes('/do')) return 'do';
        if (url.includes('status=collect') || url.includes('/collect')) return 'collect';
        return 'unknown';
    }

    function isScrapeablePage() {
        // 检查当前页面是否是可采集的列表页
        const mediaType = detectMediaType();
        const markStatus = detectMarkStatus();
        if (mediaType === 'unknown' || markStatus === 'unknown') return false;
        // 检查是否是 list 模式
        return window.location.href.includes('mode=list');
    }

    function randomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // 可中断的 sleep 函数
    function sleep(ms) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                if (shouldStop || (Date.now() - startTime >= ms)) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100); // 每 100ms 检查一次是否应该停止
        });
    }

    function formatTimestamp() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    function getTotalItems() {
        // 从页面标题提取总数，如 "我看过的影视(538)"
        const h1 = document.querySelector('h1');
        if (h1) {
            const match = h1.textContent.match(/\((\d+)\)/);
            if (match) return parseInt(match[1]);
        }
        // 从分页信息提取，如 "1-30 / 538"
        const pageInfo = document.body.textContent.match(/(\d+)-(\d+)\s*\/\s*(\d+)/);
        if (pageInfo) return parseInt(pageInfo[3]);
        return null;
    }

    function getCurrentPageInfo() {
        const url = new URL(window.location.href);
        const start = parseInt(url.searchParams.get('start')) || 0;
        return { start, page: Math.floor(start / 30) + 1 };
    }

    // ========================================================================
    // 数据采集核心
    // ========================================================================

    function scrapeCurrentPage() {
        const items = document.querySelectorAll('li.item');
        const results = [];
        const mediaType = detectMediaType();

        items.forEach((item) => {
            try {
                // 豆瓣 ID
                const itemId = item.id ? item.id.replace('list', '') : '';
                if (!itemId) return;

                // 标题与链接
                const titleEl = item.querySelector('.title a');
                const fullTitle = titleEl ? titleEl.innerText.trim() : '';
                // 去除 [可播放] 等标记
                const title = fullTitle.replace(/\[.*?\]\s*/g, '').trim();
                const doubanUrl = titleEl ? titleEl.href : '';

                // 副标题（英文名等）
                const altTitle = extractAltTitle(fullTitle, title);

                // 评分（仅"看过/读过/听过"有）
                let score = null;
                const ratingEl = item.querySelector('[class^="rating"][class$="-t"]');
                if (ratingEl) {
                    const match = ratingEl.className.match(/rating(\d)-t/);
                    if (match) score = parseInt(match[1]);
                }

                // 标记日期
                const dateEl = item.querySelector('.date');
                const dateText = dateEl ? dateEl.textContent.trim() : '';
                const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/);
                const markTime = dateMatch ? dateMatch[1] : '';

                // 元数据
                const introEl = item.querySelector('.comment-item .intro') || item.querySelector('.intro');
                const introRaw = introEl ? introEl.textContent.trim() : '';

                // 根据媒体类型解析创作者
                const creator = extractCreator(introRaw, mediaType);

                results.push({
                    douban_id: itemId,
                    media_type: mediaType,
                    title,
                    alt_title: altTitle,
                    score,
                    mark_status: detectMarkStatus(),
                    mark_time: markTime,
                    creator,
                    comment: '',  // 将在 fetchCommentsForPage 中填充
                    tags: [],     // 将在 fetchCommentsForPage 中填充
                    douban_url: doubanUrl,
                    cover: '',
                    intro_raw: introRaw,
                });
            } catch (e) {
                console.error('[DouArchive] 解析条目失败:', e);
            }
        });

        return results;
    }

    // ========================================================================
    // 短评 & 标签采集（通过编辑弹窗）
    // ========================================================================

    /**
     * 为当前页面的所有已采集条目获取短评和标签。
     * 通过逐个点击"修改"按钮打开编辑弹窗，读取 textarea[name="comment"]
     * 和 input[name="tags"]，然后关闭弹窗。
     */
    async function fetchCommentsForPage(pageData) {
        const items = document.querySelectorAll('li.item');
        let fetched = 0;

        for (let i = 0; i < items.length && !shouldStop; i++) {
            const item = items[i];
            const itemId = item.id ? item.id.replace('list', '') : '';
            if (!itemId) continue;

            // 找到对应的 pageData 条目
            const dataItem = pageData.find(d => d.douban_id === itemId);
            if (!dataItem) continue;

            try {
                // 展开隐藏区域（仅在编辑按钮不可见时才需要）
                let editBtn = item.querySelector(`a.j.a_collect_btn[name="pbtn-${itemId}"]`) ||
                              item.querySelector('a.j.a_collect_btn');

                if (!editBtn || editBtn.offsetParent === null) {
                    const itemShow = item.querySelector('.item-show');
                    if (itemShow) {
                        itemShow.click();
                        await sleep(150);
                        editBtn = item.querySelector(`a.j.a_collect_btn[name="pbtn-${itemId}"]`) ||
                                  item.querySelector('a.j.a_collect_btn');
                    }
                }
                if (!editBtn) continue;

                editBtn.click();
                await waitForElement('textarea[name="comment"]', 2000);

                // 读取短评和标签
                const commentEl = document.querySelector('textarea[name="comment"]');
                const tagsEl = document.querySelector('input[name="tags"]');

                if (commentEl) dataItem.comment = commentEl.value.trim();
                if (tagsEl) {
                    const tagsStr = tagsEl.value.trim();
                    dataItem.tags = tagsStr ? tagsStr.split(/\s+/) : [];
                }

                fetched++;

                // 关闭弹窗
                const closeBtn = document.querySelector('.pop-win .close') ||
                                 document.querySelector('#collect_form_modify .close') ||
                                 document.querySelector('[class*="close"]');
                if (closeBtn) {
                    closeBtn.click();
                } else {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
                }

                await sleep(200); // 弹窗关闭动画

            } catch (e) {
                console.warn(`[DouArchive] 获取短评失败 (${itemId}):`, e);
                try {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
                } catch (_) {}
                await sleep(150);
            }
        }

        console.log(`[DouArchive] 短评采集完成: ${fetched}/${pageData.length}`);
        return pageData;
    }

    /**
     * 等待指定选择器的元素出现在 DOM 中
     */
    function waitForElement(selector, timeout = 3000) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) { resolve(el); return; }

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`等待 ${selector} 超时`));
            }, timeout);
        });
    }

    function extractAltTitle(fullTitle, mainTitle) {
        const parts = fullTitle.replace(/\[.*?\]\s*/g, '').trim().split(' / ');
        if (parts.length > 1) {
            return parts.slice(1).join(' / ').trim();
        }
        return '';
    }

    // 已知的国家/地区名（用于跳过，从导演区间中排除）
    const KNOWN_COUNTRIES = new Set([
        '中国大陆','中国香港','中国台湾','中国','美国','英国','日本','韩国',
        '法国','德国','意大利','西班牙','加拿大','澳大利亚','印度','泰国',
        '俄罗斯','巴西','墨西哥','阿根廷','瑞典','挪威','丹麦','芬兰',
        '荷兰','比利时','瑞士','奥地利','新西兰','爱尔兰','波兰','土耳其',
        '伊朗','以色列','南非','冰岛','新加坡','马来西亚','菲律宾',
        '印度尼西亚','越南','古巴','哥伦比亚','智利','秘鲁','乌拉圭',
        '匈牙利','捷克','罗马尼亚','希腊','葡萄牙','乌克兰','埃及',
        '摩洛哥','尼日利亚','中国大陆 / 中国香港','南斯拉夫','苏联',
        '中国澳门','塞尔维亚','克罗地亚','斯洛文尼亚','格鲁吉亚',
        '哈萨克斯坦','黎巴嫩','约旦','沙特阿拉伯','卢森堡','列支敦士登',
    ]);

    /**
     * 提取创作者（电影=导演，书=作者，音乐=艺术家）
     *
     * 电影 intro 实际格式（2026-05 实测）：
     *   年份(国) / 演员们 / 国家们 / [URL] / 导演们 / 片名 / 时长 / [别名] / 类型们 / 编剧们 / 语言们
     *
     * 策略：以"时长"（如 52分钟）为锚点 → 往前找片名 → 再往前直到遇到国家/URL = 导演区间
     */
    function extractCreator(introRaw, mediaType) {
        if (!introRaw) return '';
        const parts = introRaw.split(' / ').map((s) => s.trim());

        if (mediaType === 'movie') {
            // 1. 找到时长锚点（第一个 "XX分钟" 或 "XXX分钟"）
            const durationIndex = parts.findIndex(p => /^\d+\s*分钟/.test(p));
            if (durationIndex < 2) return ''; // 数据不完整

            // 2. 前向扫描：找到时长之前最后一个国家/URL 的位置
            //    这样可以避免被导演和时长之间夹杂的日期（如 2026-03-14）误导
            let lastBoundaryIndex = 0; // 至少从第一个元素（年份）开始
            for (let i = 0; i < durationIndex; i++) {
                if (KNOWN_COUNTRIES.has(parts[i]) || /^(https?:|www\.)/.test(parts[i])) {
                    lastBoundaryIndex = i;
                }
                // 仅前 3 个位置的年份视为边界（上映日期），后面出现的日期不是边界
                if (i < 3 && /^\d{4}/.test(parts[i])) {
                    lastBoundaryIndex = i;
                }
            }

            // 3. 导演区间 = (lastBoundaryIndex, durationIndex)，需过滤掉日期和片名
            const directorStart = lastBoundaryIndex + 1;
            if (directorStart >= durationIndex) return '';

            // 4. 从候选区间中提取导演，过滤掉：日期、片名
            const directors = [];
            for (let i = directorStart; i < durationIndex; i++) {
                const p = parts[i];
                // 跳过日期（如 2026-03-14）
                if (/^\d{4}(-\d{2}(-\d{2})?)?/.test(p)) continue;
                // 跳过看起来像片名的条目（纯中文/日文短文本，不含人名中间点 ·）
                // 人名特征：包含 · 或包含西文名
                const looksLikeName = /·/.test(p) || /[A-Za-z]/.test(p);
                if (!looksLikeName && i > directorStart) {
                    // 短文本（<8字）且不像人名 → 可能是片名，跳过
                    if (p.length < 8) continue;
                }
                directors.push(p);
            }

            if (directors.length > 0) {
                return directors.join(' / ');
            }

            return '';
        } else if (mediaType === 'book') {
            // 读书格式：作者 / 译者 / 出版社 / 出版日期 / 价格
            return parts[0] || '';
        } else if (mediaType === 'music') {
            // 音乐格式：艺术家 / 发行日期 / 专辑类型 / 介质 / 流派
            return parts[0] || '';
        }
        return '';
    }

    // ========================================================================
    // 跨域持久化 — GM_setValue/GM_getValue（跨子域共享）
    // localStorage 按域隔离（www.douban.com ≠ movie.douban.com），
    // 导致跳转后状态丢失。改用 Tampermonkey 的 GM 存储，
    // 它在所有 @match 页面间共享，完美解决跨域问题。
    // ========================================================================

    function loadData() {
        try {
            const raw = GM_getValue(STORAGE_KEYS.DATA, '[]');
            return typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
        } catch {
            return [];
        }
    }

    function saveData(data) {
        GM_setValue(STORAGE_KEYS.DATA, JSON.stringify(data));
    }

    function loadProgress() {
        try {
            const raw = GM_getValue(STORAGE_KEYS.PROGRESS, null);
            if (!raw) return null;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            return null;
        }
    }

    function saveProgress(progress) {
        GM_setValue(STORAGE_KEYS.PROGRESS, JSON.stringify(progress));
    }

    function clearProgress() {
        GM_deleteValue(STORAGE_KEYS.PROGRESS);
    }

    function setStatus(status) {
        GM_setValue(STORAGE_KEYS.STATUS, status);
    }

    function getStatus() {
        return GM_getValue(STORAGE_KEYS.STATUS, 'idle');
    }

    function loadTaskQueue() {
        try {
            const raw = GM_getValue(STORAGE_KEYS.TASK_QUEUE, '[]');
            return typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
        } catch {
            return [];
        }
    }

    function saveTaskQueue(queue) {
        GM_setValue(STORAGE_KEYS.TASK_QUEUE, JSON.stringify(queue));
    }

    function clearTaskQueue() {
        GM_deleteValue(STORAGE_KEYS.TASK_QUEUE);
    }

    function getPanelOpen() {
        return GM_getValue(STORAGE_KEYS.PANEL_OPEN, false) === true || GM_getValue(STORAGE_KEYS.PANEL_OPEN, 'false') === 'true';
    }

    function setPanelOpen(open) {
        GM_setValue(STORAGE_KEYS.PANEL_OPEN, open ? 'true' : 'false');
    }

    function getSelectedMedia() {
        return GM_getValue(STORAGE_KEYS.SELECTED_MEDIA, null);
    }

    function setSelectedMedia(media) {
        if (media) GM_setValue(STORAGE_KEYS.SELECTED_MEDIA, media);
        else GM_deleteValue(STORAGE_KEYS.SELECTED_MEDIA);
    }

    function getSelectedStatus() {
        return GM_getValue(STORAGE_KEYS.SELECTED_STATUS, null);
    }

    function setSelectedStatus(status) {
        if (status) GM_setValue(STORAGE_KEYS.SELECTED_STATUS, status);
        else GM_deleteValue(STORAGE_KEYS.SELECTED_STATUS);
    }

    function mergeData(existing, incoming) {
        const map = new Map();
        for (const item of existing) {
            const key = `${item.douban_id}_${item.media_type}`;
            map.set(key, item);
        }
        for (const item of incoming) {
            const key = `${item.douban_id}_${item.media_type}`;
            const existingItem = map.get(key);
            if (existingItem) {
                // 基础字段始终覆盖
                existingItem.score = item.score;
                existingItem.mark_status = item.mark_status;
                existingItem.mark_time = item.mark_time;
                existingItem.updated_at = new Date().toISOString();
                // 以下字段：incoming 非空则覆盖，保留已有数据
                if (item.comment) existingItem.comment = item.comment;
                if (item.tags && item.tags.length > 0) existingItem.tags = item.tags;
                if (item.creator) existingItem.creator = item.creator;
                if (item.alt_title) existingItem.alt_title = item.alt_title;
                if (item.douban_url) existingItem.douban_url = item.douban_url;
                if (item.intro_raw) existingItem.intro_raw = item.intro_raw;
                if (item.cover) existingItem.cover = item.cover;
            } else {
                map.set(key, item);
            }
        }
        return Array.from(map.values());
    }

    // ========================================================================
    // 采集控制器 - 支持断点续传和任务队列
    // ========================================================================

    let isRunning = false;
    let shouldStop = false;

    // 获取最大翻页数（默认 999 = 全量抓取）
    function getMaxPages() {
        const saved = GM_getValue(STORAGE_KEYS.MAX_PAGES, null);
        return saved ? parseInt(saved) : 999;
    }

    function setMaxPages(num) {
        GM_setValue(STORAGE_KEYS.MAX_PAGES, num.toString());
    }

    async function startScrapeTask(mediaType, markStatus, maxPages) {
        if (isRunning) {
            updateStatusText('采集正在进行中...');
            return;
        }

        isRunning = true;
        shouldStop = false;
        setStatus('scraping');

        // 保存最大翻页数
        if (maxPages !== undefined) {
            setMaxPages(maxPages);
        }

        updateStatusText(`准备采集 ${MEDIA_TYPE_NAMES[mediaType]}-${MARK_STATUS_NAMES[mediaType][markStatus]}...`);
        setButtonsDisabled(true);
        showProgressBar(true);

        try {
            // 检查是否需要跳转到目标页面
            const currentMediaType = detectMediaType();
            const currentMarkStatus = detectMarkStatus();
            const isOnListMode = window.location.href.includes('mode=list');

            if (currentMediaType !== mediaType || currentMarkStatus !== markStatus || !isOnListMode) {
                // 需要跳转到目标页面
                const targetUrl = DOUBAN_URLS[mediaType][markStatus];
                updateStatusText(`正在跳转到 ${MEDIA_TYPE_NAMES[mediaType]}-${MARK_STATUS_NAMES[mediaType][markStatus]} 页面...`);

                // 获取当前输入的最大翻页数
                const maxPagesInput = document.getElementById('da-max-pages');
                const currentMaxPages = maxPages || (maxPagesInput ? parseInt(maxPagesInput.value) || 999 : getMaxPages());

                // 保存任务信息，让脚本在新页面继续执行
                saveProgress({
                    mediaType,
                    markStatus,
                    page: 1,
                    start: 0,
                    scraped: 0,
                    status: 'pending_jump',  // 使用特殊状态标记需要跳转
                    maxPages: currentMaxPages,
                    autoStart: true,  // 标记跳转后需要自动开始
                });

                // 保存面板状态为展开
                setPanelOpen(true);

                // 保存选中的任务信息，以便跳转后恢复
                setSelectedMedia(mediaType);
                setSelectedStatus(markStatus);

                // 跳转
                window.location.href = targetUrl;
                return; // 页面会跳转，脚本会重新加载
            }

            // 已经在目标页面，开始采集
            await performScrape(mediaType, markStatus);
        } catch (e) {
            console.error('[DouArchive] 采集出错:', e);
            updateStatusText(`采集出错：${e.message}`);
            setStatus('error');
        } finally {
            isRunning = false;
            setButtonsDisabled(false);
        }
    }

    async function performScrape(mediaType, markStatus) {
        const existingData = loadData();
        let allNewData = [];
        let pageCount = 0;
        let totalScraped = 0;
        const totalItems = getTotalItems();
        let maxPages = getMaxPages();

        // 检查断点续传
        const progress = loadProgress();
        if (progress && progress.mediaType === mediaType && progress.markStatus === markStatus &&
            (progress.status === 'scraping' || progress.status === 'pending_jump')) {
            if (progress.scraped > 0) {
                updateStatusText(`断点续传：从第 ${progress.page} 页继续，已采集 ${progress.scraped} 条`);
                totalScraped = progress.scraped || 0;
            }
            // 恢复已翻页计数，确保 maxPages 限制跨页面导航生效
            if (progress.pagesScraped > 0) {
                pageCount = progress.pagesScraped;
            }
            // 使用 progress 中保存的 maxPages（优先，因为它是任务开始时用户设置的值）
            if (progress.maxPages) {
                maxPages = progress.maxPages;
            }
        }

        // 确保面板展开
        panel.classList.add('da-show');
        setPanelOpen(true);

        // 更新状态为正在采集
        setStatus('scraping');
        isRunning = true;
        shouldStop = false;

        try {
            let hasNextPage = true;

            while (hasNextPage && !shouldStop && pageCount < maxPages) {
                // 在循环开始时检查终止标志
                if (shouldStop) break;

                pageCount++;

                // 采集当前页基础数据
                const pageData = scrapeCurrentPage();

                // 采集短评和标签（通过编辑弹窗逐条获取）
                if (!shouldStop) {
                    updateStatusText(`正在采集第 ${pageCount} 页短评...`);
                    await fetchCommentsForPage(pageData);
                }

                allNewData = allNewData.concat(pageData);
                totalScraped += pageData.length;

                // 更新进度
                const pageText = totalItems ? `${totalScraped} / ${totalItems}` : `${totalScraped}`;
                updateStatusText(`已采集 ${pageText} 条（第 ${pageCount} 页）`);
                if (totalItems) {
                    updateProgressBar(Math.min((totalScraped / totalItems) * 100, 100));
                }

                // 保存断点（含已翻页数，用于跨页面导航后恢复 maxPages 限制）
                const pageInfo = getCurrentPageInfo();
                saveProgress({
                    mediaType,
                    markStatus,
                    page: pageInfo.page,
                    start: pageInfo.start,
                    scraped: totalScraped,
                    pagesScraped: pageCount,
                    status: 'scraping',
                    maxPages: maxPages,
                    autoStart: true,
                });

                // 冷却检查（可中断）
                if (pageCount % ANTI_BAN.cooldownAfter === 0 && pageCount > 0) {
                    updateStatusText(`已采集 ${pageCount} 页，冷却 ${ANTI_BAN.cooldownTime / 1000} 秒...`);
                    await sleep(ANTI_BAN.cooldownTime);
                }

                // 再次检查终止标志
                if (shouldStop) break;

                // 检查下一页
                const nextLink = document.querySelector('.paginator .next a') || document.querySelector('span.next a');
                if (nextLink && !shouldStop) {
                    // 随机延迟（可中断）
                    const delay = randomDelay(ANTI_BAN.minDelay, ANTI_BAN.maxDelay);
                    updateStatusText(`等待 ${Math.round(delay / 1000)} 秒后翻页...`);
                    await sleep(delay);

                    // 检查终止标志
                    if (shouldStop) break;

                    // 保存当前数据，准备翻页
                    const mergedData = mergeData(existingData, allNewData);
                    saveData(mergedData);

                    // 翻页 - 使用 location.href，页面会跳转，脚本会重新加载
                    // 在新页面会检测到 status === 'scraping'，然后继续采集
                    window.location.href = nextLink.href;
                    return; // 脚本即将被销毁
                } else {
                    hasNextPage = false;
                }
            }

            // 无论是否终止，都保存已采集的数据
            const mergedData = mergeData(existingData, allNewData);
            saveData(mergedData);
            clearProgress();

            if (shouldStop) {
                updateStatusText(`采集已终止，已保存 ${totalScraped} 条数据`);
                setStatus('paused');
                isRunning = false;
                setButtonsDisabled(false);
            } else {
                setStatus('done');
                updateStatusText(`采集完成！共 ${totalScraped} 条，总计 ${mergedData.length} 条`);
                updateProgressBar(100);
                isRunning = false;
                setButtonsDisabled(false);

                // 清除选中状态
                setSelectedMedia(null);
                setSelectedStatus(null);

                // 检查任务队列
                const taskQueue = loadTaskQueue();
                if (taskQueue.length > 0) {
                    const nextTask = taskQueue.shift();
                    saveTaskQueue(taskQueue);
                    const nextTaskName = `${MEDIA_TYPE_NAMES[nextTask.mediaType]}-${MARK_STATUS_NAMES[nextTask.mediaType][nextTask.markStatus]}`;
                    updateStatusText(`当前任务完成，准备执行下一个任务（${nextTaskName}）...`);
                    await sleep(2000);
                    // 传递任务自身携带的 maxPages
                    startScrapeTask(nextTask.mediaType, nextTask.markStatus, nextTask.maxPages);
                }
            }
        } catch (e) {
            console.error('[DouArchive] 采集出错:', e);
            updateStatusText(`采集出错：${e.message}`);
            setStatus('error');
            isRunning = false;
            setButtonsDisabled(false);
        }
    }

    function stopScrape() {
        shouldStop = true;
        updateStatusText('正在停止...');
    }

    // ========================================================================
    // 批量采集任务管理
    // ========================================================================

    function startBatchScrape(selectedTasks, maxPages) {
        if (selectedTasks.length === 0) {
            updateStatusText('请选择至少一个采集目标');
            return;
        }

        // 为每个任务附带 maxPages，确保跨域跳转后每个任务独立保留翻页限制
        const tasksWithMaxPages = selectedTasks.map(task => ({
            ...task,
            maxPages: maxPages,
        }));

        // 第一个任务立即开始，其余加入队列
        const firstTask = tasksWithMaxPages[0];
        const remainingTasks = tasksWithMaxPages.slice(1);

        if (remainingTasks.length > 0) {
            saveTaskQueue(remainingTasks);
            updateStatusText(`已添加 ${selectedTasks.length} 个任务，开始执行第一个...`);
        }

        startScrapeTask(firstTask.mediaType, firstTask.markStatus, firstTask.maxPages);
    }

    // ========================================================================
    // 导出功能
    // ========================================================================

    function exportJSON() {
        const data = loadData();
        if (data.length === 0) {
            updateStatusText('没有数据可导出');
            return;
        }

        const filename = `douarchive_${formatTimestamp()}.json`;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        downloadBlob(blob, filename);
        updateStatusText(`已导出 ${data.length} 条数据为 JSON`);
    }

    function exportExcel() {
        const data = loadData();
        if (data.length === 0) {
            updateStatusText('没有数据可导出');
            return;
        }

        const filename = `douarchive_${formatTimestamp()}.xlsx`;

        const excelData = data.map((item) => ({
            '豆瓣ID': item.douban_id,
            '类型': MEDIA_TYPE_NAMES[item.media_type] || item.media_type,
            '标题': item.title,
            '副标题': item.alt_title || '',
            '评分': item.score || '',
            '标记状态': MARK_STATUS_NAMES[item.media_type]?.[item.mark_status] || item.mark_status,
            '标记时间': item.mark_time || '',
            '创作者': item.creator || '',
            '短评': item.comment || '',
            '标签': Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || ''),
            '豆瓣链接': item.douban_url,
            '元数据': item.intro_raw || '',
        }));

        try {
            const ws = XLSX.utils.json_to_sheet(excelData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '数据');

            ws['!cols'] = [
                { wch: 12 }, // 豆瓣ID
                { wch: 8 },  // 类型
                { wch: 30 }, // 标题
                { wch: 30 }, // 副标题
                { wch: 6 },  // 评分
                { wch: 8 },  // 标记状态
                { wch: 12 }, // 标记时间
                { wch: 20 }, // 创作者
                { wch: 50 }, // 短评
                { wch: 20 }, // 标签
                { wch: 40 }, // 豆瓣链接
                { wch: 60 }, // 元数据
            ];

            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/octet-stream' });
            downloadBlob(blob, filename);
            updateStatusText(`已导出 ${data.length} 条数据为 Excel`);
        } catch (e) {
            console.error('[DouArchive] Excel 导出失败:', e);
            updateStatusText('Excel 导出失败：' + e.message);
        }
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========================================================================
    // 后端同步
    // ========================================================================

    async function syncToBackend() {
        const data = loadData();
        if (data.length === 0) {
            updateStatusText('没有数据可同步');
            return;
        }

        updateStatusText('正在检查后端连接...');
        setButtonsDisabled(true);

        try {
            const healthOk = await checkBackendHealth();
            if (!healthOk) {
                updateStatusText('无法连接后端，请确保 DouArchive 已启动');
                setButtonsDisabled(false);
                return;
            }

            const batchSize = 50;
            const totalBatches = Math.ceil(data.length / batchSize);
            let syncedCount = 0;

            for (let i = 0; i < data.length; i += batchSize) {
                const batch = data.slice(i, i + batchSize);
                const batchNum = Math.floor(i / batchSize) + 1;
                updateStatusText(`同步中：第 ${batchNum}/${totalBatches} 批（${syncedCount + batch.length}/${data.length}）`);
                updateProgressBar((syncedCount / data.length) * 100);

                const success = await syncBatch(batch);
                if (!success) {
                    updateStatusText(`同步失败：第 ${batchNum} 批发送失败`);
                    setButtonsDisabled(false);
                    return;
                }

                syncedCount += batch.length;

                if (i + batchSize < data.length) {
                    await sleep(500);
                }
            }

            updateProgressBar(100);
            updateStatusText(`同步完成！共发送 ${syncedCount} 条数据`);
        } catch (e) {
            console.error('[DouArchive] 同步出错:', e);
            updateStatusText('同步出错：' + e.message);
        } finally {
            setButtonsDisabled(false);
        }
    }

    function checkBackendHealth() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${BACKEND_URL}/api/system/health`,
                timeout: 5000,
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        resolve(result.code === 0);
                    } catch {
                        resolve(false);
                    }
                },
                onerror: () => resolve(false),
                ontimeout: () => resolve(false),
            });
        });
    }

    function syncBatch(items) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${BACKEND_URL}/api/media/sync`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ items }),
                timeout: 30000,
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        resolve(result.code === 0);
                    } catch {
                        resolve(false);
                    }
                },
                onerror: () => resolve(false),
                ontimeout: () => resolve(false),
            });
        });
    }

    // ========================================================================
    // 清空数据
    // ========================================================================

    function clearAllData() {
        if (!confirm('确定要清空所有已采集的数据吗？此操作不可撤销。')) return;
        GM_deleteValue(STORAGE_KEYS.DATA);
        GM_deleteValue(STORAGE_KEYS.PROGRESS);
        GM_deleteValue(STORAGE_KEYS.STATUS);
        GM_deleteValue(STORAGE_KEYS.TASK_QUEUE);
        setSelectedMedia(null);
        setSelectedStatus(null);
        setStatus('idle');
        isRunning = false;
        shouldStop = false;
        updateStatusText('数据已清空');
        updateProgressBar(0);
        showProgressBar(false);
        setButtonsDisabled(false);
        updateDataCount();

        // 取消所有任务选中状态
        const taskItems = document.querySelectorAll('.da-task-item');
        taskItems.forEach(item => item.classList.remove('selected'));
    }

    // ========================================================================
    // UI 界面
    // ========================================================================

    GM_addStyle(`
        #da-float-btn {
            position: fixed;
            right: 30px;
            bottom: 30px;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: #3eaf7c;
            color: #fff;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(62, 175, 124, 0.4);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            transition: all 0.3s ease;
            user-select: none;
        }
        #da-float-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 16px rgba(62, 175, 124, 0.5);
        }
        #da-float-btn:active {
            transform: scale(0.95);
        }
        #da-float-btn .da-badge {
            position: absolute;
            top: -4px;
            right: -4px;
            background: #e74c3c;
            color: #fff;
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 10px;
            min-width: 18px;
            text-align: center;
            line-height: 14px;
        }

        #da-panel {
            position: fixed;
            right: 30px;
            bottom: 100px;
            width: 400px;
            max-height: 80vh;
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
            z-index: 99998;
            display: none;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
            font-size: 14px;
            color: #333;
            line-height: 1.5;
        }
        #da-panel.da-show {
            display: block;
            animation: da-slide-up 0.25s ease;
        }
        @keyframes da-slide-up {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .da-header {
            background: linear-gradient(135deg, #3eaf7c, #339268);
            color: #fff;
            padding: 16px 20px;
            cursor: move;
            user-select: none;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .da-header-title {
            font-size: 16px;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        .da-header-close {
            background: none;
            border: none;
            color: #fff;
            font-size: 20px;
            cursor: pointer;
            padding: 0 4px;
            opacity: 0.8;
            transition: opacity 0.2s;
            line-height: 1;
        }
        .da-header-close:hover {
            opacity: 1;
        }

        .da-body {
            padding: 16px 20px;
            overflow-y: auto;
            max-height: calc(80vh - 120px);
        }

        .da-section {
            margin-bottom: 16px;
        }
        .da-section-title {
            font-size: 13px;
            font-weight: 600;
            color: #666;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .da-task-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }
        .da-task-item {
            background: #f5f5f5;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            padding: 10px 8px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 12px;
        }
        .da-task-item:hover {
            border-color: #3eaf7c;
            background: #f0f9f4;
        }
        .da-task-item.selected {
            border-color: #3eaf7c;
            background: #e8f5e9;
            color: #2e7d32;
        }
        .da-task-item.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .da-task-media {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 2px;
        }
        .da-task-status {
            font-size: 11px;
            color: #888;
        }

        .da-btn-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 16px;
        }
        .da-btn {
            padding: 10px 16px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .da-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .da-btn-primary {
            background: #3eaf7c;
            color: #fff;
        }
        .da-btn-primary:hover:not(:disabled) {
            background: #339268;
            box-shadow: 0 2px 8px rgba(62, 175, 124, 0.3);
        }
        .da-btn-stop {
            background: #e74c3c;
            color: #fff;
        }
        .da-btn-stop:hover:not(:disabled) {
            background: #c0392b;
        }
        .da-btn-secondary {
            background: #f5f5f5;
            color: #555;
            border: 1px solid #e0e0e0;
        }
        .da-btn-secondary:hover:not(:disabled) {
            background: #eee;
        }
        .da-btn-sync {
            background: #3498db;
            color: #fff;
        }
        .da-btn-sync:hover:not(:disabled) {
            background: #2980b9;
            box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);
        }
        .da-btn-full {
            grid-column: 1 / -1;
        }
        .da-btn-danger {
            background: #fff5f5;
            color: #e74c3c;
            border: 1px solid #fecdd3;
        }
        .da-btn-danger:hover:not(:disabled) {
            background: #fee2e2;
        }

        .da-progress-wrap {
            margin-bottom: 12px;
            display: none;
        }
        .da-progress-wrap.da-show {
            display: block;
        }
        .da-progress-bar {
            height: 6px;
            background: #eee;
            border-radius: 3px;
            overflow: hidden;
        }
        .da-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #3eaf7c, #67c23a);
            border-radius: 3px;
            transition: width 0.3s ease;
            width: 0%;
        }

        .da-status-text {
            color: #888;
            font-size: 12px;
            margin-top: 8px;
            min-height: 18px;
            word-break: break-all;
        }

        .da-footer {
            border-top: 1px solid #f0f0f0;
            padding: 10px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .da-footer-info {
            font-size: 11px;
            color: #aaa;
        }
        .da-data-count {
            font-size: 12px;
            color: #3eaf7c;
            font-weight: 500;
        }

        .da-divider {
            height: 1px;
            background: #f0f0f0;
            margin: 12px 0;
        }

        .da-quick-scrape {
            background: #f0f9f4;
            border: 1px solid #d4edda;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 12px;
        }
        .da-quick-scrape-title {
            font-size: 12px;
            color: #3eaf7c;
            font-weight: 500;
            margin-bottom: 8px;
        }
        .da-quick-scrape-info {
            font-size: 11px;
            color: #666;
        }

        .da-settings-row {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 8px;
        }
        .da-label {
            font-size: 13px;
            color: #555;
            white-space: nowrap;
        }
        .da-input-group {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .da-input {
            width: 80px;
            padding: 6px 10px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 13px;
            text-align: center;
            outline: none;
            transition: border-color 0.2s;
        }
        .da-input:focus {
            border-color: #3eaf7c;
        }
        .da-input-hint {
            font-size: 11px;
            color: #999;
        }
    `);

    // 创建悬浮按钮
    const floatBtn = document.createElement('div');
    floatBtn.id = 'da-float-btn';
    floatBtn.innerHTML = '&#9776;';
    floatBtn.title = '豆藏 - 数据采集';
    document.body.appendChild(floatBtn);

    // 创建面板
    const panel = document.createElement('div');
    panel.id = 'da-panel';
    document.body.appendChild(panel);

    // 生成任务选择网格
    function renderTaskGrid() {
        let html = '';
        const mediaTypes = ['movie', 'book', 'music'];
        const markStatuses = ['wish', 'do', 'collect'];

        mediaTypes.forEach(media => {
            markStatuses.forEach(status => {
                const isSelected = isTaskSelected(media, status);
                html += `
                    <div class="da-task-item ${isSelected ? 'selected' : ''}" data-media="${media}" data-status="${status}">
                        <div class="da-task-media">${MEDIA_TYPE_NAMES[media]}</div>
                        <div class="da-task-status">${MARK_STATUS_NAMES[media][status]}</div>
                    </div>
                `;
            });
        });
        return html;
    }

    function isTaskSelected(mediaType, markStatus) {
        // 检查当前页面是否匹配
        const currentMedia = detectMediaType();
        const currentStatus = detectMarkStatus();
        return currentMedia === mediaType && currentStatus === markStatus && isScrapeablePage();
    }

    // 检测当前页面状态
    const currentMediaType = detectMediaType();
    const currentMarkStatus = detectMarkStatus();
    const isOnScrapeablePage = isScrapeablePage();

    // 最大翻页数默认留空（= 全量抓取）
    const savedMaxPages = '';

    panel.innerHTML = `
        <div class="da-header" id="da-drag-handle">
            <span class="da-header-title">豆藏 - 数据采集</span>
            <button class="da-header-close" id="da-close-btn">&times;</button>
        </div>
        <div class="da-body">
            <div class="da-section">
                <div class="da-section-title">选择采集目标</div>
                <div class="da-task-grid" id="da-task-grid">
                    ${renderTaskGrid()}
                </div>
            </div>

            <div class="da-section">
                <div class="da-section-title">采集设置</div>
                <div class="da-settings-row">
                    <label class="da-label">最大翻页数：</label>
                    <div class="da-input-group">
                        <input type="number" id="da-max-pages" class="da-input" value="${savedMaxPages}" min="1" max="999" placeholder="全量">
                        <span class="da-input-hint">留空 = 全量 · 每源独立</span>
                    </div>
                </div>
            </div>

            <div class="da-btn-group">
                <button class="da-btn da-btn-primary da-btn-full" id="da-start-btn">开始全量抓取</button>
                <button class="da-btn da-btn-stop da-btn-full" id="da-stop-btn" style="display:none;">终止采集</button>
            </div>

            <div class="da-divider"></div>

            <div class="da-btn-group">
                <button class="da-btn da-btn-secondary" id="da-export-json-btn">导出 JSON</button>
                <button class="da-btn da-btn-secondary" id="da-export-excel-btn">导出 Excel</button>
                <button class="da-btn da-btn-sync da-btn-full" id="da-sync-btn">同步到后端</button>
            </div>

            <div class="da-divider"></div>

            <div class="da-progress-wrap" id="da-progress-wrap">
                <div class="da-progress-bar">
                    <div class="da-progress-fill" id="da-progress-fill"></div>
                </div>
            </div>
            <div class="da-status-text" id="da-status-text">就绪，选择目标后点击"开始全量抓取"</div>
        </div>
        <div class="da-footer">
            <span class="da-footer-info">v2.5.0 · PolyForm NC</span>
            <span class="da-data-count" id="da-data-count"></span>
            <button class="da-btn da-btn-danger" id="da-clear-btn" style="padding:4px 10px;font-size:11px;">清空数据</button>
        </div>
    `;

    // ========================================================================
    // UI 控制函数
    // ========================================================================

    function updateStatusText(text) {
        const el = document.getElementById('da-status-text');
        if (el) el.textContent = text;
    }

    function updateProgressBar(percent) {
        const fill = document.getElementById('da-progress-fill');
        if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }

    function showProgressBar(show) {
        const wrap = document.getElementById('da-progress-wrap');
        if (wrap) {
            if (show) wrap.classList.add('da-show');
            else wrap.classList.remove('da-show');
        }
    }

    function setButtonsDisabled(disabled) {
        const ids = ['da-export-json-btn', 'da-export-excel-btn', 'da-sync-btn', 'da-start-btn'];
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = disabled;
        });

        // 禁用任务选择
        const taskItems = document.querySelectorAll('.da-task-item');
        taskItems.forEach(item => {
            if (disabled) item.classList.add('disabled');
            else item.classList.remove('disabled');
        });

        const startBtn = document.getElementById('da-start-btn');
        const stopBtn = document.getElementById('da-stop-btn');
        if (disabled) {
            if (startBtn) startBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'flex';
        } else {
            if (startBtn) startBtn.style.display = 'flex';
            if (stopBtn) stopBtn.style.display = 'none';
        }
    }

    function updateDataCount() {
        const el = document.getElementById('da-data-count');
        if (el) {
            const data = loadData();
            el.textContent = data.length > 0 ? `已有 ${data.length} 条` : '';
        }
    }

    function getSelectedTasks() {
        const tasks = [];
        const selectedItems = document.querySelectorAll('.da-task-item.selected');
        selectedItems.forEach(item => {
            if (!item.classList.contains('disabled')) {
                tasks.push({
                    mediaType: item.dataset.media,
                    markStatus: item.dataset.status,
                });
            }
        });
        return tasks;
    }

    // ========================================================================
    // 事件绑定
    // ========================================================================

    // 悬浮按钮点击
    floatBtn.addEventListener('click', () => {
        panel.classList.toggle('da-show');
        // 保存面板状态
        setPanelOpen(panel.classList.contains('da-show'));
        if (panel.classList.contains('da-show')) {
            updateDataCount();
            // 检查是否有断点续传数据
            const progress = loadProgress();
            const status = getStatus();
            if ((status === 'scraping' || status === 'pending_jump') && progress) {
                const taskName = `${MEDIA_TYPE_NAMES[progress.mediaType]}-${MARK_STATUS_NAMES[progress.mediaType][progress.markStatus]}`;
                if (progress.scraped > 0) {
                    updateStatusText(`有未完成的采集任务（${taskName}，已采 ${progress.scraped} 条），点击"开始全量抓取"继续`);
                } else {
                    updateStatusText(`有未完成的采集任务（${taskName}），点击"开始全量抓取"继续`);
                }
            } else if (status === 'done') {
                const data = loadData();
                updateStatusText(`上次采集已完成，共 ${data.length} 条数据`);
            }
        }
    });

    // 关闭按钮
    document.getElementById('da-close-btn').addEventListener('click', () => {
        panel.classList.remove('da-show');
        setPanelOpen(false);
    });

    // 任务选择点击
    document.getElementById('da-task-grid').addEventListener('click', (e) => {
        const taskItem = e.target.closest('.da-task-item');
        if (!taskItem || taskItem.classList.contains('disabled')) return;
        taskItem.classList.toggle('selected');
    });

    // 开始采集
    document.getElementById('da-start-btn').addEventListener('click', () => {
        // 获取最大翻页数
        const maxPagesInput = document.getElementById('da-max-pages');
        let maxPages = parseInt(maxPagesInput.value);
        if (isNaN(maxPages) || maxPagesInput.value.trim() === '') {
            maxPages = 999; // 空值表示全量抓取
        }
        maxPages = Math.max(1, Math.min(999, maxPages));

        const tasks = getSelectedTasks();
        if (tasks.length === 0) {
            // 如果没有选择任务，检查是否有未完成的任务
            const progress = loadProgress();
            const status = getStatus();
            if ((status === 'scraping' || status === 'pending_jump') && progress) {
                // 继续未完成的采集
                startScrapeTask(progress.mediaType, progress.markStatus, maxPages);
            } else {
                updateStatusText('请先选择采集目标');
            }
            return;
        }
        startBatchScrape(tasks, maxPages);
    });

    // 停止采集
    document.getElementById('da-stop-btn').addEventListener('click', () => {
        stopScrape();
    });

    // 导出 JSON
    document.getElementById('da-export-json-btn').addEventListener('click', () => {
        exportJSON();
    });

    // 导出 Excel
    document.getElementById('da-export-excel-btn').addEventListener('click', () => {
        exportExcel();
    });

    // 同步后端
    document.getElementById('da-sync-btn').addEventListener('click', () => {
        syncToBackend();
    });

    // 清空数据
    document.getElementById('da-clear-btn').addEventListener('click', () => {
        clearAllData();
    });

    // ========================================================================
    // 面板拖拽
    // ========================================================================

    (function initDrag() {
        const dragHandle = document.getElementById('da-drag-handle');
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        dragHandle.addEventListener('mousedown', (e) => {
            if (e.target.id === 'da-close-btn') return;
            isDragging = true;

            const rect = panel.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;

            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = startLeft + 'px';
            panel.style.top = startTop + 'px';

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = (startLeft + dx) + 'px';
            panel.style.top = (startTop + dy) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    })();

    // ========================================================================
    // 初始化 - 恢复状态，在目标页面自动继续采集
    // ========================================================================

    (function init() {
        console.log('[DouArchive] 油猴脚本已加载 v2.5.0');
        console.log(`[DouArchive] 页面类型：${detectMediaType()}，标记状态：${detectMarkStatus()}`);
        console.log(`[DouArchive] 可采集页面：${isScrapeablePage()}`);

        // 恢复面板状态（从 GM 存储读取，跨域共享）
        if (getPanelOpen()) {
            panel.classList.add('da-show');
            updateDataCount();
        }

        // 恢复选中的任务状态（从 GM 存储读取）
        const selectedMedia = getSelectedMedia();
        const selectedStatus = getSelectedStatus();
        if (selectedMedia && selectedStatus) {
            // 恢复任务选择高亮
            const taskItems = document.querySelectorAll('.da-task-item');
            taskItems.forEach(item => {
                if (item.dataset.media === selectedMedia && item.dataset.status === selectedStatus) {
                    item.classList.add('selected');
                }
            });
        }

        // 恢复最大翻页数到输入框
        const savedMaxPagesValue = getMaxPages();
        const maxPagesInput = document.getElementById('da-max-pages');
        if (maxPagesInput) {
            maxPagesInput.value = savedMaxPagesValue;
        }

        // 检查是否有未完成的采集任务
        const status = getStatus();
        const progress = loadProgress();

        console.log(`[DouArchive] 状态: ${status}, 进度:`, progress);

        if (progress && (status === 'scraping' || status === 'pending_jump')) {
            const currentMedia = detectMediaType();
            const currentStatus = detectMarkStatus();

            // 恢复最大翻页数到输入框（优先使用 progress 中保存的值）
            if (progress.maxPages) {
                setMaxPages(progress.maxPages);
                if (maxPagesInput) {
                    maxPagesInput.value = progress.maxPages;
                }
            }

            // 在正确的页面，自动继续采集
            if (currentMedia === progress.mediaType && currentStatus === progress.markStatus && isScrapeablePage()) {
                console.log('[DouArchive] 在目标页面，自动继续采集...');
                panel.classList.add('da-show');
                setPanelOpen(true);

                // 自动开始采集
                if (progress.autoStart || status === 'pending_jump') {
                    updateStatusText(`正在自动开始采集 ${MEDIA_TYPE_NAMES[progress.mediaType]}-${MARK_STATUS_NAMES[progress.mediaType][progress.markStatus]}...`);
                    setStatus('scraping');

                    setTimeout(() => {
                        performScrape(progress.mediaType, progress.markStatus);
                    }, 800); // 给页面更多加载时间
                }
            } else {
                // 不在目标页面，显示提示
                console.log('[DouArchive] 检测到未完成任务，但不在目标页面');
                panel.classList.add('da-show');
                setPanelOpen(true);

                const taskName = `${MEDIA_TYPE_NAMES[progress.mediaType]}-${MARK_STATUS_NAMES[progress.mediaType][progress.markStatus]}`;
                if (progress.scraped > 0) {
                    updateStatusText(`有未完成的采集任务（${taskName}，已采 ${progress.scraped} 条），点击"开始全量抓取"继续`);
                } else {
                    updateStatusText(`有未完成的采集任务（${taskName}），点击"开始全量抓取"继续`);
                }
                // 设置为 scraping，让用户点击按钮时可以继续
                setStatus('scraping');
            }
        } else if (status === 'scraping' && !progress) {
            // 状态异常，重置
            setStatus('idle');
        }

        const data = loadData();
        if (data.length > 0) {
            console.log(`[DouArchive] 本地已有 ${data.length} 条数据`);
        }
    })();

})();

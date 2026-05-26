/**
 * 豆藏 DouArchive - 前端应用
 * Vue3 Options API + ECharts
 */

const { createApp, ref, computed, onMounted, watch, nextTick } = Vue;

const API_BASE = 'http://127.0.0.1:18080';

const app = createApp({
    setup() {
        // ============================
        // 路由
        // ============================
        const route = ref('/');
        const hash = () => {
            const h = location.hash.slice(1) || '/';
            return h;
        };
        window.addEventListener('hashchange', () => {
            route.value = hash();
        });

        // ============================
        // 状态
        // ============================
        const healthOk = ref(false);
        const globalLoading = ref(false);

        // ============================
        // 总览数据
        // ============================
        const overview = ref({});
        const recentItems = ref([]);

        // ============================
        // 媒体列表
        // ============================
        const mediaItems = ref([]);
        const mediaTotal = ref(0);
        const page = ref(1);
        const pageSize = 30;
        const filters = ref({
            mark_status: '',
            sort: 'mark_time',
            order: 'desc',
            keyword: ''
        });
        const selectedIds = ref(new Set());
        const showDeleteModal = ref(false);
        const deleteTarget = ref(null);

        // ============================
        // 统计
        // ============================
        const statsType = ref('');
        const chartInstances = {};

        // ============================
        // AI
        // ============================
        const aiPromptType = ref('preference');
        const aiMediaType = ref('');
        const aiCustomPrompt = ref('');
        const aiLoading = ref(false);
        const aiResult = ref(null);
        const aiParsedData = ref(null);
        const reports = ref([]);

        // ============================
        // 配置
        // ============================
        const config = ref({});

        // ============================
        // 计算属性
        // ============================
        const mediaType = computed(() => {
            if (route.value === '/movies') return 'movie';
            if (route.value === '/books') return 'book';
            if (route.value === '/music') return 'music';
            return '';
        });

        const pageTitle = computed(() => {
            const titles = {
                '/': '数据总览',
                '/movies': '电影',
                '/books': '读书',
                '/music': '音乐',
                '/stats': '统计分析',
                '/ai': 'AI 分析',
                '/settings': '设置'
            };
            return titles[route.value] || '豆藏';
        });

        // ============================
        // API 调用方法
        // ============================
        const api = async (url, options = {}, hideLoading = false) => {
            if (!hideLoading) globalLoading.value = true;
            try {
                const resp = await fetch(API_BASE + url, {
                    headers: { 'Content-Type': 'application/json' },
                    ...options
                });
                return await resp.json();
            } catch (e) {
                console.error('[API Error]', url, e);
                return { code: -1, message: e.message, data: null };
            } finally {
                if (!hideLoading) globalLoading.value = false;
            }
        };

        const checkHealth = async () => {
            try {
                const r = await api('/api/system/health', {}, true);
                healthOk.value = r.data?.status === 'ok';
            } catch {
                healthOk.value = false;
            }
        };

        // ============================
        // Dashboard
        // ============================
        const loadOverview = async () => {
            const r = await api('/api/stats/overview');
            if (r.code === 0) {
                overview.value = r.data || {};
            }
        };

        const loadRecent = async () => {
            const r = await api('/api/media?sort=mark_time&order=desc&page_size=10');
            if (r.code === 0) {
                recentItems.value = r.data?.items || [];
            }
        };

        const loadDashboardCharts = async () => {
            const year = new Date().getFullYear();
            const [yearR, scoreR, dayR] = await Promise.all([
                api('/api/stats/by-year'),
                api('/api/stats/by-score'),
                api('/api/stats/by-day?year=' + year)
            ]);
            await nextTick();
            renderChart('dashYearChart', buildYearOption(yearR.data || []));
            renderChart('dashScoreChart', buildScoreOption(scoreR.data || []));
            renderChart('dashHeatmapChart', buildHeatmapOption(dayR.data || [], year));
        };

        // ============================
        // 媒体列表
        // ============================
        const loadMedia = async () => {
            const params = new URLSearchParams({
                page: String(page.value),
                page_size: String(pageSize),
                sort: filters.value.sort,
                order: filters.value.order
            });
            if (mediaType.value) {
                params.set('media_type', mediaType.value);
            }
            if (filters.value.mark_status) {
                params.set('mark_status', filters.value.mark_status);
            }
            if (filters.value.keyword) {
                params.set('keyword', filters.value.keyword);
            }
            const r = await api('/api/media?' + params.toString());
            if (r.code === 0) {
                mediaItems.value = r.data?.items || [];
                mediaTotal.value = r.data?.total || 0;
                selectedIds.value = new Set();
            }
        };

        const changePage = (p) => {
            if (p < 1) return;
            page.value = p;
            loadMedia();
        };

        const filterByTag = (tag) => {
            filters.value.keyword = tag;
            page.value = 1;
            loadMedia();
        };

        // ============================
        // 删除功能
        // ============================
        const toggleSelect = (id) => {
            const s = new Set(selectedIds.value);
            if (s.has(id)) s.delete(id); else s.add(id);
            selectedIds.value = s;
        };

        const isAllSelected = computed(() =>
            mediaItems.value.length > 0 && mediaItems.value.every(i => selectedIds.value.has(i.id))
        );

        const toggleSelectAll = () => {
            if (isAllSelected.value) {
                selectedIds.value = new Set();
            } else {
                selectedIds.value = new Set(mediaItems.value.map(i => i.id));
            }
        };

        const deleteMedia = (item) => {
            deleteTarget.value = item;
            showDeleteModal.value = true;
        };

        const batchDeleteMedia = () => {
            deleteTarget.value = null;
            showDeleteModal.value = true;
        };

        const confirmDelete = async () => {
            showDeleteModal.value = false;
            if (deleteTarget.value) {
                // 单条删除
                const r = await api('/api/media/' + deleteTarget.value.id, { method: 'DELETE' });
                if (r.code === 0) {
                    const s = new Set(selectedIds.value);
                    s.delete(deleteTarget.value.id);
                    selectedIds.value = s;
                } else {
                    alert('删除失败: ' + (r.message || '未知错误'));
                }
            } else if (selectedIds.value.size > 0) {
                // 批量删除
                const r = await api('/api/media/batch-delete', {
                    method: 'POST',
                    body: JSON.stringify({ ids: Array.from(selectedIds.value) })
                });
                if (r.code === 0) {
                    selectedIds.value = new Set();
                } else {
                    alert('批量删除失败: ' + (r.message || '未知错误'));
                }
            }
            deleteTarget.value = null;
            loadMedia();
            loadOverview();
        };

        const cancelDelete = () => {
            showDeleteModal.value = false;
            deleteTarget.value = null;
        };

        // ============================
        // 统计图表
        // ============================
        const loadStats = async () => {
            await nextTick();
            const mt = statsType.value || undefined;
            const suffix = mt ? `?media_type=${mt}` : '';

            const [yearR, scoreR, monthR, tagR, creatorR] = await Promise.all([
                api('/api/stats/by-year' + suffix),
                api('/api/stats/by-score' + suffix),
                api('/api/stats/by-month' + suffix),
                api('/api/stats/by-tag' + suffix),
                api('/api/stats/by-creator' + suffix)
            ]);

            renderChart('yearChart', buildYearOption(yearR.data || []));
            renderChart('scoreChart', buildScoreOption(scoreR.data || []));
            renderChart('monthChart', buildMonthOption(monthR.data || []));
            renderChart('tagChart', buildTagOption(tagR.data || []));
            renderChart('creatorChart', buildCreatorOption(creatorR.data || []));
        };

        // ============================
        // ECharts 工具函数
        // ============================
        const renderChart = (id, option) => {
            const el = document.getElementById(id);
            if (!el) return;

            // 销毁旧实例
            if (chartInstances[id]) {
                chartInstances[id].dispose();
            }

            const chart = echarts.init(el);
            chartInstances[id] = chart;
            chart.setOption(option);

            // 图表点击联动过滤
            chart.on('click', (params) => {
                if (['tagChart', 'creatorChart'].includes(id)) {
                    filters.value.keyword = params.name;
                    goTo('/movies'); // 默认跳转到列表页进行搜索
                } else if (['yearChart', 'dashYearChart'].includes(id)) {
                    filters.value.keyword = params.name;
                    goTo('/movies');
                } else if (['scoreChart', 'dashScoreChart'].includes(id)) {
                    // params.name 类似 "4星"
                    // 这里可以扩展按评分过滤，目前用 keyword 替代
                }
            });

            // 响应式调整
            const resizeHandler = () => chart.resize();
            window.addEventListener('resize', resizeHandler);
        };

        const buildYearOption = (data) => ({
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' }
            },
            legend: {
                data: ['数量', '平均评分'],
                top: 0
            },
            xAxis: {
                type: 'category',
                data: data.map(d => d.year),
                axisLabel: { rotate: 0 }
            },
            yAxis: [
                { type: 'value', name: '数量', position: 'left' },
                { type: 'value', name: '评分', position: 'right', min: 0, max: 5 }
            ],
            series: [
                {
                    name: '数量',
                    type: 'bar',
                    data: data.map(d => d.count),
                    itemStyle: { color: '#3eaf7c', borderRadius: [4, 4, 0, 0] },
                    barMaxWidth: 40
                },
                {
                    name: '平均评分',
                    type: 'line',
                    yAxisIndex: 1,
                    data: data.map(d => d.avg_score),
                    itemStyle: { color: '#f39c12' },
                    lineStyle: { width: 2 },
                    smooth: true
                }
            ],
            grid: { left: 50, right: 60, bottom: 30, top: 40 }
        });

        const buildScoreOption = (data) => ({
            tooltip: {
                trigger: 'item',
                formatter: '{b}: {c} ({d}%)'
            },
            series: [{
                type: 'pie',
                radius: ['40%', '70%'],
                center: ['50%', '55%'],
                data: data.map(d => ({
                    name: d.score_level + '星',
                    value: d.count
                })),
                label: {
                    formatter: '{b}: {c} ({d}%)',
                    fontSize: 13
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowOffsetX: 0,
                        shadowColor: 'rgba(0, 0, 0, 0.2)'
                    }
                },
                itemStyle: {
                    color: (p) => {
                        const colors = ['#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#3eaf7c'];
                        return colors[p.dataIndex] || '#999';
                    }
                }
            }]
        });

        const buildMonthOption = (data) => ({
            tooltip: {
                trigger: 'axis'
            },
            xAxis: {
                type: 'category',
                data: data.map(d => d.month),
                axisLabel: { rotate: 45 }
            },
            yAxis: {
                type: 'value',
                name: '数量'
            },
            series: [{
                name: '数量',
                type: 'line',
                data: data.map(d => d.count),
                smooth: true,
                areaStyle: {
                    opacity: 0.15,
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: '#3eaf7c' },
                        { offset: 1, color: 'rgba(62, 175, 124, 0.02)' }
                    ])
                },
                itemStyle: { color: '#3eaf7c' },
                lineStyle: { width: 2 }
            }],
            grid: { left: 50, right: 20, bottom: 60, top: 30 }
        });

        const buildTagOption = (data) => ({
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' }
            },
            xAxis: {
                type: 'value',
                name: '次数',
                nameGap: 6
            },
            yAxis: {
                type: 'category',
                data: data.map(d => d.tag).reverse(),
                axisLabel: {
                    width: 80,
                    overflow: 'truncate'
                }
            },
            series: [{
                type: 'bar',
                data: data.map(d => d.count).reverse(),
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: '#339268' },
                        { offset: 1, color: '#3eaf7c' }
                    ]),
                    borderRadius: [0, 4, 4, 0]
                },
                barMaxWidth: 24
            }],
            grid: { left: 100, right: 50, bottom: 20, top: 20 }
        });

        const buildCreatorOption = (data) => ({
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' }
            },
            xAxis: {
                type: 'value',
                name: '作品数',
                nameGap: 6
            },
            yAxis: {
                type: 'category',
                data: data.map(d => d.creator).reverse(),
                axisLabel: {
                    width: 100,
                    overflow: 'truncate'
                }
            },
            series: [{
                name: '作品数',
                type: 'bar',
                data: data.map(d => d.count).reverse(),
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: '#339268' },
                        { offset: 1, color: '#3eaf7c' }
                    ]),
                    borderRadius: [0, 4, 4, 0]
                },
                barMaxWidth: 24
            }],
            grid: { left: 120, right: 50, bottom: 20, top: 20 }
        });

        const buildHeatmapOption = (data, year) => {
            const chartData = data.map(item => [item.date, item.count]);
            return {
                tooltip: {
                    position: 'top',
                    formatter: function (p) {
                        return p.data[0] + ': ' + p.data[1] + ' 个标记';
                    }
                },
                visualMap: {
                    min: 1,
                    max: 10,
                    type: 'piecewise',
                    orient: 'horizontal',
                    left: 'center',
                    bottom: 0,
                    pieces: [
                        {min: 10, label: '>=10'},
                        {min: 5, max: 9, label: '5-9'},
                        {min: 2, max: 4, label: '2-4'},
                        {min: 1, max: 1, label: '1'}
                    ],
                    inRange: {
                        color: ['#9be9a8', '#40c463', '#30a14e', '#216e39']
                    }
                },
                calendar: {
                    top: 20,
                    left: 40,
                    right: 40,
                    cellSize: ['auto', 14],
                    range: year,
                    itemStyle: {
                        color: '#ebedf0',
                        borderWidth: 3,
                        borderColor: '#fff'
                    },
                    splitLine: { show: false },
                    yearLabel: { show: false },
                    dayLabel: { nameMap: 'ZH', fontSize: 10, color: '#999' },
                    monthLabel: { nameMap: 'ZH', fontSize: 10, color: '#999' }
                },
                series: {
                    type: 'heatmap',
                    coordinateSystem: 'calendar',
                    data: chartData
                }
            };
        };

        // ============================
        // AI 分析
        // ============================
        
        const renderRadarChart = (radarData) => {
            if (!radarData) return;
            const el = document.getElementById('aiRadarChart');
            if (!el) return;
            
            const chart = echarts.init(el);
            const indicators = Object.keys(radarData).map(k => ({ name: k, max: 100 }));
            const values = Object.values(radarData);
            
            const option = {
                radar: {
                    indicator: indicators,
                    shape: 'circle',
                    splitNumber: 4,
                    axisName: { color: '#339268', fontSize: 13, fontWeight: 'bold' },
                    splitLine: { lineStyle: { color: 'rgba(62, 175, 124, 0.2)' } },
                    splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(62, 175, 124, 0.05)'] } },
                    axisLine: { lineStyle: { color: 'rgba(62, 175, 124, 0.2)' } }
                },
                series: [{
                    type: 'radar',
                    data: [{
                        value: values,
                        name: '偏好维度',
                        itemStyle: { color: '#3eaf7c' },
                        areaStyle: { color: 'rgba(62, 175, 124, 0.3)' }
                    }]
                }]
            };
            chart.setOption(option);
            window.addEventListener('resize', () => chart.resize());
        };

        const runAIAnalysis = async () => {
            aiLoading.value = true;
            try {
                const body = {
                    prompt_type: aiPromptType.value
                };
                if (aiMediaType.value) {
                    body.media_type = aiMediaType.value;
                }
                if (aiPromptType.value === 'custom' && aiCustomPrompt.value) {
                    body.custom_prompt = aiCustomPrompt.value;
                }

                const r = await api('/api/ai/analyze', {
                    method: 'POST',
                    body: JSON.stringify(body)
                }, true);

                if (r.code === 0 && r.data) {
                    aiResult.value = r.data;
                    try {
                        aiParsedData.value = JSON.parse(r.data.content);
                        nextTick(() => {
                            if (aiParsedData.value.radar_data) {
                                renderRadarChart(aiParsedData.value.radar_data);
                            }
                        });
                    } catch (err) {
                        aiParsedData.value = null; // 降级为文本渲染
                    }
                    loadReports();
                } else {
                    alert(r.message || '分析失败，请检查 AI 配置');
                }
            } catch (e) {
                alert('请求失败: ' + e.message);
            } finally {
                aiLoading.value = false;
            }
        };

        const loadReports = async () => {
            const r = await api('/api/ai/reports');
            if (r.code === 0) {
                reports.value = r.data || [];
            }
        };

        const loadReport = async (id) => {
            const r = await api('/api/ai/reports/' + id);
            if (r.code === 0) {
                aiResult.value = r.data;
                try {
                    aiParsedData.value = JSON.parse(r.data.content);
                    nextTick(() => {
                        if (aiParsedData.value.radar_data) {
                            renderRadarChart(aiParsedData.value.radar_data);
                        }
                    });
                } catch (err) {
                    aiParsedData.value = null;
                }
            }
        };

        // 简单 Markdown 渲染
        const renderMarkdown = (text) => {
            if (!text) return '';

            let html = text;

            // 转义 HTML 特殊字符
            html = html
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // 标题
            html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
            html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
            html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

            // 粗体和斜体
            html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

            // 行内代码
            html = html.replace(/`(.+?)`/g, '<code>$1</code>');

            // 引用块
            html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

            // 水平线
            html = html.replace(/^---$/gm, '<hr>');

            // 列表项
            html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
            html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');

            // 合并连续列表项
            html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
                return '<ul>' + match + '</ul>';
            });

            // 表格（简单支持）
            html = html.replace(/\|(.+)\|/g, (match) => {
                const cells = match.split('|').filter(c => c.trim());
                if (cells.every(c => /^[\s-]+$/.test(c))) {
                    return ''; // 分隔行
                }
                const isHeader = false;
                const tag = isHeader ? 'th' : 'td';
                const row = cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('');
                return `<tr>${row}</tr>`;
            });

            // 段落
            html = html.replace(/\n{2,}/g, '</p><p>');
            html = html.replace(/\n/g, '<br>');

            // 包裹在段落中
            if (!html.startsWith('<')) {
                html = '<p>' + html + '</p>';
            }

            return html;
        };

        const exportReport = () => {
            if (!aiResult.value) return;
            const blob = new Blob([aiResult.value.content], { type: 'text/markdown;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `douarchive-report-${aiResult.value.report_id || Date.now()}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        };

        // ============================
        // 配置管理
        // ============================
        const loadConfig = async () => {
            const r = await api('/api/config');
            if (r.code === 0) {
                config.value = r.data || {};
            }
        };

        const saveConfig = async () => {
            const r = await api('/api/config', {
                method: 'PUT',
                body: JSON.stringify(config.value)
            });
            if (r.code === 0) {
                alert('配置已保存');
            } else {
                alert('保存失败: ' + (r.message || '未知错误'));
            }
        };

        const exportAllData = (format) => {
            window.open(`${API_BASE}/api/export?format=${format}`, '_blank');
        };

        // ============================
        // 导航
        // ============================
        const goTo = (path) => {
            location.hash = '#' + path;
        };

        // ============================
        // 工具函数
        // ============================
        const typeLabel = (t) => {
            const map = { movie: '影', book: '书', music: '乐' };
            return map[t] || t;
        };

        const statusLabel = (s) => {
            const map = {
                wish: '想看',
                do: '在看',
                collect: '看过'
            };
            return map[s] || s;
        };

        const parseTags = (tags) => {
            if (!tags) return [];
            if (Array.isArray(tags)) return tags;
            if (typeof tags === 'string') {
                // 逗号分隔或空格分隔
                return tags.split(/[,，\s]+/).filter(t => t.trim());
            }
            return [];
        };

        // ============================
        // 路由变化监听
        // ============================
        watch(route, (val) => {
            page.value = 1;
            filters.value.keyword = '';

            if (val === '/') {
                loadOverview();
                loadRecent();
                nextTick(() => loadDashboardCharts());
            } else if (['/movies', '/books', '/music'].includes(val)) {
                filters.value.mark_status = '';
                loadMedia();
            } else if (val === '/stats') {
                loadStats();
            } else if (val === '/ai') {
                loadReports();
            } else if (val === '/settings') {
                loadConfig();
            }
        });

        // ============================
        // 初始化
        // ============================
        onMounted(() => {
            route.value = hash();
            checkHealth();

            // 定时检查后端健康状态
            setInterval(checkHealth, 30000);

            // 触发初始路由加载
            const initialRoute = route.value;
            if (initialRoute === '/') {
                loadOverview();
                loadRecent();
                nextTick(() => loadDashboardCharts());
            } else if (['/movies', '/books', '/music'].includes(initialRoute)) {
                loadMedia();
            } else if (initialRoute === '/stats') {
                loadStats();
            } else if (initialRoute === '/ai') {
                loadReports();
            } else if (initialRoute === '/settings') {
                loadConfig();
            }
        });

        // ============================
        // 返回模板所需的所有数据和方法
        // ============================
        return {
            // 路由与状态
            route,
            healthOk,
            globalLoading,
            pageTitle,

            // 总览
            overview,
            recentItems,

            // 媒体列表
            mediaType,
            mediaItems,
            mediaTotal,
            page,
            pageSize,
            filters,
            loadMedia,
            changePage,
            filterByTag,
            parseTags,

            // 删除
            selectedIds,
            showDeleteModal,
            deleteTarget,
            toggleSelect,
            isAllSelected,
            toggleSelectAll,
            deleteMedia,
            batchDeleteMedia,
            confirmDelete,
            cancelDelete,

            // 统计
            statsType,
            loadStats,

            // AI
            aiPromptType,
            aiMediaType,
            aiCustomPrompt,
            aiLoading,
            aiResult,
            aiParsedData,
            reports,
            runAIAnalysis,
            loadReport,
            renderMarkdown,
            exportReport,

            // 配置
            config,
            saveConfig,
            exportAllData,

            // 工具
            goTo,
            typeLabel,
            statusLabel
        };
    }
});

app.mount('#app');

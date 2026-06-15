// js/i18n.js
// ---------------------------------------------------------------
// Lightweight vanilla i18n for WC 2026 · AI 预测
//   - Two locales: zh-CN (default) and en-US
//   - Persistence: ?lang= URL param > localStorage > browser > default
//   - API: t(key, params?), getLocale(), setLocale(locale), applyI18n(root?)
//   - DOM hooks: [data-i18n] for textContent, [data-i18n-attr="k:v"] for attributes
//   - On switch: setLocale() updates storage + URL, then reloads the page
//     (simplest, matches the URL-persistence model)
// ---------------------------------------------------------------

export const LOCALES = ['zh-CN', 'en-US'];
export const DEFAULT_LOCALE = 'zh-CN';
const STORAGE_KEY = 'wc2026.locale';
const URL_PARAM = 'lang';

// ---------- Dictionary ----------
const ZH = {
  // 通用
  'common.all': '全部',
  'common.reset': '重置',
  'common.finished': '已结束',
  'common.scheduled': '未开赛',
  'common.pending': '待开赛',
  'common.vs': 'vs',
  'common.penalty': '点球',
  'common.og': '乌龙',
  'common.penalties': '点球大战',
  'common.qualify': '晋级',
  'common.eliminated': '出局',
  'common.filter': '筛选',
  'common.loading': '加载中…',
  'common.empty': '暂无数据',
  'common.refresh': '刷新',
  'common.scoreHit': '比分命中',
  'common.winnerHit': '胜负命中',
  'common.miss': '未中',
  'common.noPrediction': '无预测',
  'common.wentToPenalties': '点球大战',
  'common.backToPredictions': '← 返回 AI 预测总览',

  // 顶部导航
  'nav.home': '首页',
  'nav.schedule': '赛程',
  'nav.standings': '积分榜',
  'nav.results': '比分',
  'nav.predictions': 'AI 预测',
  'nav.stats': '统计',
  'nav.teams': '球队',
  'nav.bets': '足彩模拟',
  'nav.about': '关于',
  'nav.contact': '联系',
  'nav.fifa': 'FIFA 官网',

  // 页脚
  'footer.siteName': 'WC 2026 · AI 预测',
  'footer.tagline': '一个静态站点：聚合 2026 美加墨世界杯赛程 + 我的 AI 大模型预测。',
  'footer.tagline2': '每场比赛结束后，比分与命中情况会被更新到本站。',
  'footer.quickLinks': '快速链接',
  'footer.dataSources': '数据来源',
  'footer.sourceSchedule': '赛程：FIFA 2026 官方',
  'footer.sourceResults': '比分：现场更新',
  'footer.copyright': '© 2026 WC 2026 AI 预测 · 非商业项目',
  'footer.disclaimer': '本页所有 AI 预测内容仅代表大模型当时输出，不代表事实',
  'footer.beianIc': '🛡',
  'footer.beianGongan': '⚠️',

  // 星期
  'day.sun': '周日',
  'day.mon': '周一',
  'day.tue': '周二',
  'day.wed': '周三',
  'day.thu': '周四',
  'day.fri': '周五',
  'day.sat': '周六',

  // 月份 (用于"X 月 X 日"格式)
  'month.1': '1 月', 'month.2': '2 月', 'month.3': '3 月',
  'month.4': '4 月', 'month.5': '5 月', 'month.6': '6 月',
  'month.7': '7 月', 'month.8': '8 月', 'month.9': '9 月',
  'month.10': '10 月', 'month.11': '11 月', 'month.12': '12 月',

  // 阶段
  'stage.group': '小组赛',
  'stage.r32': '1/16 决赛',
  'stage.r16': '1/8 决赛',
  'stage.qf': '1/4 决赛',
  'stage.sf': '半决赛',
  'stage.third': '三四名决赛',
  'stage.final': '决赛',
  'stage.groupShort': '组',

  // 足联
  'conf.UEFA': 'UEFA (欧洲)',
  'conf.CONMEBOL': 'CONMEBOL (南美)',
  'conf.CONCACAF': 'CONCACAF (北美)',
  'conf.AFC': 'AFC (亚洲)',
  'conf.CAF': 'CAF (非洲)',
  'conf.OFC': 'OFC (大洋洲)',

  // 命中标签
  'hit.score': '✅ 比分命中',
  'hit.winner': '⚠️ 胜负命中',
  'hit.miss': '❌ 未中',
  'hit.pending': '待开赛',
  'hit.noPrediction': '无预测',

  // 倒计时
  'countdown.title': '距下场比赛',
  'countdown.day': '天',
  'countdown.hour': '时',
  'countdown.minute': '分',
  'countdown.second': '秒',
  'countdown.allOver': '所有比赛均已结束',

  // 相对时间
  'time.future': '还有 ',
  'time.past': '已过 ',
  'time.day': ' 天',
  'time.hour': ' 小时',
  'time.minute': ' 分',

  // 首页
  'home.hero.badge': '🏆 2026 美加墨世界杯',
  'home.hero.title1': 'AI 大模型，',
  'home.hero.title2': '押得准吗？',
  'home.hero.title3': '让数据说话',
  'home.hero.body': '48 支球队 · 104 场比赛 · 12 个小组。我把每场比赛前问 GPT、Claude、Gemini、DeepSeek 等大模型预测结果录入，赛后更新比分 + 命中情况。',
  'home.hero.cta1': '查看赛程 →',
  'home.hero.cta2': '⭐ AI 预测',
  'home.hero.cta3': '准确率榜',
  'home.today.kicker': 'Today',
  'home.today.title': '今日 / 即将开赛',
  'home.today.more': '完整赛程 →',
  'home.today.empty': '暂无即将开赛的比赛',
  'home.ai.kicker': 'AI Predictions',
  'home.ai.title': '⭐ AI 预测速览',
  'home.ai.more': '查看全部 →',
  'home.ai.empty': '暂无 AI 预测记录',
  'home.ai.finished': '已结束',
  'home.ai.pending': '待开赛',
  'home.cards.schedule.title': '完整赛程',
  'home.cards.schedule.desc': '104 场，按日期/小组/阶段筛选',
  'home.cards.standings.title': '积分榜',
  'home.cards.standings.desc': '12 组，每组前 2 + 8 个最佳第 3',
  'home.cards.predictions.title': 'AI 预测',
  'home.cards.predictions.desc': '多模型对比',
  'home.cards.stats.title': '准确率榜',
  'home.cards.stats.desc': '哪个大模型最会押比分？',

  // 赛程页
  'schedule.kicker': 'Schedule',
  'schedule.title': '完整赛程',
  'schedule.subtitle': '共 104 场 · 小组赛 72 + 淘汰赛 32',
  'schedule.filter.stage': '阶段',
  'schedule.filter.group': '小组',
  'schedule.filter.status': '状态',
  'schedule.filter.team': '球队 (3 字母代码)',
  'schedule.filter.teamPlaceholder': '如 ARG / BRA',
  'schedule.status.finished': '已结束',
  'schedule.status.scheduled': '未开赛',
  'schedule.count': '共 {n} 场',
  'schedule.dayCount': '{n} 场',
  'schedule.empty': '无匹配比赛',
  'schedule.matchCount': '{n} 场',
  'schedule.stage.group': '小组赛',
  'schedule.stage.r32': '32 强',
  'schedule.stage.r16': '16 强',
  'schedule.stage.qf': '8 强',
  'schedule.stage.sf': '半决赛',
  'schedule.stage.third': '三四名',
  'schedule.stage.final': '决赛',
  'schedule.status.finishedShort': '已结束',
  'schedule.status.scheduledShort': '未开赛',
  'schedule.dateFormat': '{m} 月 {d} 日',

  // 积分榜
  'standings.kicker': 'Standings',
  'standings.title': '积分榜',
  'standings.subtitle': '12 组，每组前 2 + 8 个成绩最佳的第 3 名晋级 32 强淘汰赛',
  'standings.empty': '该小组暂无已结束比赛',
  'standings.thirds.title': '8 个最佳第 3 名',
  'standings.thirds.subtitle': 'FIFA 规则：积分 → 净胜球 → 进球 → 公平竞赛分',
  'standings.thirds.empty': '需要更多比赛结束后才能计算',
  'standings.col.team': '球队',
  'standings.col.played': '场',
  'standings.col.win': '胜',
  'standings.col.draw': '平',
  'standings.col.lose': '负',
  'standings.col.gf': '进',
  'standings.col.ga': '失',
  'standings.col.gd': '净',
  'standings.col.pts': '积分',
  'standings.col.status': '状态',
  'standings.col.group': '组',

  // 比赛结果
  'results.kicker': 'Results',
  'results.title': '比赛结果',
  'results.subtitle': '已结束比赛 · 按时间倒序 · 点击进入 AI 预测复盘',
  'results.empty': '暂无已结束比赛，比赛开始后将自动展示',

  // AI 预测总览
  'predictions.kicker': 'AI Predictions',
  'predictions.title': '⭐ AI 预测总览',
  'predictions.subtitle': '每场比赛前，我都会拿同样的 prompt 问几个大模型。这里是它们当时的原始回答 + 实际结果对账。',
  'predictions.filter.label': '筛选：',
  'predictions.filter.all': '全部',
  'predictions.filter.finished': '仅已结束',
  'predictions.filter.pending': '仅待开赛',
  'predictions.filter.hit': '✅ 比分命中',
  'predictions.filter.winner': '⚠️ 胜负命中',
  'predictions.filter.miss': '❌ 未中',
  'predictions.modelFilter.label': '模型：',
  'predictions.dashboard.title': '📊 各模型命中率',
  'predictions.dashboard.empty': '暂无 AI 预测数据',
  'predictions.dashboard.scorePct': '比分命中',
  'predictions.dashboard.winnerPct': '胜负命中',
  'predictions.summary': '共 {n} 条预测',
  'predictions.empty': '无匹配记录',
  'predictions.modelCount': '{n} 个模型预测',
  'predictions.viewDetail': '点击查看每个模型的详细复盘 →',
  'predictions.hit.score': '✅ 比分命中',
  'predictions.hit.winner': '⚠️ 胜负命中',
  'predictions.hit.miss': '❌ 未中',
  'predictions.hit.pending': '待开赛',

  // 统计
  'stats.kicker': 'Stats',
  'stats.title': '统计 & 准确率',
  'stats.subtitle': '所有数据随比赛进行自动更新',
  'stats.card.finished': '已结束比赛',
  'stats.card.predicted': '有 AI 预测的场次',
  'stats.card.totalPreds': '累计 AI 预测条目',
  'stats.card.overall': '综合胜负命中率',
  'stats.chart.accuracy.title': '🤖 AI 模型准确率榜',
  'stats.chart.accuracy.legend': '蓝色 = 比分完全一致；金色 = 胜负方向一致（比分不要求一致）',
  'stats.chart.stages.title': '🎯 各阶段准确率',
  'stats.chart.stages.legend': '小组赛 / 32 强 / 16 强 / 8 强 / 半决赛 / 决赛 各自的命中率',
  'stats.chart.timeline.title': '📈 命中率随比赛进展',
  'stats.chart.timeline.legend': '每场比赛结束后，累计命中率的变化',
  'stats.chart.scorePct': '比分命中 %',
  'stats.chart.winnerPct': '胜负命中 %',
  'stats.chart.timelineSuffix': '（胜负%）',
  'stats.keyMatches.title': '🏆 关键比赛预测回顾',
  'stats.keyMatches.empty': '关键比赛（半决赛 / 三四名 / 决赛）开始后自动展示',
  'stats.error': '页面加载出错：{msg}',

  // 球队
  'teams.kicker': 'Teams',
  'teams.title': '48 支球队',
  'teams.subtitle': '按所属足联筛选 · 包含分组与已赛战绩',
  'teams.filter.label': '足联：',
  'teams.filter.all': '全部',
  'teams.record': '{n} 场 · {w}胜{d}平{l}负',
  'teams.empty': '暂无球队',

  // 足彩模拟
  'bets.kicker': 'Lottery Simulation',
  'bets.disclaimer.title': '本页为「足彩玩法」沙盘推演 / 模拟数据',
  'bets.disclaimer.default': '本页面所有金额、倍数、球队选择、命中结果均为虚构/模拟数据，不构成任何投注建议。竞彩有风险，未满 18 周岁请勿参与。',
  'bets.empty': '暂无投注记录',
  'bets.empty.filtered': '当前筛选下没有匹配的投注单',
  'bets.filter.label': '筛选',
  'bets.filter.all': '全部',
  'bets.filter.won': '仅看中奖',
  'bets.filter.pending': '仅看未结算',
  'bets.filter.lost': '仅看未中',
  'bets.filter.subtotal': '小计',
  'bets.collapse.expand': '展开详情',
  'bets.collapse.collapse': '收起详情',
  'bets.payout.actual': '实返 {n}',
  'bets.payout.net': '净 {n}',
  'bets.budget.title': '💰 投入预算',
  'bets.budget.total': '总上限',
  'bets.budget.spent': '已投入',
  'bets.budget.won': '中奖回吐',
  'bets.budget.wonHint': '已加回剩余',
  'bets.budget.remaining': '剩余',
  'bets.budget.over': '⚠️ 已超支',
  'bets.budget.under': '✓ 在预算内',
  'bets.budget.perUnit': '每倍 {n} 元',
  'bets.budget.percent': '{n}% · 每倍 {unit} 元',
  'bets.type.champion': '🏆 冠军',
  'bets.type.match': '⚽ 比赛',
  'bets.type.group': '🅰️ 小组',
  'bets.type.other': '🎯 其它',
  'bets.group.pending': '待结算',
  'bets.group.won': '中奖',
  'bets.group.lost': '未中',
  'bets.line.win': '中奖',
  'bets.line.lose': '未中',
  'bets.line.pending': '⏳ 待结算',
  'bets.parlay.combo': '串关',
  'bets.parlay.comboLabel': '🎲 过关方式: {n}',
  'bets.parlay.stake': '倍数: {n}',
  'bets.parlay.maxReturn': '最高可能固定奖金: {n}',
  'bets.cost': '投入',
  'bets.picks': '{n} 选号 · {c} 注',
  'bets.tickets': '{n} 票 · {m} 倍',
  'bets.odds': '赔率 {n}',
  'bets.oddsTbd': '赔率待补',
  'bets.oddsAt': '@ {n}',
  'bets.note': '📝 {n}',

  // 比赛详情
  'match.title': '比赛详情',
  'match.aiPredictionsHeading': 'AI 大模型预测',
  'match.noId': '缺少比赛 ID',
  'match.notFound': '未找到该比赛',
  'match.scorers': '⚽ 进球者',
  'match.noPredictions': '这场比赛还没有 AI 预测记录。',
  'match.noPredictionsNote': '开赛前我会拿同样的 prompt 问几个大模型。',
  'match.predicted': '预测比分',
  'match.actual': '实际比分',
  'match.hit': '命中',
  'match.hitScore': '✅ 比分一致',
  'match.hitWinner': '⚠️ 胜负一致',
  'match.miss': '❌ 未中',
  'match.prompt': 'Prompt：',
  'match.modelCount': '（{n} 个模型）',
  'match.predHomeWin': '主胜',
  'match.predAwayWin': '客胜',
  'match.predDraw': '平局',
  'match.penaltyScore': '点球 {h}-{a}',

  // 关于
  'about.kicker': 'About',
  'about.title': '关于这个站点',
  'about.goal.title': '🎯 目的',
  'about.goal.body': '这是一个静态站点，把 2026 美加墨世界杯的赛程、比分，跟我事先问各大 AI 大模型的预测记录放在一起对比。世界杯期间，每场比赛结束后我都会来更新比分和命中情况。',
  'about.experiment.title': '🧪 实验设计',
  'about.experiment.li1': '每场比赛开赛前 24 小时内，用<b>同一个 prompt</b>（见每场 AI 预测页）问几个大模型。',
  'about.experiment.li2': '比赛结束后，更新比分 → 系统自动判定每个模型是 ✅ 比分命中 / ⚠️ 胜负命中 / ❌ 未中。',
  'about.experiment.li3': '所有比赛结束后，统计页会给出每个模型的最终战绩。',
  'about.models.title': '🤖 对比的 AI 模型',
  'about.models.body': '暂定：<b>MiniMax-M3</b>、<b>Claude Opus 4.8</b>、<b>GPT-5 mini</b>、<b>DeepSeek-V4</b>、<b>Kimi</b>。',
  'about.rules.title': '📊 命中判定规则',
  'about.rules.li1': '<b>比分命中</b>：预测比分 == 实际比分（包括 90 分钟比分，淘汰赛不算加时/点球）',
  'about.rules.li2': '<b>胜负命中</b>：胜平负方向一致，但比分不完全一致',
  'about.rules.li3': '<b>未中</b>：胜平负方向不一致',
  'about.stack.title': '🛠 技术栈',
  'about.stack.li1': 'Vite + 原生 HTML/CSS/JS（多页面）',
  'about.stack.li2': 'Tailwind CSS',
  'about.stack.li3': 'Chart.js（统计页图表）',
  'about.stack.li4': '纯静态、可部署到 GitHub Pages / Vercel / Netlify',
  'about.structure.title': '📁 项目结构',
  'about.bets.title': '🧪 个人足彩模拟',
  'about.bets.body': '另开了一个 <a class="text-ink font-bold hover:text-gold" href="/bets.html">足彩模拟专栏</a>，把「如果按 1000 元预算、每倍 2 元玩世界杯冠军，会怎么选、怎么结算」做成纯虚构的<a class="text-ink font-bold hover:text-gold" href="/bets.html">沙盘推演</a>。<b>所有金额、倍数、选项、命中结果均为站长编造的模拟数据</b>，与任何真实投注无关。',
  'about.disclaimer.title': '⚠️ 免责声明',
  'about.disclaimer.body': '本站所有 AI 预测内容仅代表大模型当时的输出，不代表任何事实或建议。比分和 AI 预测由我手动录入，请勿用作任何决策依据。「个人足彩模拟」专栏为<b>虚构/沙盘推演</b>，所有数据均为站长编造，<b>不构成任何投注建议</b>；本站不鼓励、不引导任何形式的博彩行为；竞彩有风险，未满 18 周岁请勿参与。',

  // 冠军预测
  'champion.title': '🏆 AI 冠亚军预测',
  'champion.consensus': '📌 <b>多数票：</b><b>{name}</b> 出现 <b>{count}</b> 次（🥇{top} / 🥈{runner}），是最大公约数；冠军归属则出现 {race}。比赛结束后本站会按实际结果更新命中情况。',
  'champion.consensusRace3': '{a} / {b} / {c} 三足鼎立',
  'champion.gold': '🥇 冠军',
  'champion.silver': '🥈 亚军',
  'champion.author': '本站作者使用',

  // 联系
  'contact.kicker': 'Contact',
  'contact.title': '📬 联系我',
  'contact.subtitle': '对站点有建议、发现了 bug、想聊 AI 大模型押比赛，或者单纯想说点什么 —— 欢迎留言。我会看到每一封。',
  'contact.form.name': '姓名',
  'contact.form.namePlaceholder': '你的名字',
  'contact.form.email': '邮箱',
  'contact.form.emailPlaceholder': 'you@example.com',
  'contact.form.message': '留言',
  'contact.form.messagePlaceholder': '想聊点什么…',
  'contact.form.messageHint': '至少 10 字 · 不超过 2000 字',
  'contact.form.submit': '发送',
  'contact.form.sending': '发送中…',
  'contact.form.success': '✅ 已收到！我会尽快回复你。',
  'contact.form.error': '❌ 发送失败，请稍后再试或换个网络。',
  'contact.form.errorRequired': '必填',
  'contact.form.errorEmail': '请输入有效的邮箱',
  'contact.form.errorMessage': '留言至少 10 个字',
  'contact.privacy.body': '<b>隐私：</b>留言会通过 Formspree 转发到我的邮箱，不会在本站留底，不会用于营销，不会分享给任何第三方。',

  // 元信息 (title / description)
  'meta.home.title': 'WC 2026 · AI 预测 — 首页',
  'meta.home.description': '2026 美加墨世界杯赛程、AI 大模型预测记录、命中率统计。',
  'meta.schedule.title': '完整赛程 · WC 2026 · AI 预测',
  'meta.schedule.description': '2026 世界杯全部 104 场比赛，支持按日期/小组/阶段/状态筛选。',
  'meta.standings.title': '积分榜 · WC 2026 · AI 预测',
  'meta.standings.description': '2026 世界杯 12 个小组积分榜 + 8 个最佳第 3 名晋级榜。',
  'meta.results.title': '比赛结果 · WC 2026 · AI 预测',
  'meta.results.description': '2026 世界杯已结束比赛的比分 + AI 预测复盘，按时间倒序。',
  'meta.predictions.title': 'AI 预测总览 · WC 2026',
  'meta.predictions.description': '每场比赛前我都会拿同样的 prompt 问几个大模型。这里是它们当时的原始回答 + 实际结果对账。',
  'meta.stats.title': '统计 · WC 2026 · AI 预测',
  'meta.stats.description': 'AI 大模型在 2026 世界杯各阶段命中率统计 + 趋势图。',
  'meta.teams.title': '球队 · WC 2026 · AI 预测',
  'meta.teams.description': '2026 美加墨世界杯全部 48 支球队信息。',
  'meta.bets.title': '足彩模拟 · WC 2026 · AI 预测',
  'meta.bets.description': '2026 世界杯期间个人足彩玩法沙盘推演（虚构/模拟数据），不构成任何投注建议。',
  'meta.about.title': '关于 · WC 2026 · AI 预测',
  'meta.about.description': 'WC 2026 AI 预测站点说明 + 命中判定规则 + 免责声明。',
  'meta.match.title': '比赛详情 · WC 2026 · AI 预测',
  'meta.match.description': '单场比赛详情：实际比分 + 每个 AI 大模型的预测比分。',
  'meta.contact.title': '联系 · WC 2026 · AI 预测',
  'meta.contact.description': '给站长留言：建议、bug、AI 大模型押比赛讨论。',
};

const EN = {
  'common.all': 'All',
  'common.reset': 'Reset',
  'common.finished': 'Finished',
  'common.scheduled': 'Scheduled',
  'common.pending': 'Pending',
  'common.vs': 'vs',
  'common.penalty': 'PEN',
  'common.og': 'OG',
  'common.penalties': 'Penalties',
  'common.qualify': 'Qualify',
  'common.eliminated': 'Out',
  'common.filter': 'Filter',
  'common.loading': 'Loading…',
  'common.empty': 'No data',
  'common.refresh': 'Refresh',
  'common.scoreHit': 'Exact score',
  'common.winnerHit': 'Outcome correct',
  'common.miss': 'Miss',
  'common.noPrediction': 'No prediction',
  'common.wentToPenalties': 'Penalties',
  'common.backToPredictions': '← Back to AI Predictions',

  'nav.home': 'Home',
  'nav.schedule': 'Schedule',
  'nav.standings': 'Standings',
  'nav.results': 'Results',
  'nav.predictions': 'AI Predictions',
  'nav.stats': 'Stats',
  'nav.teams': 'Teams',
  'nav.bets': 'Bets Sim',
  'nav.about': 'About',
  'nav.contact': 'Contact',
  'nav.fifa': 'FIFA.com',

  'footer.siteName': 'WC 2026 · AI Predictions',
  'footer.tagline': 'A static site that puts the 2026 World Cup schedule & scores side by side with my pre-match AI model predictions.',
  'footer.tagline2': 'After every match the score and hit/miss status are updated here.',
  'footer.quickLinks': 'Quick Links',
  'footer.dataSources': 'Data Sources',
  'footer.sourceSchedule': 'Schedule: FIFA 2026 official',
  'footer.sourceResults': 'Results: updated on the spot',
  'footer.copyright': '© 2026 WC 2026 AI Predictions · Non-commercial',
  'footer.disclaimer': 'All AI prediction content reflects the model\'s output at the time and does not represent fact.',
  'footer.beianIc': '🛡',
  'footer.beianGongan': '⚠️',

  'day.sun': 'Sun', 'day.mon': 'Mon', 'day.tue': 'Tue', 'day.wed': 'Wed',
  'day.thu': 'Thu', 'day.fri': 'Fri', 'day.sat': 'Sat',

  'month.1': 'Jan', 'month.2': 'Feb', 'month.3': 'Mar',
  'month.4': 'Apr', 'month.5': 'May', 'month.6': 'Jun',
  'month.7': 'Jul', 'month.8': 'Aug', 'month.9': 'Sep',
  'month.10': 'Oct', 'month.11': 'Nov', 'month.12': 'Dec',

  'stage.group': 'Group Stage',
  'stage.r32': 'Round of 32',
  'stage.r16': 'Round of 16',
  'stage.qf': 'Quarterfinal',
  'stage.sf': 'Semifinal',
  'stage.third': 'Third Place',
  'stage.final': 'Final',
  'stage.groupShort': 'Group',

  'conf.UEFA': 'UEFA (Europe)',
  'conf.CONMEBOL': 'CONMEBOL (S. America)',
  'conf.CONCACAF': 'CONCACAF (N. America)',
  'conf.AFC': 'AFC (Asia)',
  'conf.CAF': 'CAF (Africa)',
  'conf.OFC': 'OFC (Oceania)',

  'hit.score': '✅ Exact score',
  'hit.winner': '⚠️ Outcome correct',
  'hit.miss': '❌ Miss',
  'hit.pending': 'Pending',
  'hit.noPrediction': 'No prediction',

  'countdown.title': 'Time to next match',
  'countdown.day': 'd',
  'countdown.hour': 'h',
  'countdown.minute': 'm',
  'countdown.second': 's',
  'countdown.allOver': 'All matches are finished',

  'time.future': 'in ',
  'time.past': '',
  'time.day': ' d ',
  'time.hour': ' h ',
  'time.minute': ' m',

  'home.hero.badge': '🏆 2026 FIFA World Cup',
  'home.hero.title1': 'Can AI models ',
  'home.hero.title2': 'predict football?',
  'home.hero.title3': 'Let the data speak',
  'home.hero.body': '48 teams · 104 matches · 12 groups. Before every match I ask GPT, Claude, Gemini, DeepSeek and others, archive every chat screenshot, and update scores + hit status within 1 minute after kickoff.',
  'home.hero.cta1': 'View schedule →',
  'home.hero.cta2': '⭐ AI Predictions',
  'home.hero.cta3': 'Accuracy leaderboard',
  'home.today.kicker': 'Today',
  'home.today.title': 'Today / Upcoming',
  'home.today.more': 'Full schedule →',
  'home.today.empty': 'No upcoming matches',
  'home.ai.kicker': 'AI Predictions',
  'home.ai.title': '⭐ AI Predictions at a glance',
  'home.ai.more': 'See all →',
  'home.ai.empty': 'No AI prediction records yet',
  'home.ai.finished': 'Final',
  'home.ai.pending': 'Scheduled',
  'home.cards.schedule.title': 'Full schedule',
  'home.cards.schedule.desc': '104 matches, filter by date / group / stage',
  'home.cards.standings.title': 'Standings',
  'home.cards.standings.desc': '12 groups: top 2 + 8 best 3rd advance',
  'home.cards.predictions.title': 'AI predictions',
  'home.cards.predictions.desc': 'Compare multiple models',
  'home.cards.stats.title': 'Accuracy leaderboard',
  'home.cards.stats.desc': 'Which model is best at predicting scores?',

  'schedule.kicker': 'Schedule',
  'schedule.title': 'Full schedule',
  'schedule.subtitle': '104 matches · 72 group + 32 knockout',
  'schedule.filter.stage': 'Stage',
  'schedule.filter.group': 'Group',
  'schedule.filter.status': 'Status',
  'schedule.filter.team': 'Team (3-letter code)',
  'schedule.filter.teamPlaceholder': 'e.g. ARG / BRA',
  'schedule.status.finished': 'Finished',
  'schedule.status.scheduled': 'Scheduled',
  'schedule.count': '{n} matches',
  'schedule.dayCount': '{n} matches',
  'schedule.empty': 'No matches found',
  'schedule.matchCount': '{n} matches',
  'schedule.stage.group': 'Group',
  'schedule.stage.r32': 'R32',
  'schedule.stage.r16': 'R16',
  'schedule.stage.qf': 'QF',
  'schedule.stage.sf': 'SF',
  'schedule.stage.third': '3rd',
  'schedule.stage.final': 'Final',
  'schedule.status.finishedShort': 'Final',
  'schedule.status.scheduledShort': 'Upcoming',
  'schedule.dateFormat': '{m} {d}',

  'standings.kicker': 'Standings',
  'standings.title': 'Standings',
  'standings.subtitle': '12 groups: top 2 + 8 best 3rd advance to the Round of 32',
  'standings.empty': 'No finished matches in this group yet',
  'standings.thirds.title': '8 best 3rd-placed teams',
  'standings.thirds.subtitle': 'FIFA rules: Points → GD → GF → Fair play',
  'standings.thirds.empty': 'Need more finished matches to compute',
  'standings.col.team': 'Team',
  'standings.col.played': 'P',
  'standings.col.win': 'W',
  'standings.col.draw': 'D',
  'standings.col.lose': 'L',
  'standings.col.gf': 'GF',
  'standings.col.ga': 'GA',
  'standings.col.gd': 'GD',
  'standings.col.pts': 'Pts',
  'standings.col.status': 'Status',
  'standings.col.group': 'Grp',

  'results.kicker': 'Results',
  'results.title': 'Match Results',
  'results.subtitle': 'Finished matches · newest first · click to see AI prediction recap',
  'results.empty': 'No finished matches yet, will auto-appear after kickoff',

  'predictions.kicker': 'AI Predictions',
  'predictions.title': '⭐ AI Predictions',
  'predictions.subtitle': 'Before every match I ask the same prompt to several AI models. Here are their original answers and the actual results.',
  'predictions.filter.label': 'Filter:',
  'predictions.filter.all': 'All',
  'predictions.filter.finished': 'Finished only',
  'predictions.filter.pending': 'Pending only',
  'predictions.filter.hit': '✅ Exact score',
  'predictions.filter.winner': '⚠️ Outcome correct',
  'predictions.filter.miss': '❌ Miss',
  'predictions.modelFilter.label': 'Model:',
  'predictions.dashboard.title': '📊 Per-model accuracy',
  'predictions.dashboard.empty': 'No AI prediction data',
  'predictions.dashboard.scorePct': 'Exact score',
  'predictions.dashboard.winnerPct': 'Outcome',
  'predictions.summary': '{n} predictions',
  'predictions.empty': 'No matching records',
  'predictions.modelCount': '{n} models',
  'predictions.viewDetail': 'Click to see each model\'s full recap →',
  'predictions.hit.score': '✅ Exact score',
  'predictions.hit.winner': '⚠️ Outcome',
  'predictions.hit.miss': '❌ Miss',
  'predictions.hit.pending': 'Pending',

  'stats.kicker': 'Stats',
  'stats.title': 'Stats & Accuracy',
  'stats.subtitle': 'All data updates automatically as matches conclude',
  'stats.card.finished': 'Finished matches',
  'stats.card.predicted': 'Matches with AI predictions',
  'stats.card.totalPreds': 'Total AI prediction entries',
  'stats.card.overall': 'Overall outcome accuracy',
  'stats.chart.accuracy.title': '🤖 AI model accuracy leaderboard',
  'stats.chart.accuracy.legend': 'Blue = exact score; Gold = outcome direction only',
  'stats.chart.stages.title': '🎯 Accuracy by stage',
  'stats.chart.stages.legend': 'Accuracy within Group / R32 / R16 / QF / SF / Final',
  'stats.chart.timeline.title': '📈 Accuracy over time',
  'stats.chart.timeline.legend': 'Cumulative accuracy after each finished match',
  'stats.chart.scorePct': 'Exact %',
  'stats.chart.winnerPct': 'Outcome %',
  'stats.chart.timelineSuffix': ' (outcome %)',
  'stats.keyMatches.title': '🏆 Key matches recap',
  'stats.keyMatches.empty': 'Key matches (SF / 3rd / Final) will appear after kickoff',
  'stats.error': 'Page load failed: {msg}',

  'teams.kicker': 'Teams',
  'teams.title': '48 Teams',
  'teams.subtitle': 'Filter by confederation · includes group & match record',
  'teams.filter.label': 'Confederation:',
  'teams.filter.all': 'All',
  'teams.record': '{n} P · {w}W {d}D {l}L',
  'teams.empty': 'No teams',

  'bets.kicker': 'Lottery Simulation',
  'bets.disclaimer.title': 'This page is a fictional betting sandbox / simulation',
  'bets.disclaimer.default': 'All amounts, multipliers, picks and outcomes on this page are fictional/simulated data and do not constitute betting advice. Gambling carries risk; please do not participate if you are under 18.',
  'bets.empty': 'No betting records',
  'bets.budget.title': '💰 Budget',
  'bets.budget.total': 'Cap',
  'bets.budget.spent': 'Spent',
  'bets.budget.won': 'Won',
  'bets.budget.wonHint': 'Added back',
  'bets.budget.remaining': 'Remaining',
  'bets.budget.over': '⚠️ Over budget',
  'bets.budget.under': '✓ Within budget',
  'bets.budget.perUnit': '{n} per unit',
  'bets.budget.percent': '{n}% · {unit} per unit',
  'bets.type.champion': '🏆 Champion',
  'bets.type.match': '⚽ Match',
  'bets.type.group': '🅰️ Group',
  'bets.type.other': '🎯 Other',
  'bets.group.pending': 'Pending',
  'bets.group.won': 'Won',
  'bets.group.lost': 'Lost',
  'bets.line.win': '✅ Won',
  'bets.line.lose': '❌ Lost',
  'bets.line.pending': '⏳ Pending',
  'bets.parlay.combo': 'Parlay',
  'bets.parlay.comboLabel': '🎲 Combo: {n}',
  'bets.parlay.stake': 'Stake: {n}',
  'bets.parlay.maxReturn': 'Max fixed return: {n}',
  'bets.cost': 'Cost',
  'bets.picks': '{n} picks · {c} combos',
  'bets.tickets': '{n} tickets · {m}×',
  'bets.odds': 'Odds {n}',
  'bets.oddsTbd': 'Odds TBD',
  'bets.oddsAt': '@ {n}',
  'bets.note': '📝 {n}',
  'bets.filter.label': 'Filter',
  'bets.filter.all': 'All',
  'bets.filter.won': 'Won only',
  'bets.filter.pending': 'Pending only',
  'bets.filter.lost': 'Lost only',
  'bets.filter.subtotal': 'Subtotal',
  'bets.collapse.expand': 'Expand',
  'bets.collapse.collapse': 'Collapse',
  'bets.payout.actual': 'Payout {n}',
  'bets.payout.net': 'Net {n}',
  'bets.empty.filtered': 'No bets match the current filter',

  'match.title': 'Match Detail',
  'match.aiPredictionsHeading': 'AI Model Predictions',
  'match.noId': 'Missing match ID',
  'match.notFound': 'Match not found',
  'match.scorers': '⚽ Scorers',
  'match.noPredictions': 'No AI prediction for this match yet.',
  'match.noPredictionsNote': 'Before kickoff I\'ll ask several AI models the same prompt.',
  'match.predicted': 'Predicted',
  'match.actual': 'Actual',
  'match.hit': 'Result',
  'match.hitScore': '✅ Exact score',
  'match.hitWinner': '⚠️ Outcome correct',
  'match.miss': '❌ Miss',
  'match.prompt': 'Prompt:',
  'match.modelCount': '({n} models)',
  'match.predHomeWin': 'Home win',
  'match.predAwayWin': 'Away win',
  'match.predDraw': 'Draw',
  'match.penaltyScore': 'Pens {h}-{a}',

  'about.kicker': 'About',
  'about.title': 'About this site',
  'about.goal.title': '🎯 Goal',
  'about.goal.body': 'A static site that puts the 2026 World Cup schedule & scores next to my pre-match AI model predictions. After every match the score and hit/miss status are updated.',
  'about.experiment.title': '🧪 Experimental design',
  'about.experiment.li1': 'Within 24 hours before kickoff, ask several AI models the <b>same prompt</b> (see each match\'s AI prediction page).',
  'about.experiment.li2': 'After the match, update the score → the system automatically determines ✅ exact / ⚠️ outcome / ❌ miss for each model.',
  'about.experiment.li3': 'Once all matches conclude, the Stats page shows each model\'s final record.',
  'about.models.title': '🤖 AI models compared',
  'about.models.body': 'Tentatively: <b>MiniMax-M3</b>, <b>Claude Opus 4.8</b>, <b>GPT-5 mini</b>, <b>DeepSeek-V4</b>, <b>Kimi</b>.',
  'about.rules.title': '📊 Hit rules',
  'about.rules.li1': '<b>Exact score</b>: predicted score == actual score (90 min; extra time & penalties excluded)',
  'about.rules.li2': '<b>Outcome correct</b>: W/D/L direction matches but score differs',
  'about.rules.li3': '<b>Miss</b>: W/D/L direction differs',
  'about.stack.title': '🛠 Tech stack',
  'about.stack.li1': 'Vite + vanilla HTML/CSS/JS (multi-page)',
  'about.stack.li2': 'Tailwind CSS',
  'about.stack.li3': 'Chart.js (stats charts)',
  'about.stack.li4': 'Pure static, deployable to GitHub Pages / Vercel / Netlify',
  'about.structure.title': '📁 Project structure',
  'about.bets.title': '🧪 Personal betting sandbox',
  'about.bets.body': 'A separate <a class="text-ink font-bold hover:text-gold" href="/bets.html">Bets Simulation</a> column. <b>All amounts, multipliers, picks and outcomes are fictional data authored by the site owner</b> and unrelated to any real betting.',
  'about.disclaimer.title': '⚠️ Disclaimer',
  'about.disclaimer.body': 'All AI prediction content reflects the model\'s output at the time and is not advice. Scores and predictions are entered manually; AI screenshots are my own local chat records. The "Bets Simulation" column is <b>fictional sandbox data</b> and <b>does not constitute betting advice</b>; this site does not encourage any form of gambling. Gambling carries risk; please do not participate if you are under 18.',

  'champion.title': '🏆 AI Champion Predictions',
  'champion.consensus': '📌 <b>Consensus:</b> <b>{name}</b> appears <b>{count}</b> times (🥇{top} / 🥈{runner}), the plurality winner; the championship race is {race}. The site will update hit status after the final.',
  'champion.consensusRace3': '{a} / {b} / {c} three-way race',
  'champion.gold': '🥇 Champion',
  'champion.silver': '🥈 Runner-up',
  'champion.author': 'Site author',

  'contact.kicker': 'Contact',
  'contact.title': '📬 Get in touch',
  'contact.subtitle': 'Got a suggestion, found a bug, want to chat about AI models predicting football, or just want to say hi — drop me a line. I read every one.',
  'contact.form.name': 'Name',
  'contact.form.namePlaceholder': 'Your name',
  'contact.form.email': 'Email',
  'contact.form.emailPlaceholder': 'you@example.com',
  'contact.form.message': 'Message',
  'contact.form.messagePlaceholder': "What's on your mind…",
  'contact.form.messageHint': 'At least 10 chars · no more than 2000',
  'contact.form.submit': 'Send',
  'contact.form.sending': 'Sending…',
  'contact.form.success': "✅ Sent! I'll get back to you soon.",
  'contact.form.error': '❌ Failed to send. Please try again or check your connection.',
  'contact.form.errorRequired': 'Required',
  'contact.form.errorEmail': 'Please enter a valid email',
  'contact.form.errorMessage': 'Message must be at least 10 characters',
  'contact.privacy.body': "<b>Privacy:</b> Your message is forwarded to my email via Formspree. It isn't stored on this site, isn't used for marketing, and isn't shared with any third party.",

  'meta.home.title': 'WC 2026 · AI Predictions — Home',
  'meta.home.description': '2026 World Cup schedule, AI model prediction archive and accuracy stats.',
  'meta.schedule.title': 'Full Schedule · WC 2026 · AI Predictions',
  'meta.schedule.description': 'All 104 matches of the 2026 World Cup; filter by date / group / stage / status.',
  'meta.standings.title': 'Standings · WC 2026 · AI Predictions',
  'meta.standings.description': '12 group tables + 8 best 3rd-placed teams advancing to the knockout round.',
  'meta.results.title': 'Results · WC 2026 · AI Predictions',
  'meta.results.description': 'Finished match scores + AI prediction recap, newest first.',
  'meta.predictions.title': 'AI Predictions · WC 2026',
  'meta.predictions.description': 'Before every match I ask several AI models the same prompt. Their original answers and the actual results, side by side.',
  'meta.stats.title': 'Stats · WC 2026 · AI Predictions',
  'meta.stats.description': 'Per-stage AI model accuracy statistics and trend charts.',
  'meta.teams.title': 'Teams · WC 2026 · AI Predictions',
  'meta.teams.description': 'All 48 teams of the 2026 FIFA World Cup.',
  'meta.bets.title': 'Bets Simulation · WC 2026 · AI Predictions',
  'meta.bets.description': 'A personal betting sandbox during the 2026 World Cup (fictional/simulated data, not betting advice).',
  'meta.about.title': 'About · WC 2026 · AI Predictions',
  'meta.about.description': 'WC 2026 AI prediction site description, hit rules and disclaimer.',
  'meta.match.title': 'Match Detail · WC 2026 · AI Predictions',
  'meta.match.description': "Single match detail: actual score + each AI model's predicted score.",
  'meta.contact.title': 'Contact · WC 2026 · AI Predictions',
  'meta.contact.description': 'Send the site owner a message: suggestions, bug reports, AI model prediction discussions.',
};

export const DICT = { 'zh-CN': ZH, 'en-US': EN };

// ---------- State ----------
let currentLocale = DEFAULT_LOCALE;
const subscribers = new Set();

function readBrowserLocale() {
  const lang = (navigator.language || '').toLowerCase();
  if (lang.startsWith('zh')) return 'zh-CN';
  if (lang.startsWith('en')) return 'en-US';
  return DEFAULT_LOCALE;
}

export function resolveLocale() {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(URL_PARAM);
    if (fromUrl && LOCALES.includes(fromUrl)) return fromUrl;
    const fromStorage = window.localStorage?.getItem(STORAGE_KEY);
    if (fromStorage && LOCALES.includes(fromStorage)) return fromStorage;
  } catch (_) { /* ignore */ }
  return readBrowserLocale();
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale, { reload = true } = {}) {
  if (!LOCALES.includes(locale)) locale = DEFAULT_LOCALE;
  currentLocale = locale;
  try { window.localStorage?.setItem(STORAGE_KEY, locale); } catch (_) {}
  const url = new URL(window.location.href);
  url.searchParams.set(URL_PARAM, locale);
  // 写入 history 但不刷新也行；为简单起见，刷新一次最稳
  window.history.replaceState({}, '', url.toString());
  document.documentElement.lang = locale;
  // 通知订阅者（无需刷新也能即时刷新局部）
  subscribers.forEach((cb) => {
    try { cb(locale); } catch (e) { console.error('[i18n] subscriber error:', e); }
  });
  if (reload) window.location.reload();
}

// ---------- Translation ----------
export function t(key, params) {
  const dict = DICT[currentLocale] || DICT[DEFAULT_LOCALE];
  let str = dict[key];
  if (str == null) {
    // fallback: try default locale, then key
    str = (DICT[DEFAULT_LOCALE] || {})[key] || key;
  }
  if (params) {
    return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''));
  }
  return str;
}

// ---------- Locale-aware formatting ----------
const LOCALE_MAP = { 'zh-CN': 'zh-CN', 'en-US': 'en-US' };
function bcp() { return LOCALE_MAP[currentLocale] || 'en-US'; }

export function formatDate(iso, opts = {}) {
  const d = new Date(iso);
  const locale = bcp();
  const date = d.toLocaleDateString(locale, { month: '2-digit', day: '2-digit', ...opts.date });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return { date, time, raw: d };
}

export function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString(bcp(), { month: '2-digit', day: '2-digit' });
}

export function formatMonthDay(iso) {
  const d = new Date(iso);
  if (currentLocale === 'zh-CN') {
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatWeekday(iso) {
  const d = new Date(iso);
  const map = ['day.sun', 'day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat'];
  return t(map[d.getDay()]);
}

export function formatWeekdayCN(iso) {
  // 保留原来 schedule.js 的"按北京时区解析"行为
  const d = new Date(iso);
  // 取 UTC 偏移后的日期 key
  const beijing = new Date(d.getTime() + 8 * 3600 * 1000);
  const y = beijing.getUTCFullYear();
  const m = beijing.getUTCMonth();
  const dd = beijing.getUTCDate();
  const dt = new Date(y, m, dd);
  const map = ['day.sun', 'day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat'];
  return t(map[dt.getDay()]);
}

export function formatMonthDayCN(dateKey) {
  // dateKey = 'YYYY-MM-DD'，按月日显示
  const [yy, mm, dd] = dateKey.split('-').map(Number);
  if (currentLocale === 'zh-CN') {
    return `${mm} 月 ${dd} 日`;
  }
  const d = new Date(yy, mm - 1, dd);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatRelative(target) {
  const now = Date.now();
  const t0 = new Date(target).getTime();
  const diff = t0 - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const future = diff > 0;
  if (currentLocale === 'zh-CN') {
    const parts = [];
    if (days) parts.push(`${days} 天`);
    if (hours) parts.push(`${hours} 小时`);
    parts.push(`${mins} 分`);
    return (future ? '还有 ' : '已过 ') + parts.join(' ');
  }
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return future ? `in ${parts.join(' ')}` : `${parts.join(' ')} ago`;
}

export function teamName(team) {
  if (!team) return '';
  if (currentLocale === 'en-US' && team.nameEn) return team.nameEn;
  return team.name || team.nameEn || team.code || '';
}

// Alias for backwards compatibility (some files import this name directly)
export const teamDisplayName = teamName;

export function stageLabel(stage) {
  return t(`stage.${stage}`) || stage;
}

export function confLabel(code) {
  return t(`conf.${code}`) || code;
}

export function hitLabel(result, prediction) {
  if (!result) return { label: t('hit.pending'), tone: 'badge-slate' };
  if (!prediction) return { label: t('hit.noPrediction'), tone: 'badge-slate' };
  const ph = Number(prediction.predictedHome);
  const pa = Number(prediction.predictedAway);
  const rh = Number(result.homeScore);
  const ra = Number(result.awayScore);
  if (ph === rh && pa === ra) return { label: t('hit.score'), tone: 'badge-pitch' };
  const pw = ph > pa ? 'home' : ph < pa ? 'away' : 'draw';
  const rw = rh > ra ? 'home' : rh < ra ? 'away' : 'draw';
  if (pw === rw) return { label: t('hit.winner'), tone: 'badge-gold' };
  return { label: t('hit.miss'), tone: 'badge-flame' };
}

export function groupName(group) {
  // group.id like "A" "B"; t('stage.groupShort') + group
  return t('stage.groupShort') + ' ' + (group?.id || group?.name || '');
}

// ---------- DOM helpers ----------
/**
 * Scan DOM for:
 *   [data-i18n="key"]                    → textContent = t(key)
 *   [data-i18n-attr="title:meta.home.title|description:meta.home.description"]
 *   [data-i18n-html="key"]               → innerHTML = t(key) (允许嵌入 <a> <b>)
 *   [data-i18n-params="key|n=v|n=v"]     → t(key, params)
 */
export function applyI18n(root = document) {
  // textContent
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    el.textContent = t(key);
  });
  // innerHTML
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (!key) return;
    el.innerHTML = t(key);
  });
  // attribute: "title:meta.x.title|description:meta.x.description"
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const spec = el.getAttribute('data-i18n-attr');
    if (!spec) return;
    spec.split('|').forEach((pair) => {
      const [attr, key] = pair.split(':');
      if (!attr || !key) return;
      const value = t(key.trim());
      const a = attr.trim();
      // <title> is special: its child text node is the page title, not the "title" attribute
      if (el.tagName === 'TITLE' && (a === 'title' || a === 'text')) {
        el.textContent = value;
      } else {
        el.setAttribute(a, value);
      }
    });
  });
  // params: data-i18n-params="key|k1=v1|k2=v2"
  root.querySelectorAll('[data-i18n-params]').forEach((el) => {
    const spec = el.getAttribute('data-i18n-params');
    if (!spec) return;
    const [key, ...rest] = spec.split('|');
    const params = {};
    rest.forEach((kv) => {
      const [k, v] = kv.split('=');
      if (k) params[k] = v;
    });
    el.textContent = t(key, params);
  });
}

export function subscribeLocaleChange(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// ---------- Init ----------
export function initI18n() {
  currentLocale = resolveLocale();
  document.documentElement.lang = currentLocale;
  // 把 ?lang= 同步到 URL（即便用户没主动切换）
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(URL_PARAM) !== currentLocale) {
      url.searchParams.set(URL_PARAM, currentLocale);
      window.history.replaceState({}, '', url.toString());
    }
  } catch (_) {}
}

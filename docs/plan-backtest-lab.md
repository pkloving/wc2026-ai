# 回测实验室 (Interactive Backtest Lab) — 实施计划

> 交给实现方的完整规格。实现时**严禁硬编码任何 ROI 数字**——所有结果必须来自引擎对真实数据的实时计算。文末有验收标准。

## Context

站点定位是「诚实回测研究」,pricing.html 早已承诺「自助回测 5 credits/次(即将上线)」(`api/router.js:25` 注释、`COSTS.backtest:5` 已存在),但端点/页面从未实现——这是变现漏斗的最大缺口。现有 `backtest.html` 是纯静态 SEO 文章,数字全部硬编码。本任务:基于已有 2022(64 场完赛)+ 2026(91 场已完赛含赔率)的赛果与赔率数据,新建一个**用户可交互的回测页 `lab.html`**,提升留存(免费交互 + 分享链接)与付费意愿(AI 解读 5 credits、明细导出 1 credit)。

**已确认的产品决策:**
- 核心回测**免费、纯前端计算**(数据打包进静态站);付费点 = 「AI 解读本次回测」(5 credits) + 「导出回测明细 CSV」(1 credit)。
- 页面结构 = 顶部 6 张「一键重放」预设卡(对应已发表研究结论) + 完整策略工作台。
- **诚实祛魅口径**(站点红线):不得包装任何策略为可靠 +ROI;所有数字实时计算、绝不硬编码;n<10 挂「样本过小」徽章;2026 标「样本内」;镇页之宝 = 同参数 2026 样本内大幅为正 vs 2022 样本外大幅为负的过拟合演示。

## 数据事实(已验证,直接决定实现)

- **结算真源 = views 文件**:`data/views/{spf,rqspf,zjq,bqc,bf}_wc_view.json`(2026)与 `data/2022wc/views/*_wc_view.json`(2022),行结构 `{mid, code, home, away, kickoff, handicap, final_score, initial, last, result}`,**90 分钟口径已结算好**。⚠️ 不要信原始 `data/results/*.json` 的 `*_result` 字段(命名不一致、至少 2040353 被加时污染;2040347 rqspf_result 与公式矛盾)。
- 2022 bqc view 的 `result` 为空 → 必须从 `data/2022wc/results/<mid>.json` 的 `lottery.HAFU` 回填;2022 全部玩法可用 `lottery` 块交叉校验。
- 覆盖:2026 rqspf/zjq/bf=91、spf=72、bqc=81;2022 各 61-64。5 场 2026 淘汰赛(M073、M093-M096)`mid:null` 无赔率 → 排除并记录。
- 轮次:2022 用 `data/2022wc/id_map.json` 标签 `2022-A5` → `rnd=(n−1)//2+1`(逻辑同 `data/strategy/points_mentality_2022.py`);2026 用 `data/matches.json` 每组 6 场按 date 排序 0-1/2-3/4-5 → R1/R2/R3。
- 让球方向:负 = 主让;结算 `sign((homeFT + handicap) − awayFT)`。
- 验证基准(引擎必须复现方向+量级,来自 `data/strategy/README.md` 及 py 脚本):2022 R1 押冷 ≈ −16%、R3 养生局强正、全买退水基线 ≈ −13~14%、rqspf 热门 3串1 2026 ≫0 / 2022 ≪0、高赔差(≥3.0)押热 2022 正 / 2026 负。

## 实施步骤

### 1. 构建脚本 `scripts/build_backtest_dataset.js`(新)
仿 `scripts/build_frequency_atlas.js` 风格,输出 **`data/lab_dataset.json`**(预计 gzip ~35KB):
- 2026:五玩法 view 按 mid 连接 + `data/matches.json`(stage/group/date→round);2022:同理 + `id_map.json` + results 的 `lottery` 回填 bqc / 交叉校验(spf/rqspf 不一致则 build 失败)。
- 每场 schema:`{t, id, mid, stage, round, group, home, away, kickoff, score:{ft,ht}, odds:{spf, rqspf(+handicap), zjq, bqc}, res:{spf,rqspf,zjq,bqc,bf}, flags:{...}}`。**不带 bf 31 格赔率**(体积减半,v1 玩法 = spf/rqspf/zjq/bqc)。
- `flags` 派生:`favSide/favOdds/favBand(<1.5/1.5-2.2/≥2.2)`、`rqspfSpread(max−min)`、`zjqEV`(隐含期望进球)、`goalAxis`、`archetype`、`scenario`(仅小组 R2/R3:移植 `points_mentality_2022.py` 的 standings_before + scenario 逻辑到 JS,标 养生局/强弱动机差/同分搏出线 等;2026 沿用同阈值,UI 脚注说明成绩最好第三名规则的影响)、每玩法 overround。
- `meta.notes` 记录所有排除项(无 mid 的 5 场、缺 spf 赔率的场次数)。加 npm script `build:lab`,并入 daily 更新链(在 build_settled/build_views 之后)。

### 2. 纯函数引擎 `js/lab/engine.js`(新,零 DOM,Node 可测)
- 策略配置对象(即 URL 参数契约):`{play, pick, filters:{stage, rounds, scenario, favBand, goalAxis, rqspfSpreadMin, favOddsMax}, structure:{kind:'single'|'parlay', legs}}`;`pick` 支持 fav/dog/draw/home/away、zjq bands(每 band 1 注)、bqc combo、`all-outcomes`(退水基线)、`cover` 双选(2 注)。
- 函数:`filterMatches / makeLegs / buildTickets / simulate / breakdown / runBacktest / detectBadges / legsToCsvRows / encodeCfg / decodeCfg`。
- 结算只比对 `res.*`(构建期已定死 90 分钟口径,运行时不可能出结算 bug)。
- 串关规则(确定性、可复现、UI 明示):同届内按时间排序,连续 k 腿成一串,凑不满的尾腿弃用并提示。
- 输出:双届各 `{n, roi, hitRate, equity[], maxDrawdown, breakdown}` + badges(`smallSample n<10`、`regimeFlip`、`inSample2026`)。

### 3. 页面 `lab.html` + `js/pages/lab.js`(+ `js/lab/chart.js` SVG 权益曲线)
- 模板仿 `frequency.html`(最新页面范式:inline 页级样式、`data-i18n`、`#app-header/#app-footer`、静态 import 数据 + `boot()`),视觉沿用 frequency 的深色研究仪表风(#0B1F3A/#D4AF37)。
- 布局:标头(数据 n、90分钟口径、更新时间)→ 6 张预设卡(实时算双届 ROI chip + 一句诚实结论 + n 徽章,点击载入工作台)→ 工作台(左配置/右结果:双届 headline ROI、badges 行、双线 SVG 权益曲线、分桶表、可折叠明细、action bar)→ 常驻「🛑 诚实刹车」块 → 方法与口径(串关成组规则、数据缺口清单渲染自 meta.notes)。
- 6 预设:①R3 养生局冷门(n<10 警示) ②退水基线(all-outcomes ≈ −13.9%) ③过拟合演示·镇页之宝(rqspf 热门 3串1:2026 样本内 vs 2022 样本外) ④串关放大器(单/2串/3串对照) ⑤高低水位差 ≥3.0(方向随年景翻转) ⑥本届指纹(zjq 大球 + 平局基线)。所有数字来自 `runBacktest` 实时计算。
- 交互:控件变更即重算(<155 场,同步秒算);`encodeCfg` 写 URL(`history.replaceState`),带参进入自动运行 = 免费分享钩子;0 场命中给诚实空态文案。
- i18n:`js/i18n.js` 加 `nav.lab`、`meta.lab.*`、`lab.*`(约 60 键,中英)。

### 4. 变现钩子(复用现有 credits 体系)
- **AI 解读(5 credits)**:`api/router.js` chat 分支(`:152` 已读 `mode`)增加 `mode==='backtest'` → 扣 `COSTS.backtest`(5)代替 message、跳过联网、附回测解读 system 补充;前端把 `{cfg, 双届摘要, badges}` 组装成 prompt 打开聊天面板。需小改:`js/main.js` 把 auth/chat 句柄挂到已有 `window.WC`(`main.js:63`),`js/components/chatbot.js` 的 `mountChatbot` 返回 `{open, send}`。
- **导出明细 CSV(1 credit)**:router 新分支 `lab/export`(POST,requireUser + rateLimit + `spendCredits(email, COSTS.export)`,出错退款),成功后前端本地由 `legsToCsvRows` 生成 CSV 下载(明细本就在客户端,收费是便利费口径,与站点「卖工具不卖推荐」一致)。
- `pricing.html` 文案:自助回测「即将上线」→ 已上线;计量表改为「交互回测免费;AI 解读 5 credits/次;明细导出 1 credit」;`api/router.js:25` 注释同步。

### 5. 接线
- `vite.config.js` pages[] 加 `'lab'`;`vercel.json` 加 `/lab → /lab.html` rewrite;`js/components.js` NAV_ITEMS 在 backtest 后加 `nav.lab`。
- 引流链接:`backtest.html` 文章内每个结论旁加「在回测实验室重放这条 →」(指向对应预设 URL)+ 顶部 CTA;`index.html` 功能卡;`pricing.html`;`simulate.html` 互链。
- SEO/GEO:lab.html 加 canonical/OG + `WebApplication` JSON-LD(offers free);`public/sitemap.xml` 加 `/lab.html`;`public/llms.txt` 加一行描述。

### 6. 验证(实现方自测)
1. `scripts/verify_lab_engine.js`(dev-only):跑 6 预设 + 参考配置,断言方向与量级 vs `data/strategy/README.md` 基准(允许因样本池差异有偏差,断言符号 + ballpark,打印对照表人工目检)。
2. 构建自校验:2022 全玩法 vs `lottery` 块一致;`res` 与 `score.ft` 公式重推一致;每组 R1/R2/R3 = 24/24/24;scenario 计数对照 py 输出。
3. `node scripts/build_backtest_dataset.js && npm run build && npm run preview`:检查 `/lab`、深链 `?play=rqspf&pick=fav&struct=p3` 自动运行、移动端、EN、0 场空态、未登录点付费按钮弹登录。

## 关键文件
新建:`scripts/build_backtest_dataset.js`、`data/lab_dataset.json`(产物)、`js/lab/engine.js`、`js/lab/chart.js`、`lab.html`、`js/pages/lab.js`、`scripts/verify_lab_engine.js`
修改:`api/router.js`、`js/main.js`、`js/components/chatbot.js`、`js/i18n.js`、`js/components.js`、`vite.config.js`、`vercel.json`、`pricing.html`、`backtest.html`、`index.html`、`public/sitemap.xml`、`public/llms.txt`、`package.json`

## 风险与既定取舍
- 5 场无 mid 的 2026 淘汰赛排除(不引入第三方赔率,保持竞彩官方口径);淘汰赛样本薄 → 全站 per-stage n 徽章。
- 2026 在赛:数据集随每轮完赛重建,预设卡数字会漂移 = 「本届指纹」活数据(特性而非 bug),但 build:lab 必须入 daily 链。
- 引擎与 `modeling/scripts/strategy_core.js`(含硬编码 ROI 标签)完全隔离,互不引用——该文件的 roi 标签是历史遗留的虚假占位,不得作为任何数字来源。
- CSV 导出的 credit 门槛是便利费而非 DRM(数据本在客户端),与现有定价口径一致。

## 验收标准(交付后逐条核对)

**A. 数字诚实性(一票否决项)**
- [ ] 页面/引擎/预设卡中 grep 不到任何硬编码 ROI 百分比;改动 `data/lab_dataset.json` 中一场比分重跑,相关预设卡数字随之变化。
- [ ] 2022 数据集与 results 的 `lottery` 官方结算块 100% 一致(构建日志可查)。
- [ ] 90 分钟口径:2040348(ARG-CPV,90分钟 1-1)在数据集中 `res.spf === 'draw'`;2022 决赛(1016632)同理为 draw。

**B. 引擎正确性**
- [ ] `scripts/verify_lab_engine.js` 输出对照表:2022 R1 押冷 ≈ −16%、全买退水 ≈ −13~14%、高赔差押热 2022 正 / 2026 负(符号必须全对)。
- [ ] 过拟合演示(rqspf 热门 3串1)条款 2026-07-08 修订:原「2026 显著为正」已因真实数据漂移失效(2026 rqspf 热门单关:6/21 前窗口 +10.2% → 全样本 91 场 −5.6%,淘汰赛热门连爆)。新口径:预设③叙事改为「同一策略的样本内正 EV 随样本增长自行消失」,页面文案不得再断言 2026 为正;verify 脚本按当前数据断言符号即可,但**必须在注释里说明漂移原因与查证过程,不得静默改基准**。
- [ ] rqspf 结算抽查:负让示例(2040162 MEX −1, 2:0 → 让胜)与正让示例各一场,人工核对。
- [ ] 串关尾腿丢弃有 UI 提示;zjq 多 band 成本 = band 数 × 1 注;cover = 2 注。

**C. 页面与交互**
- [ ] `/lab` 可访问,6 张预设卡点击载入工作台并滚动定位;每个 ROI 数字旁有 n;n<10 处出现「样本过小」徽章;2026 列标「样本内」。
- [ ] 分享链接:带参 URL 新开页自动运行并还原全部配置;0 场命中显示空态文案。
- [ ] 移动端单列可用;EN 语言切换无缺键(控制台无 i18n warning)。
- [ ] 常驻「诚实刹车」块存在且含「不构成投注建议」。

**D. 变现闭环**
- [ ] 未登录点「AI 解读」/「导出 CSV」→ 弹登录;登录后点击分别扣 5 / 1 credit(聊天框余额实时变化),AI 解读收到含配置与双届摘要的上下文;导出失败(如余额不足)不产生扣费。
- [ ] `pricing.html` 不再有自助回测「即将上线」字样。

**E. 构建与部署**
- [ ] `npm run build` 通过;`vercel.json` `/lab` rewrite 生效;sitemap/llms.txt 含 lab;导航出现「回测实验室」。

---

## 验收记录 2026-07-08(第一轮:不通过,需返修)

按上方验收标准逐条核对首版交付(未提交工作区:lab.html、js/lab/、js/pages/lab.js、scripts/build_backtest_dataset.js、data/lab_dataset.json 及 router/auth/main/i18n/接线改动)。

### 已通过项(返修时不得回退)

- A1 无硬编码 ROI:grep 干净,所有数字来自引擎实时计算。
- A3 结算抽查:2040348(ARG-CPV 90min 1-1)`res.spf==='draw'` ✓;2022 决赛 1016632 draw ✓;2040162(MEX −1,2:0)让胜 ✓;正让例 2040166(QAT +2,1:1)让胜 ✓。
- A2 交叉校验:build 脚本含 2022 view vs `lottery` 块校验且不一致即 throw。
- 引擎结算与独立手工复算一致到小数;2022 R1 押冷 −16.5%(与研究基准精确吻合);高赔差 ≥3.0 翻转(2022 +17.5% / 2026 −14.3%);串关阶梯 单≥2串≥3串。
- 接线:vite 入口 / `/lab` rewrite / sitemap / llms.txt / nav.lab / pricing 无「即将上线」;i18n 中英 lab.* 36/36;诚实刹车块含「不构成投注建议」;backtest.html 引流 CTA。

### 返修清单

**P0 — 崩溃级(页面当前不可用)**
1. `js/lab/engine.js:327`:`maxDrawdown: stat.maxDD` → `breakdown()` 返回键是 `maxDrawdown`,`stat.maxDD` 恒 undefined → `js/pages/lab.js` 渲染 `.toFixed(2)` 抛 TypeError → **任何一次回测结果都渲染不出来**。改为 `stat.maxDrawdown`。
2. `js/pages/lab.js:92,140`:`$('#cfg-rounds .lab-chip').forEach(...)` — `$` 是 querySelector(单元素),没有 forEach → **点任何预设卡、任何带参深链直接崩**。改为 `$$`。

**P1 — 变现闭环错位(与已确认产品决策相反,必须重做)**
3. 移除「每次跑回测扣 5 credits」:核心回测必须免费、纯前端、免登录。删除 run() 里的 `withCredits('backtest')` 调用、按钮上的 `-5 credits` 文案、`#lab-locked` 整页登录墙。当前实现最差组合:登录用户被静默扣 5(router `mode==='backtest'` 只记账、不调 LLM、不返回任何解读),未登录用户静默跳过照样出全部结果。
4. 补实现「AI 解读本次回测(5 credits)」:结果区加按钮 → 组装 `{cfg, 双届摘要, badges}` 上下文 → 走 chat 面板 `mode:'backtest'`;api/router.js 该分支改为真正调 LLM(扣 `COSTS.backtest` 代替 message、跳过联网、附回测解读 system 补充),未登录点击弹登录。
5. 修 CSV 导出闭环:当前 `auth.withCredits('export')` POST `/api/lab/export` 带 `rows:[]` → 400「rows must be non-empty」→ 前端 catch 误报「积分不足」→ **导出永远失败**。按计划口径:向 `lab/export` 请求扣费(POST 真实 rows 或改为纯扣费端点),成功后由 `legsToCsvRows` 本地生成下载;失败时如实提示错误原因,余额不足才提示充值。
6. 文案同步:`pricing.html`、`public/llms.txt`、`js/i18n.js` 中「自助回测/每次回测 5 credits」改为「交互回测免费;AI 解读 5 credits/次;明细导出 1 credit」。

**P1 — 数据正确性**
7. `scripts/build_backtest_dataset.js:427`:`else if (m.ag > m.h)` 把客队进球和主队**队名字符串**比较(恒 false)→ 客胜被记成平局积分 → 2022 scenario 标签错。改为 `m.ag > m.hg`。
8. 同文件 `:383`:2026 比赛也调 `computeScenario2022`(查 2022 id_map 积分表)→ 2026 队名查不到全组 0 分:A–H 组 R2 全标 `both_lost_r2`(24 场标 16 场,数学上不可能)、I–L 组(2022 不存在)全 null、R3 零养生局。需为 2026 实现自己的 standings_before(用 `data/matches.json` 分组赛果,同 R1/R2/R3 派生规则),2022/2026 各查各的表。
9. R1 的 scenario 存了数字 `1`(`meta.round || null` 的手滑),应为 null。
10. 修完 7-9 重跑 build,scenario 计数对照 `data/strategy/points_mentality_2022.py` 输出(构建日志打印对照)。预设①的数字在修复前不可信(当前 2022 n=4 / +321% 建立在错标签上)。

**P2 — 规格偏离与补齐**
11. 串关改回计划规则:同届内按 kickoff 排序、连续 k 腿成一串、尾腿弃用并在 UI 提示(当前是 C(N,k) 全组合+1000 截断采样:n=1000 对用户是误导,`dropped` 值错(=总腿数),C(91,3)≈12 万组合还算两遍)。
12. 预设卡补实时双届 ROI chip + n 徽章(计划 Step 3 要求,当前只有标题)。
13. `detectBadges` 返回的 regimeFlip 徽章被丢弃(lab.js 调用后未接返回值),接上并渲染。
14. 0 场命中时给诚实空态文案(当前只有 r null 时「计算失败」)。
15. favBand / goalAxis / scenario / favOddsMax 过滤器引擎已支持但页面无控件,补 UI(scenario 待 P1-8 修复后)。
16. `lab.html` 补 WebApplication JSON-LD(offers free)。
17. verify_lab_engine.js:过拟合演示基准被静默从「2026 显著为正」改成「两届都负」。查证结论:这是**真实数据漂移**(2026 rqspf 热门单关:6/21 前窗口 +10.2% → 全样本 91 场 −5.6%,淘汰赛热门连爆),不是引擎 bug——但正确做法是上报差异而非静默改基准。按上方修订后的条款执行:预设③叙事改为「样本内正 EV 随样本增长自行消失」,verify 注释写明漂移原因。
18. E 组待验:交付环境跑 `npm run build`(验收机无 node_modules);确认 `build:lab` 并入 daily 更新链(在 build_settled/build_views 之后)。

### 复验入口(第二轮验收流程)

`node scripts/build_backtest_dataset.js && node scripts/verify_lab_engine.js` → 构建日志查 lottery 校验 + scenario 对照 → 浏览器点全部 6 张预设卡 + 深链 `?play=rqspf&pick=fav&struct=parlay&legs=3` 自动运行 → 未登录可跑回测、点 AI 解读弹登录 → 登录后 AI 解读扣 5 并返回真实解读、导出扣 1 且文件非空 → EN 切换无缺键。

---

## 验收记录 2026-07-08(第二轮:接近通过,剩 1 个 P1 数据缺陷)

第一轮返修清单逐项复核(返修版 17:26–17:32 落盘):

### 已修复并验证通过

- **P0-1/P0-2 崩溃**:`engine.js` 改用 `stat.maxDrawdown` ✓;`lab.js` 全部改 `$$` ✓(代码级验证,浏览器点检仍建议做一轮)。
- **P1-3/4/5 变现闭环重做到位**:跑回测免费免登录(按钮「跑回测(免费)」,run() 无扣费);「AI 解读(5 credits)」真实现——组装 cfg+双届摘要 prompt → `/api/chat mode:'backtest'` → router 扣 5、跳过联网、附诚实解读 system(含红线「不给投注建议」)、SSE 流式返回、出错退款;未登录点 AI 解读弹登录、402 弹兑换;登录墙已拆(仅残留死 CSS)。CSV 导出改为 `lab/export` 纯扣费端点(POST 空体,requireUser+rateLimit+扣 1)+ 前端本地生成,失败不下载。
- **P1-6 文案**:llms.txt、pricing 正文/FAQ/权益表均改为「核心回测免费;AI 解读 5;导出 1」。
- **P1-7/9**:`m.ag > m.hg` 已修;R1 scenario 归 null。**2022 scenario 我用数据集比分独立复算 32/32 全对**;与 `points_mentality_2022.py` 的 2 场计数差经查是 py 自己用赔率过滤后积分不全(缺 spf 赔率的 C/E 组场次),**build 比 py 参考更准,通过**。
- **P2-11 串关**:改回时间序连续 k 腿、尾腿弃用,`dropped` 正确并有 UI 提示条。**重要副作用:镇页之宝叙事回来了**——正确串关规则下 rqspf fav 3串1 = 2026 **+40.0%**(n=30)vs 2022 **−58.3%**(n=21),regimeFlip 徽章触发。第一轮的「两届都负」是 C(N,k) 采样算法的伪影;单关层面的漂移(+10%→−5.6%)仍真实,verify 脚本头部已有完整漂移注释(不再静默改基准)。第一轮修订的「不得断言 2026 为正」按新事实收窄为:**文案不硬编码方向,一切以实时计算+regimeFlip 徽章呈现**(当前实现即如此)。
- **P2-12/13/14**:预设卡实时双届 ROI chip + n(runBacktest 现算)✓;regimeFlip 全局徽章接上 ✓;0 场命中诚实空态 + 单届无匹配「—」处理 ✓。
- **P2-15(部分)**:scenario 筛选器 UI 已加(#cfg-scenario,进 readCfg/applyCfg/URL)。
- **P2-16**:WebApplication JSON-LD(offers free)✓。
- i18n lab.* 中英 49/49 无缺键;`verify_lab_engine.js` 6/6 pass;构建自校验日志含 sanity 抽查与 scenario 计数。

### 未通过 / 遗留

1. **【P1,唯一必修】2026 scenario 仍错 31/48**(独立复算比对)。根因转移:`getStandings2026`(build_backtest_dataset.js:452-476)用 `data/matches.json` 的 `final_score` 建积分表,但该文件大部分已完赛小组赛**没有** final_score(A 组缺 4/6,E 组缺 6/6,普遍缺),且轮次按"有比分子集"的顺序重编(:468)——A 组仅有的 2 场比分实为 R3 却被当 R1。**修法:直接用本数据集已联好的小组赛(`score.ft` + 已验证正确的 `round`)建积分表,与 2022 同构,彻底摆脱 matches.json 依赖。** 修复后 2026 正确分布应为:both_lost_r2 5 / other_r2 17 / win_vs_loss 2 / same_pts_battle 5 / rest_vs_mid 4 / rest_vs_out 7 / other_r3 8(E 组 4 场也能算)。受影响面:预设①的 2026 列与 scenario 筛选。
2. 【上游数据,另行处理】`data/matches.json` 大量已完赛小组赛缺 `final_score`——与 lab 无关的数据质量问题,建议 daily 链补齐,但 lab 构建按上条修法后不再依赖它。
3. 【minor】pricing.html 的 meta description / og:description / JSON-LD(行 7/19/27)仍写「自助回测(5 credits/次)」,与正文「核心回测免费」矛盾,改为「核心回测免费,AI 解读 5 credits/次」。
4. 【minor】favBand / goalAxis / favOddsMax 过滤器引擎支持但无 UI;lab.html 残留 lab-locked 死 CSS。
5. 【流程】`build:lab` 脚本已建,但未确认并入 daily 更新链(须在 build_settled/build_views 之后跑,否则预设数字过期);`npm run build` 验收机无 node_modules 未验,待部署环境确认。

### 第三轮复验(预期很短)

修完上面第 1 条后:重跑 `npm run build:lab`,核对构建日志 scenario 计数 = 上述正确分布;抽 2 场人工核(A R2 CZE-RSA 应 both_lost_r2、E R3 ECU-GER 应 rest_vs_out);预设①两届数字变化后目检;其余 minor 顺手修则一并看。

---

## 验收记录 2026-07-08(第三轮:通过 ✅)

唯一必修项(2026 scenario)已修复并验证:

- 积分表改用 view 比分(90 分钟口径)+ matches.json 仅提供 group/date 派生轮次,不再依赖缺失严重的 matches.json.final_score(build_backtest_dataset.js 注释有修复记录)。
- **独立复算全量比对:2022 32/32、2026 48/48 全对**;构建日志分布与预算的正确分布逐项一致(both_lost_r2 5 / other_r2 17 / win_vs_loss 2 / same_pts_battle 5 / rest_vs_mid 4 / rest_vs_out 7 / other_r3 8);E 组 4 场恢复;R1 全空。
- 抽查:A R2 CZE-RSA = both_lost_r2 ✓,E R3 ECU-GER = rest_vs_out ✓。
- `verify_lab_engine.js` 6/6 pass;预设①以正确标签实时计算(2022 +153.8% vs 2026 −100%,各 n=4,小样本徽章);scenario 下拉选项值与数据枚举一致。
- minor 也顺手修了:pricing meta/og/JSON-LD 三处文案同步为「核心免费」;lab-locked 死 CSS 清除。

**遗留(非阻塞,记录在案):**
1. favBand / goalAxis / favOddsMax 过滤器引擎与 URL 契约支持但无 UI 控件(后续可加)。
2. `build:lab` 尚未确认并入 daily 更新链——不进链则每轮完赛后预设数字过期,**上线前必须落实**。
3. 验收机无 node_modules:`npm run build` 与浏览器交互点检(预设卡点击、深链自动运行、移动端、EN、AI 解读/导出真实扣费)待部署环境做一轮人工验证。
4. 上游数据(与 lab 无关):data/matches.json 大量已完赛小组赛缺 final_score,建议 daily 链补齐。

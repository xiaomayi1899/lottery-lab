# 数彩实验室 · 五彩种公式投票选号

一个可以装进 iPhone 主屏幕的**纯静态网页**：双色球 / 大乐透 270 个公式、3D / 排列五每位 94 个数字公式、快乐8 173 个号码公式，各自独立推荐号码，按近 40 期回测命中率加权投票，前区、后区、位置分别计算，选出票数最高的一组号码。附带完整走势图、公式库、历史开奖和数据自动更新。

- 双色球：红球 1–33 选 6 + 蓝球 1–16 选 1
- 大乐透：前区 1–35 选 5 + 后区 1–12 选 2
- 福彩3D：百位、十位、个位各 0–9 选 1
- 快乐8：1–80 选 10
- 排列五：万、千、百、十、个位各 0–9 选 1
- 公式：双色球/大乐透 **270 个**（前区 173 / 后区 97）；3D/排列五每位 **94 个**数字公式；快乐8 **173 个**号码公式
- 可托管在私有 GitHub 仓库（默认，代码别人看不到）；免费账户的私有仓库不能发布 Pages，网页请用本地 `node scripts/serve.mjs` 打开

> 彩票是独立随机事件，本项目只是对历史数据做数学练习，**不能预测开奖结果**，也不构成投注建议。请理性购彩，未满 18 周岁禁止购彩。

---

## 一、部署

> **隐私优先**：部署脚本默认创建**私有**仓库，别人看不到代码。
> GitHub 的两个硬限制：**Pages 站点本身总是公开的**（没有密码）；**免费账户的私有仓库不能发布 Pages**。想要「带密码、只给自己看」，用下面的 Cloudflare 方式。

### 方式 ★：Cloudflare Pages + 邮箱验证（推荐，真正带密码）

效果：只有你自己的邮箱能进；别人就算拿到网址，也会被挡在 Cloudflare 登录页。全免费（Access 免费版支持 50 个用户）。

1. 注册 Cloudflare（免费）：<https://dash.cloudflare.com/sign-up>
2. 左侧 **Workers & Pages → Create → Pages → Connect to Git**，授权 GitHub，选择**私有仓库** `xiaomayi1899/lottery-lab2`。
3. 构建设置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：`/`
   - 点 **Save and Deploy**，得到 `https://<项目名>.pages.dev`
4. **关掉预览地址**（否则预览子域会绕过密码）：项目 → **Settings → Builds & deployments → Preview deployments**，选择只保留 Production。
5. 加访问门禁：**Zero Trust → Access → Applications → Add an application → Self-hosted**
   - Application name：数彩实验室
   - 域名填两条：`<项目名>.pages.dev` 和 `*.<项目名>.pages.dev`
   - Policy：Action **Allow**，Include **Emails** = 你的邮箱
   - 登录方式选 **One-time PIN**（邮箱验证码，不需要第三方登录）
6. 用你的邮箱打开 `https://<项目名>.pages.dev`，收验证码后进入；别人打开只会看到登录页。

项目根目录已经放好两个文件，部署后自动生效：

- `_headers`：入口与 `sw.js` 不缓存、静态资源短缓存（以后改完立刻能看到新版）
- `robots.txt`：`Disallow: /`，禁止搜索引擎收录

> 数据仍可自动更新：私有仓库的 GitHub Actions 每天抓取并提交，Cloudflare 会在提交后自动重新部署。

### 方式 A：网页上传（不需要命令行）

1. 登录 GitHub，右上角 **+ → New repository**。
2. 仓库名填 `lottery-lab`（可自定义），选择 **Private**（代码只有你能看到），**不要**勾选 “Add a README file”，点 **Create repository**。
3. 在空仓库页面点 **Add file → Upload files**。
4. 把本项目**所有文件和文件夹**拖进上传区（必须保留 `assets/`、`data/`、`scripts/`、`.github/` 的目录结构），点 **Commit changes**。
   - 如果网页上传不显示 `.github` 隐藏文件夹，可以先忽略它，后面再单独添加自动更新工作流（见第四节）。
5. 私有仓库要发布网页需要 **GitHub Pro/Team**：升级后在 **Settings → Pages** 选择 `main` / `/ (root)`。免费账户请直接用下面的方式 D 在本地打开。

### 方式 B：一条命令部署（GitHub API，适合想省事的人）

需要本机安装 Node.js 18+，并在 GitHub 生成一个 **Personal Access Token (classic)**：

- 头像 → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**
- 勾选 **repo**；如果要连同 `.github/workflows` 一起上传，再勾选 **workflow**
- 复制生成的 token（只显示一次）

在项目根目录打开 PowerShell：

```powershell
$env:GITHUB_TOKEN = "ghp_你的token"
# 默认：创建私有仓库并上传，不开启 Pages
node scripts/deploy.mjs 你的用户名/lottery-lab --create
# 私有仓库 + 已升级 Pro，才加 --pages 发布站点
# 只有确认愿意公开代码时，才加 --public
```

脚本会：创建**私有**仓库（已存在则复用）→ 逐个上传文件 → 打印结果。没有 `--pages` 就不会启用 Pages。
token 只从环境变量读取，不会写入任何文件；用完可以关掉终端或执行 `Remove-Item Env:GITHUB_TOKEN`。

### 方式 C：Git 命令行

```bash
git init
git add .
git commit -m "feat: 数彩实验室"
git branch -M main
git remote add origin https://github.com/你的用户名/lottery-lab.git
git push -u origin main
```

推送后按方式 A 的第 5 步决定要不要开启 Pages。

### 方式 D：只在本地用（最私密，完全不上传）

```bash
node scripts/serve.mjs 4173
# 浏览器打开 http://127.0.0.1:4173/
```

代码与数据只留在本机，不经过 GitHub，任何人都看不到。

---

## 二、装到 iPhone 主屏幕

1. 用 **Safari** 打开部署后的网址（必须是 Safari，微信内置浏览器不行）。
2. 点底部 **分享** 按钮 → **添加到主屏幕** → 添加。
3. 之后从桌面图标进入，全屏运行；首页、走势图、公式库都可离线查看（开奖数据联网时自动刷新）。

页面已包含 `manifest.webmanifest`、Service Worker、`apple-touch-icon` 和 iOS 安全区适配。

---

## 三、它怎么算的

1. **每个公式推荐一个号码。**
   - 双色球/大乐透的前区、后区公式互不混用；
   - 3D 按百/十/个位分别用 0–9 数字公式，排列五按万/千/百/十/个位分别用 0–9 数字公式；
   - 快乐8 用 1–80 号码公式推荐 10 个号码。
2. **滚动回测。** 每个公式用最近 40 期做“假装不知道当期”的回测，越近的期数权重越高（半衰期 20 期），看它推荐的单个号码是否落入当期开奖号码集合。
3. **贝叶斯平滑 + 加权投票。** 对时间加权后的命中率再做贝叶斯平滑，避免小样本过拟合；按 `0.3 + 平滑命中率 × 2.2` 计算权重，所有公式给各自推荐的号码投票。对与上期开奖重复的号码降权（×0.6–0.8），并限制最多保留个数：大乐透前区/后区各 1 个、双色球前区 2 个、快乐8 4 个。
4. **取票数最高的号码。** 双色球 6+1、大乐透 5+2、3D 三位、排列五五位、快乐8 选十；同票时依次比较票数、近 10 期频率、号码大小。
5. **备选票。** “换一注”会对主推号码整体降权，并按号码加入确定性扰动，让票数自然流向次优号码。不用随机数，同一个盐值随时可复现。

公式覆盖 10 类方法（下表为双色球/大乐透的前区 + 后区数量）：

| 类别 | 数量 | 例子 |
| --- | --- | --- |
| 频率 | 38 | 近 N 期热号/冷号、指数衰减热度 |
| 遗漏 | 11 | 最大遗漏、遗漏偏差、尾数/质数遗漏回补 |
| 上期关联 | 21 | 重号、邻号 ±1/±2/±3、同尾、邻号遗漏 |
| 和值跨度 | 12 | 和值均值、和值尾、跨度回补、AC 值 |
| 结构形态 | 18 | 奇偶/大小/质合/三区/012 路回补、区间遗漏轮动 |
| 统计模型 | 108 | 线性回归、EWMA、卡方、贝叶斯、马尔可夫、泊松、AR(1)、Holt、相似期匹配、二项 Z、游程检验、几何等待分位、信息熵、核密度低谷、MAD 稳健 Z、威布尔风险率、Wilson 下界、经验贝叶斯收缩、James-Stein、卡尔曼滤波、CUSUM 变点、Hurst 指数、互信息、Bootstrap 命中率、泊松对数趋势、谱密度共振 |
| 反思维 | 84 | 避众指数、反生日号、反忌讳数、反吉利尾、反整五整十、反上期重号/邻号、反同尾、反对称号、反均衡形态、反连号簇、反等差数列、反票面图形、反跨期热圈、反质数偏好、反小号扎堆，以及反直觉系列：反惧连号、反尾数全异、反三区均分、反小跨度、反忌大号、反惧等差、反补冷直觉、反回补直觉 |
| 数论映射 | 21 | 黄金分割、镜像号、质数/斐波那契/平方数/三角数 |
| 期号日期 | 7 | 期号数字和、期号尾数、星期映射、日期数字和 |
| 跨区联动 | 2 | 前区和值/跨度映射到后区 |

“反思维”类公式不负责猜哪些号会开，而是反过来问「哪些号没人愿意买」。分两层：

1. **避热门号**：给每个号码打大众偏好分（生日/日期号段、吉利尾 6·8·9、整五整十、质数、上期号码与邻号、区间正中、投注单每行首尾列），偏好分越低越不容易和别人撞车；在低分号码里再挑遗漏最久的那个。
2. **避大众直觉**：手选票普遍怕连号、怕大号、怕等差、怕重复尾、总想补冷号——而 400 期真实开奖里 64.5% 带连号、75.5% 尾数有重复、只有 41.5% 的和值落在 90–110。这一组公式专门落在这些被大众主动躲开的位置上。

号码本身的中奖概率不变；变的是一旦中奖时与多少人平分——双色球一等奖 1/1772 万，每期约 1.7 亿注，撞号多寡直接决定奖金被摊薄几份。

3D / 排列五的数字公式从后区公式派生，去掉“跨度均值”和“跨区联动”等对单数字无意义的项，共 **94 个/位置**；快乐8 复用前区 173 个号码公式。

---

## 四、更新开奖数据

### 自动更新（GitHub Actions）

工作流文件：`.github/workflows/update-data.yml`

- 每天北京时间 **22:40** 和 **23:40** 各跑一次，优先抓取中国福彩网 / 中国体彩网；官方接口对 GitHub 海外服务器可能返回 403/567，脚本会自动切换到 **500.com 走势图** 备用源。
- 首次使用需要在仓库 **Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions**，否则 Action 无法提交。
- 也可以在 **Actions → Update lottery data → Run workflow** 手动触发。

> 两个源都失败时会保留旧数据并报错；可以在 Actions 里手动重跑，或本地运行更新命令。

### 手动更新

```bash
node scripts/fetch-data.mjs --draws=400
# 强制使用备用源
node scripts/fetch-data.mjs --draws=400 --source=500
```

然后提交 `data/history.json`。数据源：

- 双色球：中国福利彩票官网 `cwl.gov.cn`
- 大乐透：中国体育彩票官网 `sporttery.cn`
- 福彩3D / 快乐8：中国福利彩票官网 `cwl.gov.cn`
- 排列五：500.com 走势图
- 备用：500.com 走势图（官方接口对海外服务器返回 403/567 时自动启用）

### 页面还停在旧版本？

网页和“添加到主屏幕”的图标都用 Service Worker 缓存。`sw.js` 已改成**网络优先**：联网时每次都取最新文件，只有断网才回退缓存。如果仍然看到旧界面：

- 点页面右上角的 **⟳** 按钮，或在“关于”页点 **检查更新 · 清除缓存**：会清掉 `sc-lab-*` 缓存、注销 Service Worker，再带时间戳重新加载。
- 也可以强制刷新：Windows `Ctrl+F5`、macOS `Cmd+Shift+R`、iOS Safari 关掉标签页重开。

注意：本地改完代码要重新部署（`node scripts/deploy.mjs` 或 push 到 GitHub）才会同步到线上站点。

---

## 五、本地开发与自测

```bash
# 本地预览（不要直接双击 index.html，浏览器会拦截 fetch 本地 JSON）
node scripts/serve.mjs 4173
# 打开 http://127.0.0.1:4173/

# 引擎自测：公式数量、边界、确定性、投票、备选票、走势图
node scripts/selftest.mjs

# 重新生成 PWA 图标
node scripts/make-icons.mjs
```

目录结构：

```
index.html                 单页入口
manifest.webmanifest       PWA 清单
sw.js                      离线缓存
assets/
  core.js                  数据工具、回测、投票、走势计算
  formulas.js              270 个公式定义（含循环批量生成的热号/冷号族）
  charts.js                Canvas 图表（无第三方依赖）
  app.js                   界面与交互
  style.css                iOS 风格样式
  icons/                   180/192/512 图标
data/history.json          五彩种各 400 期开奖
scripts/
  fetch-data.mjs           抓取开奖数据
  selftest.mjs             引擎自测
  serve.mjs                本地静态服务器
  make-icons.mjs           生成 PNG 图标
  deploy.mjs               通过 GitHub API 一键部署
.github/workflows/
  update-data.yml          每日自动更新数据
```

---

## 六、常见问题

**页面打开是空白 / 提示数据加载失败？**
确认是通过 `https://...` 或本地 HTTP 访问，而不是 `file://` 直接双击；确认 `data/history.json` 已上传。

**Pages 打开 404？**
检查 Settings → Pages 的分支是否为 `main`、目录是否为 `/ (root)`，并等 1–2 分钟构建完成。

**数据不更新？**
看 Actions 是否开启、Workflow permissions 是否为 Read and write；或本地运行 `node scripts/fetch-data.mjs` 后提交。

**手机看到的还是旧版本？**
Service Worker 采用缓存优先。修改前端文件后，把 `sw.js` 里的 `CACHE = 'sc-lab-v6'` 改成 `v7`、`v8` 再部署；或在 iPhone 上删除主屏幕图标后重新添加。

**复制号码没反应？**
GitHub Pages 是 HTTPS，剪贴板可用；若被浏览器限制，长按号码手动复制。

**会收集我的数据吗？**
不会。没有后端、没有统计脚本，所有计算都在浏览器本地完成。

---

## 七、免责声明

本项目仅用于学习前端工程、数据分析与数学建模，所有“推荐”均为历史数据的机械计算结果，不代表任何中奖预测。彩票开奖结果具有随机性，请勿据此进行超出自身承受能力的投注。因使用本项目产生的任何后果由使用者自行承担。

# 数彩实验室 · 双色球 / 大乐透公式投票选号

一个可以装进 iPhone 主屏幕的**纯静态网页**：156 个数学公式各自推荐一个号码，按近 40 期回测命中率加权投票，前区、后区分别计算，选出票数最高的一组号码。附带完整走势图、公式库、历史开奖和数据自动更新。

- 双色球：红球 1–33 选 6 + 蓝球 1–16 选 1
- 大乐透：前区 1–35 选 5 + 后区 1–12 选 2
- 公式总数 **156 个**（前区 103 / 后区 53），每个公式只推荐一个号码
- 托管在 GitHub Pages，手机流量即可访问，不依赖电脑常驻

> 彩票是独立随机事件，本项目只是对历史数据做数学练习，**不能预测开奖结果**，也不构成投注建议。请理性购彩，未满 18 周岁禁止购彩。

---

## 一、部署到 GitHub Pages（三种方式，任选一种）

仓库地址可以放在任意子路径，例如 `https://用户名.github.io/lottery-lab/`，所有链接均为相对路径。

### 方式 A：网页上传（不需要命令行，推荐）

1. 登录 GitHub，右上角 **+ → New repository**。
2. 仓库名填 `lottery-lab`（可自定义），选择 **Public**，**不要**勾选 “Add a README file”，点 **Create repository**。
3. 在空仓库页面点 **Add file → Upload files**。
4. 把本项目**所有文件和文件夹**拖进上传区（必须保留 `assets/`、`data/`、`scripts/`、`.github/` 的目录结构），点 **Commit changes**。
   - 如果网页上传不显示 `.github` 隐藏文件夹，可以先忽略它，后面再单独添加自动更新工作流（见第四节）。
5. 打开仓库 **Settings → Pages**：
   - **Source** 选择 **Deploy from a branch**
   - **Branch** 选择 `main`，目录选择 `/ (root)`，点 **Save**
6. 等 1–2 分钟，访问 `https://你的用户名.github.io/lottery-lab/`。

### 方式 B：一条命令部署（GitHub API，适合想省事的人）

需要本机安装 Node.js 18+，并在 GitHub 生成一个 **Personal Access Token (classic)**：

- 头像 → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**
- 勾选 **repo**；如果要连同 `.github/workflows` 一起上传，再勾选 **workflow**
- 复制生成的 token（只显示一次）

在项目根目录打开 PowerShell：

```powershell
$env:GITHUB_TOKEN = "ghp_你的token"
node scripts/deploy.mjs 你的用户名/lottery-lab --create --pages
```

脚本会：创建公开仓库（已存在则复用）→ 逐个上传文件 → 开启 GitHub Pages → 打印访问地址。
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

然后按方式 A 的第 5 步开启 Pages。

---

## 二、装到 iPhone 主屏幕

1. 用 **Safari** 打开部署后的网址（必须是 Safari，微信内置浏览器不行）。
2. 点底部 **分享** 按钮 → **添加到主屏幕** → 添加。
3. 之后从桌面图标进入，全屏运行；首页、走势图、公式库都可离线查看（开奖数据联网时自动刷新）。

页面已包含 `manifest.webmanifest`、Service Worker、`apple-touch-icon` 和 iOS 安全区适配。

---

## 三、它怎么算的

1. **每个公式推荐一个号码。**
   - 前区公式只在前区号码中选（红球 1–33 / 前区 1–35）；
   - 后区公式只在后区号码中选（蓝球 1–16 / 后区 1–12）；
   - 前后区公式完全不混用。
2. **滚动回测。** 每个公式用最近 40 期做“假装不知道当期”的回测，看它推荐的单个号码是否落入当期开奖号码集合，得到命中率。
3. **贝叶斯平滑 + 加权投票。** 40 期样本偏少，直接命中率容易过拟合；先向随机命中率做贝叶斯平滑，再按 `0.3 + 平滑命中率 × 2.2` 计算权重，所有公式给各自推荐的号码投票。
4. **取票数最高的号码。** 前区取加权票数前 6/5 个，后区取前 1/2 个，升序排列组成一注；同票时依次比较票数、近 10 期频率、号码大小。
5. **备选票。** “换一注”会对主推号码整体降权，并按号码加入确定性扰动，让票数自然流向次优号码。不用随机数，同一个盐值随时可复现。

公式覆盖 9 类方法：

| 类别 | 数量 | 例子 |
| --- | --- | --- |
| 频率 | 38 | 近 N 期热号/冷号、指数衰减热度 |
| 遗漏 | 11 | 最大遗漏、遗漏偏差、尾数/质数遗漏回补 |
| 上期关联 | 21 | 重号、邻号 ±1/±2/±3、同尾、邻号遗漏 |
| 和值跨度 | 12 | 和值均值、和值尾、跨度回补、AC 值 |
| 结构形态 | 18 | 奇偶/大小/质合/三区/012 路回补、区间遗漏轮动 |
| 统计模型 | 26 | 线性回归、EWMA、卡方、贝叶斯、马尔可夫、和值尾转移 |
| 数论映射 | 21 | 黄金分割、镜像号、质数/斐波那契/平方数/三角数 |
| 期号日期 | 7 | 期号数字和、期号尾数、星期映射、日期数字和 |
| 跨区联动 | 2 | 前区和值/跨度映射到后区 |

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
- 备用：500.com 走势图（官方接口对海外服务器返回 403/567 时自动启用）

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
  formulas.js              156 个公式定义
  charts.js                Canvas 图表（无第三方依赖）
  app.js                   界面与交互
  style.css                iOS 风格样式
  icons/                   180/192/512 图标
data/history.json          双色球/大乐透各 400 期开奖
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
Service Worker 采用缓存优先。修改前端文件后，把 `sw.js` 里的 `CACHE = 'sc-lab-v2'` 改成 `v3`、`v4` 再部署；或在 iPhone 上删除主屏幕图标后重新添加。

**复制号码没反应？**
GitHub Pages 是 HTTPS，剪贴板可用；若被浏览器限制，长按号码手动复制。

**会收集我的数据吗？**
不会。没有后端、没有统计脚本，所有计算都在浏览器本地完成。

---

## 七、免责声明

本项目仅用于学习前端工程、数据分析与数学建模，所有“推荐”均为历史数据的机械计算结果，不代表任何中奖预测。彩票开奖结果具有随机性，请勿据此进行超出自身承受能力的投注。因使用本项目产生的任何后果由使用者自行承担。

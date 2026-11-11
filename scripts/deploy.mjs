#!/usr/bin/env node
/**
 * 通过 GitHub REST API 一键部署（无需安装 git）
 *
 * 用法：
 *   PowerShell:
 *     $env:GITHUB_TOKEN = "ghp_xxx"
 *     node scripts/deploy.mjs 你的用户名/lottery-lab --create
 *   Bash:
 *     GITHUB_TOKEN=ghp_xxx node scripts/deploy.mjs 你的用户名/lottery-lab --create
 *
 * 参数：
 *   --create    仓库不存在时自动创建（默认创建**私有**仓库）
 *   --public    显式要求公开仓库（任何人都能看到代码，默认不公开）
 *   --pages     自动开启 GitHub Pages（默认**不开启**；公开仓库免费，私有仓库需 Pro/Team）
 *   --dry-run   只列出将上传的文件，不发请求
 *
 * Token 需要 repo 权限；要上传 .github/workflows 还需 workflow 权限。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--'));
const shouldCreate = argv.includes('--create');
const isPublic = argv.includes('--public');
const setupPages = argv.includes('--pages');
const dryRun = argv.includes('--dry-run');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const SKIP_DIRS = new Set(['.git', '.reasonix', 'node_modules', 'dist', 'coverage', '.vscode', '.idea']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', '.env']);

function fail(message) {
  console.error('\n✗ ' + message + '\n');
  process.exit(1);
}

if (!target && !dryRun) {
  fail('缺少仓库参数。示例：node scripts/deploy.mjs 你的用户名/lottery-lab --create --pages');
}

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name) || name.endsWith('.log')) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) collect(full, out);
    else if (info.size <= 8 * 1024 * 1024) out.push(full);
  }
  return out;
}

const files = collect(ROOT).map((file) => ({
  full: file,
  path: relative(ROOT, file).split(sep).join('/')
}));

if (!files.length) fail('没有找到可上传的文件。');

if (dryRun) {
  console.log(`将上传 ${files.length} 个文件：`);
  files.forEach((f) => console.log('  ' + f.path));
  process.exit(0);
}

if (!token) {
  fail('缺少 GITHUB_TOKEN。请先在 GitHub 生成 Personal Access Token（勾选 repo，上传工作流还需 workflow），然后设置环境变量。');
}

const API = 'https://api.github.com';
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'shucai-lab-deploy'
};

async function gh(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const err = new Error(`${options.method || 'GET'} ${path} → ${res.status} ${(data && data.message) || ''}`.trim());
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function getSha(path) {
  try {
    const data = await gh(`/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
    return data && data.sha;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

let owner;
let repo;
let branch = 'main';

async function main() {
  const me = await gh('/user');
  if (target.includes('/')) {
    const parts = target.split('/');
    if (parts.length !== 2) fail('仓库参数格式应为 用户名/仓库名');
    owner = parts[0];
    repo = parts[1];
  } else {
    owner = me.login;
    repo = target;
  }
  if (me.login.toLowerCase() !== owner.toLowerCase()) {
    console.warn(`⚠ Token 属于 ${me.login}，但目标仓库属于 ${owner}；需要该仓库的写入权限。`);
  }

  console.log(`\n仓库：${owner}/${repo}`);

  let info;
  try {
    info = await gh(`/repos/${owner}/${repo}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    if (!shouldCreate) {
      fail('仓库不存在。加 --create 自动创建，或先在 GitHub 网页新建空仓库。');
    }
    console.log('仓库不存在，正在创建公开仓库…');
    info = await gh('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repo,
        description: '双色球 / 大乐透公式投票选号 · 公式库 + 走势图',
        private: !isPublic,
        auto_init: true,
        has_issues: true,
        has_wiki: false
      })
    });
    await sleep(1800);
  }

  branch = info.default_branch || 'main';
  if (info.private) {
    console.log('仓库是私有的：代码只有你能看到（私有仓库发布 Pages 需要 GitHub Pro/Team）。');
  } else {
    console.warn('⚠ 仓库是公开的：任何人都能查看、克隆、fork 你的代码。如需私有，请到仓库 Settings → General → Danger Zone 改成 Private。');
  }

  // 空仓库可能还没有分支，先建一个初始提交
  try {
    await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  } catch (err) {
    if (err.status !== 404 && err.status !== 409) throw err;
    console.log('仓库还没有提交，正在初始化分支…');
    await gh(`/repos/${owner}/${repo}/contents/README.md`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'chore: init repository',
        content: Buffer.from('# ' + repo + '\n').toString('base64')
      })
    });
    await sleep(1800);
  }

  console.log(`\n上传 ${files.length} 个文件（分支 ${branch}）…`);
  let uploaded = 0;
  const warnings = [];
  for (const file of files) {
    const content = readFileSync(file.full).toString('base64');
    const sha = await getSha(file.path);
    const body = { message: `chore: upload ${file.path}`, content, branch };
    if (sha) body.sha = sha;
    try {
      await gh(`/repos/${owner}/${repo}/contents/${encodePath(file.path)}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      uploaded++;
      console.log(`  ✓ ${file.path}`);
    } catch (err) {
      if (file.path.startsWith('.github/') && (err.status === 403 || err.status === 404)) {
        warnings.push(file.path);
        console.warn(`  ⚠ 跳过 ${file.path}（token 需要 workflow 权限）`);
      } else {
        throw err;
      }
    }
  }

  console.log(`\n已上传 ${uploaded}/${files.length} 个文件。`);

  if (setupPages && info.private) {
    console.warn('⚠ 私有仓库发布 Pages 需要 GitHub Pro/Team；免费账户通常会失败，可去掉 --pages 只用私有仓库。');
  }

  if (setupPages) {
    console.log('正在开启 GitHub Pages…');
    const source = { source: { branch, path: '/' }, build_type: 'legacy' };
    try {
      await gh(`/repos/${owner}/${repo}/pages`);
      await gh(`/repos/${owner}/${repo}/pages`, { method: 'PUT', body: JSON.stringify(source) });
      console.log('  ✓ Pages 已更新为 branch: ' + branch + ' / root');
    } catch (err) {
      if (err.status === 404) {
        await gh(`/repos/${owner}/${repo}/pages`, { method: 'POST', body: JSON.stringify(source) });
        console.log('  ✓ Pages 已创建');
      } else if (err.status === 409) {
        await gh(`/repos/${owner}/${repo}/pages`, { method: 'PUT', body: JSON.stringify(source) });
        console.log('  ✓ Pages 已存在，已更新');
      } else {
        throw err;
      }
    }

    for (let i = 0; i < 8; i++) {
      try {
        const page = await gh(`/repos/${owner}/${repo}/pages`);
        if (page.status === 'built') break;
      } catch (e) { /* 构建中可能暂时不可读 */ }
      await sleep(4000);
    }

    const url = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
      ? `https://${owner.toLowerCase()}.github.io/`
      : `https://${owner.toLowerCase()}.github.io/${repo}/`;
    console.log('\n完成 🎉');
    console.log('访问地址：' + url);
    console.log('首次构建通常需要 1–2 分钟；若 404 请稍后刷新。');
  } else {
    console.log('\n完成。请到仓库 Settings → Pages 手动选择分支 ' + branch + ' / root。');
  }

  if (warnings.length) {
    console.log('\n以下工作流文件因 token 权限被跳过，可在网页端补传：');
    warnings.forEach((w) => console.log('  - ' + w));
  }
  console.log('\niPhone：Safari 打开上面的地址 → 分享 → 添加到主屏幕。');
}

main().catch((err) => {
  console.error('\n✗ 部署失败：' + err.message);
  if (err.data && err.data.message) console.error('  GitHub 返回：' + err.data.message);
  if (err.status === 401) console.error('  请检查 token 是否正确或已过期。');
  if (err.status === 403) console.error('  请检查 token 是否具备 repo（及 workflow）权限。');
  process.exit(1);
});

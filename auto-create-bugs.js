#!/usr/bin/env node
/**
 * auto-create-bugs.js
 *
 * 双向缺陷管理: 读取 Newman JSON 报告, 将失败用例创建为 TAPD 缺陷,
 * 同时对已通过的用例自动关闭对应的历史缺陷。
 *
 * 用法:
 *   node auto-create-bugs.js                              # 默认读取 newman/report.json
 *   node auto-create-bugs.js --report <path>              # 读取单个报告
 *   node auto-create-bugs.js --reports-dir <dir>          # 读取目录下所有 JSON 报告
 *
 * 配置: 复制 tapd-config.example.json → tapd-config.json 并填写真实凭证
 *
 * 工作流程:
 *   Phase 1  → 读取 Newman 报告，分类「通过」与「失败」
 *   Phase 2  → 自动关闭已通过用例的历史缺陷 (new/in_progress → resolved)
 *   Phase 3  → 为失败用例创建新缺陷 (带去重保护)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

// ═══════════════════════════════════════════════════════════════
//  CLI 参数解析
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
let REPORT_FILE = null;
let REPORTS_DIR = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--report' || args[i] === '-r') && i + 1 < args.length) {
    REPORT_FILE = path.resolve(args[++i]);
  } else if ((args[i] === '--reports-dir' || args[i] === '-d') && i + 1 < args.length) {
    REPORTS_DIR = path.resolve(args[++i]);
  }
}

// ═══════════════════════════════════════════════════════════════
//  常量与路径
// ═══════════════════════════════════════════════════════════════

const ROOT_DIR    = __dirname;
const CONFIG_FILE = path.join(ROOT_DIR, 'tapd-config.json');
const DEFAULT_RPT = path.join(ROOT_DIR, 'newman', 'report.json');
const SEEN_FILE   = path.join(ROOT_DIR, 'newman', '.reported-bugs.json');
const TAPD_HOST   = 'api.tapd.cn';
const TAPD_PORT   = 443;
const TAPD_TMOUT  = 30000;

// ═══════════════════════════════════════════════════════════════
//  1. 加载配置文件
// ═══════════════════════════════════════════════════════════════

console.log('');
console.log('========================================');
console.log('  TAPD 缺陷双向同步工具');
console.log('  Phase 1: 分析报告 → Phase 2: 自动关闭 → Phase 3: 创建缺陷');
console.log('========================================');

let config = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    config = JSON.parse(raw);
  }
} catch (err) {
  console.error('[ERROR] 无法读取配置文件: ' + CONFIG_FILE);
  process.exit(1);
}

// 环境变量 > 配置文件
const workspace_id     = process.env.TAPD_WORKSPACE_ID   || config.workspace_id;
const api_user         = process.env.TAPD_API_USER       || config.api_user;
const api_password     = process.env.TAPD_API_PASSWORD   || config.api_password;
const close_status     = process.env.TAPD_CLOSE_STATUS   || config.close_status   || 'resolved';
const bug_title_prefix = process.env.TAPD_TITLE_PREFIX   || config.bug_title_prefix || '[AutoTest]';

const missing = [];
if (!workspace_id)  missing.push('workspace_id');
if (!api_user)      missing.push('api_user');
if (!api_password)  missing.push('api_password');

if (missing.length > 0) {
  console.error('[ERROR] 缺少 TAPD 凭证，请通过以下方式之一提供:');
  console.error('  方式 1 (本地):  编辑 tapd-config.json');
  console.error('  方式 2 (CI/CD): 设置环境变量 TAPD_WORKSPACE_ID, TAPD_API_USER, TAPD_API_PASSWORD');
  console.error('  缺失字段: ' + missing.join(', '));
  process.exit(1);
}

console.log('  数据来源 : ' + (process.env.TAPD_WORKSPACE_ID ? '环境变量' : 'tapd-config.json'));
console.log('  工作空间 : ' + workspace_id);
console.log('  API 用户 : ' + api_user);
console.log('  关闭状态 : ' + close_status);

// ═══════════════════════════════════════════════════════════════
//  2. 加载去重缓存
// ═══════════════════════════════════════════════════════════════

/** @type {Map<string, string>} 签名 → bugId */
const reportedBugs = new Map();
try {
  if (fs.existsSync(SEEN_FILE)) {
    const seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
    for (const entry of seen) {
      reportedBugs.set(entry.signature, entry.bugId);
    }
    console.log('  去重缓存 : ' + reportedBugs.size + ' 条记录');
  }
} catch (_) { /* 缺失或损坏则从零开始 */ }

// ═══════════════════════════════════════════════════════════════
//  3. 读取 Newman JSON 报告 (支持单文件或目录批量)
// ═══════════════════════════════════════════════════════════════

/**
 * 读取单个 Newman JSON 报告
 * @param {string} filePath
 * @returns {{name:string, executions:Array}}
 */
function readReportFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const rep = JSON.parse(raw);
  if (!rep.run || !rep.run.executions || !Array.isArray(rep.run.executions)) {
    throw new Error('格式异常: 找不到 run.executions 数组');
  }
  return { name: path.basename(filePath), executions: rep.run.executions };
}

/** @type {Array<{name:string, executions:Array}>} */
const allReports = [];

if (REPORTS_DIR) {
  if (!fs.existsSync(REPORTS_DIR)) {
    console.error('[ERROR] 报告目录不存在: ' + REPORTS_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.error('[ERROR] 报告目录下没有 JSON 文件: ' + REPORTS_DIR);
    process.exit(1);
  }
  console.log('  报告目录 : ' + REPORTS_DIR + ' (' + files.length + ' 个文件)');
  for (const f of files) {
    const fp = path.join(REPORTS_DIR, f);
    try {
      allReports.push(readReportFile(fp));
    } catch (err) {
      console.error('  [WARN] 跳过 ' + f + ': ' + err.message);
    }
  }
} else {
  const target = REPORT_FILE || DEFAULT_RPT;
  if (!fs.existsSync(target)) {
    console.error('[ERROR] Newman 报告不存在: ' + target);
    console.error('  请先执行: newman run ... -r json --reporter-json-export ' + path.relative(ROOT_DIR, target));
    process.exit(1);
  }
  try {
    allReports.push(readReportFile(target));
  } catch (err) {
    console.error('[ERROR] 无法读取报告: ' + err.message);
    process.exit(1);
  }
}

// 合并所有报告的执行记录
/** @type {Array} */
const allExecutions = [];
for (const rep of allReports) {
  for (const exec of rep.executions) {
    allExecutions.push(exec);
  }
}

if (allExecutions.length === 0) {
  console.error('[ERROR] 没有找到任何测试执行记录');
  process.exit(1);
}

console.log('  报告文件 : ' + allReports.length);
console.log('  执行记录 : ' + allExecutions.length);

// ═══════════════════════════════════════════════════════════════
//  4. 分类用例: 通过 vs 失败
// ═══════════════════════════════════════════════════════════════

/** @type {string[]} 所有断言均通过的用例名称 */
const passedNames = [];

/** @type {Array<{name:string, method:string, url:string, statusCode:number|string,
 *          requestBody:string, responseBody:string, assertions:Array}>} */
const failedRequests = [];

for (const exec of allExecutions) {
  const assertions = exec.assertions || [];
  const failed = assertions.filter(a => a.error);

  const item     = exec.item     || {};
  const request  = exec.request  || {};
  const response = exec.response || {};

  if (failed.length === 0) {
    passedNames.push(item.name || 'Unknown Request');
    continue;
  }

  failedRequests.push({
    name:         item.name || 'Unknown Request',
    method:       request.method || 'GET',
    url:          (request.url && request.url.raw) ? request.url.raw : 'N/A',
    statusCode:   response.code || response.status || 'N/A',
    requestBody:  (request.body && request.body.raw) ? request.body.raw : '',
    responseBody: typeof response.body === 'string'
                    ? response.body
                    : (response.body ? JSON.stringify(response.body) : ''),
    assertions:   failed.map(a => ({
      name:  a.assertion,
      error: (a.error && a.error.message) ? a.error.message : 'Unknown error'
    }))
  });
}

console.log('');
console.log('  分析结果:');
console.log('    通过 : ' + passedNames.length + ' 条');
console.log('    失败 : ' + failedRequests.length + ' 条');
console.log('========================================');
console.log('');

// ═══════════════════════════════════════════════════════════════
//  5. TAPD API 封装
// ═══════════════════════════════════════════════════════════════

/**
 * 发起 TAPD API 请求
 * @param {'GET'|'POST'} method
 * @param {string} apiPath   API 路径，如 '/bugs'
 * @param {object} [data]    POST 时的表单数据
 * @param {number} [redirectCount] 内部递归计数器
 * @returns {Promise<object>}
 */
function tapdRequest(method, apiPath, data, redirectCount) {
  const _redirectCount = redirectCount || 0;
  const MAX_REDIRECTS = 5;

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(api_user + ':' + api_password).toString('base64');

    let fullPath = apiPath;
    let postData = null;

    if (method === 'GET' && data) {
      const qs = querystring.stringify(data);
      fullPath = apiPath + (apiPath.includes('?') ? '&' : '?') + qs;
    } else if (method === 'POST' && data) {
      postData = querystring.stringify(data);
    }

    const options = {
      hostname: TAPD_HOST,
      port:     TAPD_PORT,
      path:     fullPath,
      method:   method,
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type':  'application/x-www-form-urlencoded'
      },
      timeout: TAPD_TMOUT
    };

    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (_redirectCount >= MAX_REDIRECTS) {
          reject(new Error('重定向次数过多'));
          return;
        }
        res.resume();
        const loc = res.headers.location;
        let parsedPath;
        if (loc.startsWith('http')) {
          const u = new URL(loc);
          parsedPath = u.pathname + u.search;
        } else {
          parsedPath = loc;
        }
        resolve(tapdRequest(method, parsedPath, data, _redirectCount + 1));
        return;
      }

      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (parseErr) {
          const preview = body.length > 300 ? body.substring(0, 300) + '...' : (body || '(empty)');
          reject(new Error('TAPD 响应解析失败 [HTTP ' + res.statusCode + ']: ' + preview));
        }
      });
    });

    req.on('error', (err) => reject(new Error('网络请求失败: ' + err.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时 (' + (TAPD_TMOUT / 1000) + 's)'));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * 查询 TAPD 缺陷
 * @param {string} titleKeyword  标题搜索关键词
 * @param {string} [statusFilter] 状态筛选, 如 "new|in_progress"
 * @returns {Promise<Array<{id:string, title:string, status:string}>>}
 */
function queryTapdBugs(titleKeyword, statusFilter) {
  console.log('  [查询] 标题 ~ "' + truncate(titleKeyword, 60) + '" ...');

  const params = {
    workspace_id: String(workspace_id),
    title:        titleKeyword,
    fields:       'id,title,status',
    limit:        50
  };
  if (statusFilter) {
    params.status = statusFilter;
  }

  return tapdRequest('GET', '/bugs', params).then(resp => {
    if (resp && resp.status === 1 && resp.data) {
      const bugs = [];
      const raw = Array.isArray(resp.data) ? resp.data : [resp.data];
      for (const item of raw) {
        if (item.Bug) bugs.push(item.Bug);
      }
      return bugs;
    }
    return [];
  });
}

/**
 * 更新 TAPD 缺陷状态
 * @param {string} bugId     缺陷 ID
 * @param {string} newStatus 新状态, 如 "resolved"
 * @param {string} [comment] 可选备注
 * @returns {Promise<{id:string, status:string}>}
 */
function updateBugStatus(bugId, newStatus, comment) {
  const data = {
    workspace_id: String(workspace_id),
    id:           String(bugId),
    status:       newStatus
  };
  if (comment) {
    data.description = comment;
  }

  return tapdRequest('POST', '/bugs', data).then(resp => {
    if (resp && resp.status === 1) {
      return { id: bugId, status: newStatus };
    }
    const errMsg = (resp && resp.info) ? resp.info : ('HTTP ' + (resp && resp.status));
    throw new Error('TAPD 更新失败: ' + errMsg);
  });
}

/**
 * 创建 TAPD 缺陷
 * @param {string} title       缺陷标题
 * @param {string} description 缺陷描述 (TAPD wiki 格式)
 * @returns {Promise<{id:string, title:string}>}
 */
function createTapdBug(title, description) {
  const postData = {
    workspace_id:   String(workspace_id),
    title:          title,
    description:    description,
    severity:       'normal',
    priority_label: 'middle'
  };

  return tapdRequest('POST', '/bugs', postData).then(resp => {
    if (resp && resp.status === 1 && resp.data && resp.data.Bug) {
      return resp.data.Bug;
    }
    const errMsg = (resp && resp.info) ? resp.info : 'Unknown error';
    throw new Error('TAPD 创建失败: ' + errMsg);
  });
}

// ═══════════════════════════════════════════════════════════════
//  6. 工具函数
// ═══════════════════════════════════════════════════════════════

function escapePipe(s) { return String(s).replace(/\|/g, '\\|'); }
function escapeWiki(s) { return String(s).replace(/\{/g, '\\{').replace(/\}/g, '\\}'); }
function truncate(s, max) {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  return str.length <= max ? str : str.substring(0, max) + '…[truncated]';
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function buildSignature(f) {
  const assertionNames = f.assertions.map(a => a.name).sort().join(';');
  return f.name + '::' + assertionNames;
}

/**
 * 构建 TAPD 缺陷描述 (Wiki 格式)
 */
function buildDescription(f) {
  const lines = [];

  lines.push('h2. 失败详情');
  lines.push('');
  lines.push('| 属性 | 值 |');
  lines.push('|------|----|');
  lines.push('| 请求名称 | ' + escapePipe(f.name) + ' |');
  lines.push('| 请求方法 | ' + f.method + ' |');
  lines.push('| 请求 URL | ' + escapePipe(f.url) + ' |');
  lines.push('| 响应状态码 | ' + f.statusCode + ' |');
  lines.push('');

  lines.push('h3. 失败断言 (' + f.assertions.length + ' 条)');
  lines.push('');
  for (let i = 0; i < f.assertions.length; i++) {
    const a = f.assertions[i];
    lines.push('* *断言 ' + (i + 1) + ':* ' + a.name);
    lines.push('** 实际结果: ' + escapeWiki(a.error));
  }
  lines.push('');

  if (f.requestBody) {
    const body = truncate(f.requestBody, 2000);
    lines.push('h3. 请求体');
    lines.push('{code:json}');
    lines.push(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    lines.push('{code}');
    lines.push('');
  }

  if (f.responseBody) {
    const body = truncate(f.responseBody, 2000);
    lines.push('h3. 响应体');
    lines.push('{code:json}');
    try {
      const parsed = JSON.parse(body);
      lines.push(JSON.stringify(parsed, null, 2));
    } catch (_) {
      lines.push(body);
    }
    lines.push('{code}');
    lines.push('');
  }

  lines.push('----');
  lines.push('*由 OrderAPITest 自动化测试自动生成 | ' + new Date().toISOString() + '*');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
//  7. Phase 2 — 自动关闭已通过用例的对应缺陷
// ═══════════════════════════════════════════════════════════════

/**
 * 对于本次已通过的每个用例，到 TAPD 中查找标题包含该用例名称、
 * 且状态为 "new" 或 "in_progress" 的缺陷。若找到，则将其状态更新
 * 为 close_status (默认 "resolved")，并添加备注。
 *
 * @returns {Promise<{closed:number, failed:number}>}
 */
async function autoClosePassedBugs() {
  if (passedNames.length === 0) {
    console.log('[Phase 2] 没有已通过的用例，跳过自动关闭。');
    console.log('');
    return { closed: 0, failed: 0 };
  }

  const uniqueNames = [...new Set(passedNames)];
  console.log('[Phase 2] 自动关闭已通过用例的历史缺陷...');
  console.log('  待检查用例 : ' + uniqueNames.length);
  console.log('  搜索状态   : new | in_progress');
  console.log('  目标状态   : ' + close_status);
  console.log('');

  let closed = 0;
  let failed = 0;

  for (let i = 0; i < uniqueNames.length; i++) {
    const testName = uniqueNames[i];
    const prefix   = '  [' + (i + 1) + '/' + uniqueNames.length + ']';

    try {
      // 搜索 TAPD 中标题包含 "[AutoTest] <用例名称>" 的未关闭缺陷
      const existingBugs = await queryTapdBugs(
        bug_title_prefix + ' ' + testName,
        'new|in_progress'       // TAPD 状态码: new=新, in_progress=进行中
      );

      if (existingBugs.length === 0) {
        // 无未关闭缺陷，跳过
        continue;
      }

      console.log(prefix + ' 找到 ' + existingBugs.length + ' 个未关闭缺陷 — ' + testName);

      for (const bug of existingBugs) {
        const bugId = bug.id;
        const currentStatus = bug.status;
        const comment =
          '该问题已在本次回归测试中通过，自动关闭。\n' +
          '用例名称: ' + testName + '\n' +
          '关闭时间: ' + new Date().toISOString() + '\n' +
          '来源: OrderAPITest 自动化测试';

        try {
          await updateBugStatus(bugId, close_status, comment);
          console.log(prefix + '   [已关闭] Bug #' + bugId +
                      ' [' + currentStatus + ' → ' + close_status + '] — ' +
                      truncate(bug.title, 50));
          closed++;
        } catch (err) {
          console.error(prefix + '   [失败] Bug #' + bugId + ' 更新失败: ' + err.message);
          failed++;
        }

        // API 限流保护
        await sleep(300);
      }
    } catch (err) {
      console.error(prefix + ' [失败] 查询失败 (' + testName + '): ' + err.message);
      failed++;
    }

    if (i < uniqueNames.length - 1) {
      await sleep(200);
    }
  }

  console.log('');
  console.log('[Phase 2] 完成: 已关闭 ' + closed + ' 个缺陷, 失败 ' + failed + ' 个');
  console.log('========================================');
  console.log('');
  return { closed, failed };
}

// ═══════════════════════════════════════════════════════════════
//  8. Phase 3 — 为失败用例创建缺陷
// ═══════════════════════════════════════════════════════════════

/**
 * @returns {Promise<{created:number, skipped:number, failed:number}>}
 */
async function createBugsForFailures() {
  if (failedRequests.length === 0) {
    console.log('[Phase 3] 没有失败的用例，跳过创建缺陷。');
    console.log('');
    return { created: 0, skipped: 0, failed: 0 };
  }

  console.log('[Phase 3] 为失败用例创建 TAPD 缺陷...');
  console.log('  待处理 : ' + failedRequests.length + ' 个');
  console.log('');

  let created = 0;
  let skipped = 0;
  let failed  = 0;

  for (let i = 0; i < failedRequests.length; i++) {
    const f   = failedRequests[i];
    const sig = buildSignature(f);
    const prefix = '  [' + (i + 1) + '/' + failedRequests.length + ']';

    // 去重检查：相同的用例名 + 相同的失败断言组合 → 不重复提单
    if (reportedBugs.has(sig)) {
      console.log(prefix + ' [跳过] 已有 Bug #' + reportedBugs.get(sig) + ' — ' + truncate(f.name, 50));
      skipped++;
      continue;
    }

    // 标题格式: [AutoTest] TC-LOGIN-001 [正向] 登录成功 — Status code is 200
    const firstErr = f.assertions[0];
    const title = bug_title_prefix + ' ' + f.name + ' — ' + firstErr.name;

    console.log(prefix + ' 创建: ' + title);

    try {
      const bug = await createTapdBug(title, buildDescription(f));
      console.log(prefix + '   [已创建] → Bug #' + bug.id);
      reportedBugs.set(sig, String(bug.id));
      created++;
    } catch (err) {
      console.error(prefix + '   [失败] ' + err.message);
      failed++;
    }

    // API 限流保护
    if (i < failedRequests.length - 1) {
      await sleep(500);
    }
  }

  // 持久化去重记录
  if (created > 0 || skipped > 0) {
    const entries = [];
    for (const [sig, bugId] of reportedBugs) {
      entries.push({ signature: sig, bugId: bugId });
    }
    try {
      const dir = path.dirname(SEEN_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SEEN_FILE, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (err) {
      console.error('[WARN] 无法保存去重记录: ' + err.message);
    }
  }

  console.log('');
  console.log('[Phase 3] 完成: 创建 ' + created + ' 个, 跳过 ' + skipped + ' 个, 失败 ' + failed + ' 个');
  return { created, skipped, failed };
}

// ═══════════════════════════════════════════════════════════════
//  9. 主流程
// ═══════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();

  // Phase 2: 自动关闭 (先关后建，逻辑上更合理)
  const closeResult = await autoClosePassedBugs();

  // Phase 3: 创建缺陷
  const createResult = await createBugsForFailures();

  // 汇总
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('========================================');
  console.log('  执行完成 (耗时 ' + elapsed + 's)');
  console.log('    Phase 2 关闭缺陷 : ' + closeResult.closed + ' 个');
  console.log('    Phase 3 创建缺陷 : ' + createResult.created + ' 个');
  console.log('    Phase 3 跳过重复 : ' + createResult.skipped + ' 个');
  console.log('    操作失败         : ' + (closeResult.failed + createResult.failed) + ' 个');
  console.log('========================================');
  console.log('');

  const totalFailed = closeResult.failed + createResult.failed;
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('');
  console.error('[FATAL] 未捕获的异常:');
  console.error(err.message);
  console.error(err.stack);
  process.exit(1);
});

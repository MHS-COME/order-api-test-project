#!/usr/bin/env node
/**
 * auto-create-bugs.js
 *
 * 读取 Newman JSON 报告，将失败断言自动创建为 TAPD 缺陷，
 * 并对本次已通过的用例自动关闭对应的历史缺陷。
 *
 * 用法:
 *   node auto-create-bugs.js                              # 默认读取 newman/report.json
 *   node auto-create-bugs.js --report <path>              # 读取单个报告
 *   node auto-create-bugs.js --reports-dir <dir>          # 读取目录下所有 *_report.json
 *
 * 配置: 复制 tapd-config.example.json → tapd-config.json 并填写真实凭证
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

// ── CLI 参数解析 ────────────────────────────────────────────
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

// ── 路径常量 ────────────────────────────────────────────────
const ROOT_DIR    = __dirname;
const CONFIG_FILE = path.join(ROOT_DIR, 'tapd-config.json');
const DEFAULT_RPT = path.join(ROOT_DIR, 'newman', 'report.json');
const SEEN_FILE   = path.join(ROOT_DIR, 'newman', '.reported-bugs.json');

// ── 1. 加载配置文件 ─────────────────────────────────────────
console.log('');
console.log('========================================');
console.log('  TAPD 缺陷自动创建 & 状态更新工具');
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

// 优先使用环境变量（CI），其次使用配置文件
const workspace_id   = process.env.TAPD_WORKSPACE_ID   || config.workspace_id;
const api_user       = process.env.TAPD_API_USER       || config.api_user;
const api_password   = process.env.TAPD_API_PASSWORD   || config.api_password;
const close_status   = process.env.TAPD_CLOSE_STATUS   || config.close_status   || 'resolved';
const bug_title_prefix = process.env.TAPD_TITLE_PREFIX || config.bug_title_prefix || '[AutoTest]';

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

console.log('  Config source : ' + (process.env.TAPD_WORKSPACE_ID ? 'env vars' : 'config file'));

console.log('  Workspace ID  : ' + workspace_id);
console.log('  API User      : ' + api_user);
console.log('  Close status  : ' + close_status);

// ── 1.5 加载已上报记录（去重） ───────────────────────────────
/** @type {Map<string, string>} signature -> bugId */
const reportedBugs = new Map();
try {
  if (fs.existsSync(SEEN_FILE)) {
    const seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
    for (const entry of seen) {
      reportedBugs.set(entry.signature, entry.bugId);
    }
    console.log('  Dedup cache   : ' + reportedBugs.size + ' known signature(s)');
  }
} catch (_) { /* missing or corrupt */ }

// ── 2. 读取 Newman JSON 报告（支持单文件或目录批量） ──────────

/**
 * 读取单个 Newman JSON 报告文件
 * @param {string} filePath
 * @returns {{name:string, executions:Array}}
 */
function readReportFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const rep = JSON.parse(raw);
  if (!rep.run || !rep.run.executions || !Array.isArray(rep.run.executions)) {
    throw new Error('格式异常：缺少 run.executions 数组');
  }
  return { name: path.basename(filePath), executions: rep.run.executions };
}

/** @type {Array<{name:string, executions:Array}>} */
const allReports = [];

if (REPORTS_DIR) {
  // ── 批量模式：读取目录下所有 *_report.json 文件 ──────────────
  if (!fs.existsSync(REPORTS_DIR)) {
    console.error('[ERROR] 报告目录不存在: ' + REPORTS_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('_report.json') || f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.error('[ERROR] 报告目录中没有找到 JSON 报告: ' + REPORTS_DIR);
    process.exit(1);
  }
  console.log('  Reports dir   : ' + REPORTS_DIR + ' (' + files.length + ' file(s))');
  for (const f of files) {
    const fp = path.join(REPORTS_DIR, f);
    try {
      allReports.push(readReportFile(fp));
    } catch (err) {
      console.error('[WARN] 跳过报告 ' + f + ': ' + err.message);
    }
  }
} else {
  // ── 单报告模式 ──────────────────────────────────────────────
  const target = REPORT_FILE || DEFAULT_RPT;
  if (!fs.existsSync(target)) {
    console.error('[ERROR] Newman 报告不存在: ' + target);
    console.error('  请先执行: newman run ... -r json --reporter-json-export ' + path.relative(ROOT_DIR, target));
    process.exit(1);
  }
  try {
    allReports.push(readReportFile(target));
  } catch (err) {
    console.error('[ERROR] 无法读取 Newman 报告: ' + err.message);
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

console.log('  Report files  : ' + allReports.length);
console.log('  Total execs   : ' + allExecutions.length);

// ── 覆写 report 变量以兼容后续代码 ────────────────────────────
const report = { run: { executions: allExecutions } };

// ── 3. 分类所有用例：通过 vs 失败 ────────────────────────────

/** @type {string[]} 所有断言均通过的用例名称 */
const passedNames = [];

/** @type {Array<{name:string, method:string, url:string, statusCode:number|string,
 *          requestBody:string, responseBody:string, assertions:Array<{name:string, error:string}>}>} */
const failedRequests = [];

for (const exec of report.run.executions) {
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
    assertions: failed.map(a => ({
      name:  a.assertion,
      error: (a.error && a.error.message) ? a.error.message : 'Unknown error'
    }))
  });
}

console.log('  Passed        : ' + passedNames.length);
console.log('  Failed        : ' + failedRequests.length);
console.log('========================================');
console.log('');

// ── 4. TAPD API 封装 ────────────────────────────────────────

const TAPD_HOST  = 'api.tapd.cn';
const TAPD_PORT  = 443;
const TAPD_TMOUT = 30000;

/**
 * 发起 TAPD API 请求
 * @param {'GET'|'POST'} method
 * @param {string} path      API 路径，如 '/bugs'
 * @param {object} [data]    POST 时的表单数据；GET 时拼接到 URL
 * @returns {Promise<object>} 解析后的 JSON 响应体
 */
function tapdRequest(method, path, data, _redirectCount) {
  const redirectCount = _redirectCount || 0;
  const MAX_REDIRECTS = 5;

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(api_user + ':' + api_password).toString('base64');

    let fullPath = path;
    let postData = null;

    if (method === 'GET' && data) {
      const qs = querystring.stringify(data);
      fullPath = path + (path.includes('?') ? '&' : '?') + qs;
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
      // 处理重定向 (3xx)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('重定向次数过多'));
          return;
        }
        // 消费响应体后递归跟随
        res.resume();
        const newPath = res.headers.location;
        // 从完整 URL 提取路径
        let parsedPath;
        if (newPath.startsWith('http')) {
          const u = new URL(newPath);
          parsedPath = u.pathname + u.search;
        } else {
          parsedPath = newPath;
        }
        resolve(tapdRequest(method, parsedPath, data, redirectCount + 1));
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

    req.on('error', (err) => {
      reject(new Error('网络请求失败: ' + err.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时 (' + (TAPD_TMOUT / 1000) + 's)'));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * 查询 TAPD 缺陷（按标题关键词模糊匹配）
 * @param {string} titleKeyword  标题搜索关键词
 * @param {string} [statusFilter] 状态筛选，如 "new|in_progress"
 * @returns {Promise<Array<{id:string, title:string, status:string}>>}
 */
function queryTapdBugs(titleKeyword, statusFilter) {
  console.log('  Query TAPD: title ~ "' + truncate(titleKeyword, 60) + '" ...');

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
    // 无匹配结果时 TAPD 可能返回 status=0 或空 data
    return [];
  });
}

/**
 * 更新 TAPD 缺陷状态
 * @param {string} bugId     缺陷 ID
 * @param {string} newStatus 新状态，如 "resolved"
 * @param {string} [comment] 可选备注
 * @returns {Promise<{id:string}>}
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

  // TAPD 更新与创建使用同一个 POST /bugs 端点，带 id 即为更新
  return tapdRequest('POST', '/bugs', data).then(resp => {
    // TAPD 更新成功时 status=1 即可，不一定返回 Bug 对象
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
 * @param {string} description 缺陷描述（TAPD wiki 格式）
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

// ── 5. 构建缺陷描述 ─────────────────────────────────────────

/**
 * @param {object} f 失败请求对象
 * @returns {string} TAPD wiki 格式描述
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

function escapePipe(s) { return String(s).replace(/\|/g, '\\|'); }
function escapeWiki(s) { return String(s).replace(/\{/g, '\\{').replace(/\}/g, '\\}'); }
function truncate(s, max) {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  return str.length <= max ? str : str.substring(0, max) + '…[truncated]';
}

// ── 6. 去重签名 ──────────────────────────────────────────────
function buildSignature(f) {
  const assertionNames = f.assertions.map(a => a.name).sort().join(';');
  return f.name + '::' + assertionNames;
}

// ── 7. 自动关闭已通过的缺陷 ──────────────────────────────────

/**
 * 对于本次运行已通过的用例，查询 TAPD 中是否存在对应的未关闭缺陷，
 * 若有，则将其状态更新为 close_status（默认 "resolved"）。
 *
 * 匹配规则：TAPD 缺陷标题以 `[AutoTest] <用例名称>` 开头。
 *
 * @returns {Promise<{closed:number, failed:number}>}
 */
async function autoClosePassedBugs() {
  if (passedNames.length === 0) {
    console.log('[AUTO-CLOSE] 没有已通过的用例，跳过。');
    console.log('');
    return { closed: 0, failed: 0 };
  }

  // 去重：同一个用例可能在报告中出现多次（如数据驱动），只处理唯一的
  const uniqueNames = [...new Set(passedNames)];
  console.log('[AUTO-CLOSE] 检查 ' + uniqueNames.length + ' 个唯一已通过用例的历史缺陷...');
  console.log('');

  let closed = 0;
  let failed = 0;

  for (let i = 0; i < uniqueNames.length; i++) {
    const testName = uniqueNames[i];
    const prefix   = '[' + (i + 1) + '/' + uniqueNames.length + ']';

    try {
      // 搜索 TAPD 中标题以 "[AutoTest] <testName>" 开头的未关闭缺陷
      const existingBugs = await queryTapdBugs(
        bug_title_prefix + ' ' + testName,
        'new|in_progress'           // 只查未关闭的
      );

      if (existingBugs.length === 0) {
        console.log(prefix + ' [SKIP] 无未关闭缺陷 — ' + testName);
        continue;
      }

      // 逐个更新状态
      for (const bug of existingBugs) {
        const bugId = bug.id;
        const comment = '本次自动化测试已通过，自动关闭。\n用例: ' + testName +
                        '\n时间: ' + new Date().toISOString();

        try {
          await updateBugStatus(bugId, close_status, comment);
          console.log(prefix + ' [CLOSED] Bug #' + bugId +
                      ' → ' + close_status + ' — ' + truncate(bug.title, 50));
          closed++;
        } catch (err) {
          console.error(prefix + ' [FAIL] Bug #' + bugId + ' 更新失败: ' + err.message);
          failed++;
        }

        // API 限流保护
        await sleep(300);
      }
    } catch (err) {
      console.error(prefix + ' [FAIL] 查询 TAPD 失败 (' + testName + '): ' + err.message);
      failed++;
    }

    // 每个用例之间稍作停顿
    if (i < uniqueNames.length - 1) {
      await sleep(200);
    }
  }

  console.log('');
  console.log('[AUTO-CLOSE] 完成: ' + closed + ' 个关闭, ' + failed + ' 个失败');
  console.log('========================================');
  console.log('');
  return { closed, failed };
}

// ── 8. 主流程 ────────────────────────────────────────────────

async function main() {

  // ── 8a. 先自动关闭已通过用例的缺陷 ──────────────────────────
  autoCloseResult = await autoClosePassedBugs();

  // ── 8b. 为失败用例创建缺陷（带去重） ────────────────────────
  if (failedRequests.length === 0) {
    console.log('[OK] 所有测试用例均已通过，无需创建缺陷。');
    process.exit(0);
  }

  let created = 0;
  let skipped = 0;
  let failed  = 0;
  let total   = 0;

  for (let i = 0; i < failedRequests.length; i++) {
    const f   = failedRequests[i];
    const sig = buildSignature(f);

    // 去重检查
    if (reportedBugs.has(sig)) {
      console.log('[' + (i + 1) + '/' + failedRequests.length + '] [SKIP] Already Bug #' + reportedBugs.get(sig) + ' — ' + f.name);
      skipped++;
      continue;
    }

    total++;
    const firstErr = f.assertions[0];
    const title = bug_title_prefix + ' ' + f.name + ' — ' + firstErr.name;

    console.log('[' + (i + 1) + '/' + failedRequests.length + '] ' + title);

    try {
      const bug = await createTapdBug(title, buildDescription(f));
      console.log('  [OK] 缺陷已创建 → Bug #' + bug.id);
      reportedBugs.set(sig, bug.id);
      created++;
    } catch (err) {
      console.error('  [FAIL] ' + err.message);
      failed++;
    }

    // API 限流保护：每个请求间隔 500ms
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
  console.log('========================================');
  console.log('  执行完成');
  console.log('    关闭 : ' + (typeof autoCloseResult !== 'undefined' ? autoCloseResult.closed : 'N/A'));
  console.log('    创建 : ' + created);
  console.log('    跳过 : ' + skipped);
  console.log('    失败 : ' + failed);
  console.log('    总计 : ' + failedRequests.length);
  console.log('========================================');

  const totalFailed = failed + (typeof autoCloseResult !== 'undefined' ? autoCloseResult.failed : 0);
  process.exit(totalFailed > 0 ? 1 : 0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// kick-off
let autoCloseResult = { closed: 0, failed: 0 };
main().catch(err => {
  console.error('[FATAL] ' + err.message);
  console.error(err.stack);
  process.exit(1);
});

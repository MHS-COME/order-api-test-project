#!/usr/bin/env node
/**
 * newman-to-allure.js
 *
 * 将 Newman JSON 报告转换为 Allure result.json 格式，供 Allure CLI 生成 HTML 报告。
 *
 * 输入:  newman/report.json (默认)  或  newman/reports/*.json (批量)
 * 输出:  allure-results/ 目录下的 *.result.json 文件
 *
 * 用法:
 *   node newman-to-allure.js                              # 默认读取 newman/report.json
 *   node newman-to-allure.js --report <path>              # 读取单个报告文件
 *   node newman-to-allure.js --reports-dir <dir>          # 读取目录下所有 .json 文件并合并
 *
 * 安装 Allure 命令行工具 (Windows):
 *   1. 安装 Scoop:         powershell -c "irm get.scoop.sh | iex"
 *   2. 安装 Allure:        scoop install allure
 *   或手动下载:             https://github.com/allure-framework/allure2/releases
 *   解压后将 bin/ 目录加入 PATH 环境变量。
 *
 * 生成 Allure HTML 报告:
 *   1. node newman-to-allure.js
 *   2. allure generate allure-results/ -o allure-report/ --clean
 *   3. allure open allure-report/
 *
 * 无额外 npm 依赖, 只使用 Node.js 内置模块。
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── CLI 参数解析 ────────────────────────────────────────
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

const ROOT_DIR    = __dirname;
const DEFAULT_RPT = path.join(ROOT_DIR, 'newman', 'report.json');
const OUTPUT_DIR  = path.join(ROOT_DIR, 'allure-results');

// ── 工具函数 ────────────────────────────────────────────

/** 生成符合 UUID v4 格式的字符串 (无依赖) */
function generateUUID() {
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4'; // version 4
    } else if (i === 19) {
      uuid += hex[Math.floor(Math.random() * 4) + 8]; // variant 8-b
    } else {
      uuid += hex[Math.floor(Math.random() * 16)];
    }
  }
  return uuid;
}

/** 将字符串转为 historyId 友好格式 (小写 + 去特殊字符) */
function toHistoryId(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'unknown';
}

/** 获取当前毫秒时间戳 */
function now() { return Date.now(); }

/**
 * 从用例名称中提取模块 (suite) 名。
 * 命名约定: "模块前缀-编号 描述" 或 "模块名-编号 描述"
 * 如 "01-登录模块-TC-LOGIN-001 ..." → "01-登录模块"
 */
function extractSuiteName(testName, allNames) {
  if (!testName) return 'Default Suite';

  // 尝试匹配 "01-xxx" / "02-xxx" / "TC-xxx-xxx" 等前缀
  const m = testName.match(/^(\d{2}-[^-\s]+)/);
  if (m) return m[1];

  // 尝试匹配 TC-XXX-NNN 用例编号
  const m2 = testName.match(/^(TC-[A-Z]+-\d+)/);
  if (m2) return m2[1];

  // 尝试匹配中文模块名
  const m3 = testName.match(/^([^-]+模块)/);
  if (m3) return m3[1];

  return 'Default Suite';
}

/**
 * 读取单个 Newman JSON 报告
 * @returns {{name:string, executions:Array, collectionName:string}}
 */
function readNewmanReport(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const obj = JSON.parse(raw);

  let executions = [];
  let collectionName = path.basename(filePath, '.json');

  // Newman 报告结构: { run: { executions: [...] } }
  // 也可能直接是 { collection: { info: { name } }, run: { executions: [] } }
  if (obj.run && obj.run.executions && Array.isArray(obj.run.executions)) {
    executions = obj.run.executions;
  } else {
    throw new Error('格式异常: 找不到 run.executions 数组');
  }

  // 尝试读取 collection 名称
  if (obj.collection && obj.collection.info && obj.collection.info.name) {
    collectionName = obj.collection.info.name;
  }

  return { name: path.basename(filePath), executions, collectionName };
}

// ── 主逻辑 ──────────────────────────────────────────────

console.log('');
console.log('========================================');
console.log('  Newman → Allure 报告转换器');
console.log('========================================');

// 1. 收集所有 Newman 报告
/** @type {Array<{name:string, executions:Array, collectionName:string}>} */
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
    console.error('[ERROR] 报告目录中没有找到 JSON 文件: ' + REPORTS_DIR);
    process.exit(1);
  }
  console.log('  Reports dir : ' + REPORTS_DIR + ' (' + files.length + ' file(s))');
  for (const f of files) {
    const fp = path.join(REPORTS_DIR, f);
    try {
      allReports.push(readNewmanReport(fp));
    } catch (err) {
      console.error('[WARN] 跳过 ' + f + ': ' + err.message);
    }
  }
} else {
  const target = REPORT_FILE || DEFAULT_RPT;
  if (!fs.existsSync(target)) {
    console.error('[ERROR] Newman 报告文件不存在: ' + target);
    console.error('  请先执行: newman run postman/collections/*.json -r json --reporter-json-export ' + path.relative(ROOT_DIR, target));
    process.exit(1);
  }
  try {
    allReports.push(readNewmanReport(target));
  } catch (err) {
    console.error('[ERROR] 无法读取报告: ' + err.message);
    process.exit(1);
  }
}

// 2. 合并所有执行记录
/** @type {Array} */
const allExecutions = [];
for (const rep of allReports) {
  for (const exec of rep.executions) {
    // 把 collection 名称附上去
    exec._collectionName = rep.collectionName;
    allExecutions.push(exec);
  }
}

console.log('  Report files : ' + allReports.length);
console.log('  Total tests  : ' + allExecutions.length);

if (allExecutions.length === 0) {
  console.error('[ERROR] 没有找到任何测试执行记录');
  process.exit(1);
}

// 3. 收集所有用例名称（用于后续 suite 分组）
const allTestNames = allExecutions.map(e => (e.item && e.item.name) || 'Unknown');

// 4. 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
console.log('  Output dir   : ' + OUTPUT_DIR);

// 5. 逐个转换
let passedCount  = 0;
let failedCount  = 0;
let brokenCount  = 0;
let skippedCount = 0;
let writtenCount = 0;

for (let i = 0; i < allExecutions.length; i++) {
  const exec     = allExecutions[i];
  const item     = exec.item     || {};
  const request  = exec.request  || {};
  const response = exec.response || {};
  const testName = item.name || ('Test #' + (i + 1));
  const collectionName = exec._collectionName || 'Unknown Collection';

  // 判断状态
  const assertions = exec.assertions || [];
  const failedAsserts = assertions.filter(a => a.error);
  let status, statusDetailMessage;

  if (response.code === 0 || !response.code) {
    // 请求未发出 (脚本跳过)
    status = 'skipped';
    skippedCount++;
    statusDetailMessage = '请求未发出或被跳过';
  } else if (failedAsserts.length === 0) {
    status = 'passed';
    passedCount++;
    statusDetailMessage = null;
  } else if (assertions.every(a => a.error)) {
    status = 'failed';
    failedCount++;
    statusDetailMessage = failedAsserts.map(a =>
      `- ${a.assertion}: ${(a.error && a.error.message) || 'Unknown error'}`
    ).join('\n');
  } else {
    status = 'failed';
    failedCount++;
    statusDetailMessage = failedAsserts.length + ' of ' + assertions.length +
      ' assertions failed:\n' +
      failedAsserts.map(a =>
        `- ${a.assertion}: ${(a.error && a.error.message) || 'Unknown error'}`
      ).join('\n');
  }

  // 构造 suite 名 (优先用用例名称中的模块前缀)
  const suiteName = extractSuiteName(testName, allTestNames);

  // 构造 Allure result
  const startTime = now() - 1000; // 用 1 秒前作为开始时间
  const stopTime  = now();

  // 构造步骤 (每个断言对应一个 step)
  /** @type {Array} */
  const steps = assertions.map((a, idx) => {
    const stepFailed = !!a.error;
    return {
      name: a.assertion || ('Assertion #' + (idx + 1)),
      status: stepFailed ? 'failed' : 'passed',
      stage: 'finished',
      description: stepFailed ? ((a.error && a.error.message) || 'Assertion failed') : null,
      statusDetails: stepFailed ? {
        message: (a.error && a.error.message) || 'Assertion failed',
        trace: (a.error && a.error.message) || ''
      } : {},
      start: startTime + idx,
      stop: stopTime + idx,
    };
  });

  // 添加请求/响应信息作为附件步骤
  const reqSummary = `${request.method || 'GET'} ${(request.url && request.url.raw) || 'N/A'}`;
  steps.unshift({
    name: 'HTTP Request: ' + reqSummary,
    status: status === 'skipped' ? 'skipped' : 'passed',
    stage: 'finished',
    start: startTime,
    stop: startTime + 1,
  });

  steps.push({
    name: 'Response: HTTP ' + (response.code || 'N/A'),
    status: status,
    stage: 'finished',
    description: 'Response status code: ' + (response.code || 'N/A'),
    start: stopTime - 1,
    stop: stopTime,
  });

  // 构造请求体和响应体附件名
  const attachments = [];
  if (request.body && request.body.raw) {
    const attachName = 'request-body-' + toHistoryId(testName) + '.json';
    // 把请求体写到附件文件
    let reqBodyStr = request.body.raw;
    if (typeof reqBodyStr === 'object') reqBodyStr = JSON.stringify(reqBodyStr, null, 2);
    fs.writeFileSync(path.join(OUTPUT_DIR, attachName), reqBodyStr, 'utf-8');
    attachments.push({
      name: 'Request Body',
      source: attachName,
      type: 'application/json',
    });
  }

  let respBodyStr = typeof response.body === 'string'
    ? response.body
    : (response.body ? JSON.stringify(response.body, null, 2) : '');
  if (respBodyStr && respBodyStr.length > 0) {
    const attachName = 'response-body-' + toHistoryId(testName) + '.json';
    fs.writeFileSync(path.join(OUTPUT_DIR, attachName), respBodyStr, 'utf-8');
    attachments.push({
      name: 'Response Body',
      source: attachName,
      type: 'application/json',
    });
  }

  const uuid = generateUUID();
  const historyId = toHistoryId('OrderAPI-' + suiteName + '-' + testName);
  const fullName = collectionName + '.' + testName;

  const allureResult = {
    name: testName,
    status: status,
    statusDetails: statusDetailMessage ? { message: statusDetailMessage, trace: '' } : {},
    stage: 'finished',
    description: 'Method: ' + (request.method || 'GET') + '\nURL: ' + reqSummary,
    steps: steps,
    attachments: attachments,
    parameters: [],
    start: startTime,
    stop: stopTime,
    uuid: uuid,
    historyId: historyId,
    fullName: fullName,
    labels: [
      { name: 'suite',     value: suiteName },
      { name: 'testType',  value: 'api' },
      { name: 'framework', value: 'Postman/Newman' },
      { name: 'language',  value: 'javascript' },
      { name: 'host',      value: 'localhost' },
    ],
    links: [],
  };

  // 写出文件
  const fileName = uuid + '-result.json';
  fs.writeFileSync(
    path.join(OUTPUT_DIR, fileName),
    JSON.stringify(allureResult, null, 2),
    'utf-8'
  );
  writtenCount++;
}

// 6. 输出统计信息
console.log('');
console.log('========================================');
console.log('  转换完成');
console.log('    结果文件 : ' + writtenCount + ' 个');
console.log('    通过     : ' + passedCount);
console.log('    失败     : ' + failedCount);
console.log('    中断     : ' + brokenCount);
console.log('    跳过     : ' + skippedCount);
console.log('    输出目录 : ' + OUTPUT_DIR);
console.log('========================================');
console.log('');
console.log('下一步:');
console.log('  allure generate ' + OUTPUT_DIR + ' -o allure-report --clean');
console.log('  allure open allure-report');
console.log('');

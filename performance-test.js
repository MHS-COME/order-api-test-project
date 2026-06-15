import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

/**
 * OrderAPI 性能测试脚本
 *
 * 模拟典型用户流程: 登录 → 创建订单 → 支付
 * 使用 k6 stages 爬坡模式逐步增加并发
 *
 * 安装 k6 (选一种):
 *   Windows (Chocolatey):   choco install k6
 *   Windows (winget):       winget install k6
 *   Windows (手动):         下载 https://dl.k6.io/msi/k6-latest-amd64.msi 并安装
 *   macOS:                  brew install k6
 *   Linux:                  sudo apt install k6 / sudo gpg install ...
 *
 * 运行:
 *   1. 先启动 Mock 服务:  cd mock-server && node server.js
 *   2. 运行本脚本:        k6 run performance-test.js
 *   3. 输出 JSON 报告:    k6 run performance-test.js --out json=results.json
 *   4. 输出 HTML 报告:    k6 run performance-test.js --summary-export=summary.json
 */

// ── 自定义指标 ────────────────────────────────────────
const loginDuration  = new Trend('login_duration_ms');
const orderDuration  = new Trend('order_create_duration_ms');
const payDuration    = new Trend('payment_duration_ms');
const endToEndTime   = new Trend('e2e_flow_duration_ms');
const businessFailRate = new Rate('business_fail_rate');

// ── k6 配置 ───────────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s', target: 20 },  // 0 → 20 VU, 爬坡 30 秒
    { duration: '1m',  target: 20 },  // 保持 20 VU 跑 1 分钟
    { duration: '30s', target: 0  },  // 20 → 0 VU, 下降 30 秒
  ],

  thresholds: {
    // p95 响应时间 < 2000ms
    http_req_duration:    ['p(95)<2000'],
    // 失败率 < 10%
    http_req_failed:      ['rate<0.1'],
    // 登录 p95 < 1000ms
    login_duration_ms:    ['p(95)<1000'],
    // 支付 p95 < 1000ms
    payment_duration_ms:  ['p(95)<1000'],
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)'],
};

// ── 测试常量 ──────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// ── 主测试函数 ───────────────────────────────────────
export default function () {
  const vuId = __VU;       // 虚拟用户编号
  const iterId = __ITER;   // 当前 VU 的迭代次数

  // 每个虚拟用户使用唯一的标记，避免同名账号冲突
  const username = 'testuser';
  const password = 'Test@123456';

  const headers = { 'Content-Type': 'application/json' };

  let token, orderId, totalAmount;
  const flowStart = Date.now();

  // ════════════════════════════════════════════════════
  // Step 1: 登录
  // ════════════════════════════════════════════════════
  group('01_Login', function () {
    const start = Date.now();

    const res = http.post(
      `${BASE_URL}/login`,
      JSON.stringify({ username, password }),
      { headers, tags: { name: 'Login' } }
    );

    loginDuration.add(Date.now() - start);

    const passed = check(res, {
      'Login | status 200':               (r) => r.status === 200,
      'Login | response time < 2000ms':   (r) => r.timings.duration < 2000,
      'Login | code = 0 (business OK)':   (r) => {
        try { return r.json().code === 0; } catch (_) { return false; }
      },
      'Login | token present':            (r) => {
        try {
          const d = r.json().data;
          return d && typeof d.token === 'string' && d.token.length > 10;
        } catch (_) { return false; }
      },
    });

    businessFailRate.add(!passed);

    if (!passed) {
      console.error(`VU#${vuId} 登录失败: HTTP ${res.status} body=${res.body.substring(0, 200)}`);
      return; // 登录失败则跳过后续步骤
    }

    const body = res.json();
    token = body.data.token;
  });

  if (!token) return;

  // ════════════════════════════════════════════════════
  // Step 2: 创建订单
  // ════════════════════════════════════════════════════
  group('02_CreateOrder', function () {
    const start = Date.now();

    const res = http.post(
      `${BASE_URL}/orders`,
      JSON.stringify({
        productId: 5001,
        quantity: 1,
        addressId: 100,
        remark: `perf-test-vu${__VU}-iter${__ITER}`
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        tags: { name: 'CreateOrder' }
      }
    );

    orderDuration.add(Date.now() - start);

    const passed = check(res, {
      'CreateOrder | status 201':          (r) => r.status === 201,
      'CreateOrder | response time < 2000ms': (r) => r.timings.duration < 2000,
      'CreateOrder | code = 0':            (r) => {
        try { return r.json().code === 0; } catch (_) { return false; }
      },
      'CreateOrder | status = PENDING':    (r) => {
        try { return r.json().data.status === 'PENDING'; } catch (_) { return false; }
      },
      'CreateOrder | orderId present':     (r) => {
        try {
          const d = r.json().data;
          return d && typeof d.orderId === 'number' && d.orderId > 0;
        } catch (_) { return false; }
      },
    });

    businessFailRate.add(!passed);

    if (!passed) {
      console.error(`VU#${vuId} 创建订单失败: HTTP ${res.status}`);
      return;
    }

    const body = res.json();
    orderId     = body.data.orderId;
    totalAmount = body.data.totalAmount;
  });

  if (!orderId) return;

  // ════════════════════════════════════════════════════
  // Step 3: 支付订单
  // ════════════════════════════════════════════════════
  group('03_PayOrder', function () {
    const start = Date.now();

    const res = http.post(
      `${BASE_URL}/payment`,
      JSON.stringify({
        orderId: orderId,
        amount: totalAmount,
        paymentMethod: 'card'
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        tags: { name: 'PayOrder' }
      }
    );

    payDuration.add(Date.now() - start);
    endToEndTime.add(Date.now() - flowStart);

    const passed = check(res, {
      'PayOrder | status 200':             (r) => r.status === 200,
      'PayOrder | response time < 2000ms': (r) => r.timings.duration < 2000,
      'PayOrder | code = 0':               (r) => {
        try { return r.json().code === 0; } catch (_) { return false; }
      },
      'PayOrder | status = PAID':          (r) => {
        try { return r.json().data.status === 'PAID'; } catch (_) { return false; }
      },
      'PayOrder | transactionId starts with TXN': (r) => {
        try { return r.json().data.transactionId.startsWith('TXN'); } catch (_) { return false; }
      },
    });

    businessFailRate.add(!passed);

    if (!passed) {
      console.error(`VU#${vuId} 支付失败: HTTP ${res.status} body=${res.body.substring(0, 200)}`);
    }
  });

  // 每个 VU 每次迭代间隔 1 秒，模拟真实用户行为
  sleep(1);
}

// ── 测试报告摘要（会在 k6 输出后附在底部） ─────────
export function handleSummary(data) {
  // k6 内置指标摘要
  const summary = {
    timestamp: new Date().toISOString(),
    test_config: {
      stages: options.stages,
      base_url: BASE_URL,
    },
    metrics: {
      http_req_duration: {
        avg_ms:  data.metrics.http_req_duration?.values?.avg?.toFixed(2),
        p95_ms:  data.metrics.http_req_duration?.values['p(95)']?.toFixed(2),
        p99_ms:  data.metrics.http_req_duration?.values['p(99)']?.toFixed(2),
        max_ms:  data.metrics.http_req_duration?.values?.max?.toFixed(2),
      },
      http_reqs: {
        total:    data.metrics.http_reqs?.values?.count,
        rate:     (data.metrics.http_reqs?.values?.rate || 0).toFixed(2) + ' req/s',
      },
      http_req_failed: {
        rate:     ((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2) + '%',
      },
      virtual_users: {
        max:      data.metrics.vus_max?.values?.value,
      },
      business_checks: {
        fail_rate: ((businessFailRate?.value || 0) * 100).toFixed(2) + '%',
      },
    },
    custom_trends: {
      login_duration_ms: {
        avg: data.metrics.login_duration_ms?.values?.avg?.toFixed(2),
        p95: data.metrics.login_duration_ms?.values['p(95)']?.toFixed(2),
      },
      order_create_duration_ms: {
        avg: data.metrics.order_create_duration_ms?.values?.avg?.toFixed(2),
        p95: data.metrics.order_create_duration_ms?.values['p(95)']?.toFixed(2),
      },
      payment_duration_ms: {
        avg: data.metrics.payment_duration_ms?.values?.avg?.toFixed(2),
        p95: data.metrics.payment_duration_ms?.values['p(95)']?.toFixed(2),
      },
      e2e_flow_duration_ms: {
        avg: data.metrics.e2e_flow_duration_ms?.values?.avg?.toFixed(2),
        p95: data.metrics.e2e_flow_duration_ms?.values['p(95)']?.toFixed(2),
      },
    },
  };

  return {
    'stdout': `\n
========================================
  OrderAPI 性能测试报告摘要
========================================
  总请求数 : ${summary.metrics.http_reqs.total}
  请求速率 : ${summary.metrics.http_reqs.rate}
  失败率   : ${summary.metrics.http_req_failed.rate}
  最大并发 : ${summary.metrics.virtual_users.max}

  HTTP 响应时间 (ms):
    avg : ${summary.metrics.http_req_duration.avg_ms}
    p95 : ${summary.metrics.http_req_duration.p95_ms}
    p99 : ${summary.metrics.http_req_duration.p99_ms}
    max : ${summary.metrics.http_req_duration.max_ms}

  登录接口 (ms): avg=${summary.custom_trends.login_duration_ms.avg}  p95=${summary.custom_trends.login_duration_ms.p95}
  创建订单 (ms): avg=${summary.custom_trends.order_create_duration_ms.avg}  p95=${summary.custom_trends.order_create_duration_ms.p95}
  支付接口 (ms): avg=${summary.custom_trends.payment_duration_ms.avg}  p95=${summary.custom_trends.payment_duration_ms.p95}
  全链路   (ms): avg=${summary.custom_trends.e2e_flow_duration_ms.avg}  p95=${summary.custom_trends.e2e_flow_duration_ms.p95}
========================================
`,
    // 同时导出 JSON 文件供 CI 解析
    'performance-summary.json': JSON.stringify(summary, null, 2),
  };
}

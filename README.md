# OrderAPI Test Platform

全链路订单系统 API 自动化测试 + UI 自动化测试平台，覆盖认证、下单、支付、取消完整业务闭环，集成性能压测、专业报告、缺陷双向同步。

[![CI Status](https://github.com/MHS-COME/order-api-test-project/actions/workflows/api-tests.yml/badge.svg)](https://github.com/MHS-COME/order-api-test-project/actions/workflows/api-tests.yml)

## 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| Mock 后端 | Node.js, Express, jsonwebtoken, lowdb | JWT 双 token 认证 + 订单/支付 REST API |
| API 测试 | Postman, Newman, newman-reporter-html | 模块化接口测试，CSV 数据驱动 |
| UI 测试 | Selenium WebDriver, pytest, webdriver-manager | Web 端注册/登录/下单/支付流程自动化 |
| 性能测试 | k6 | 渐进式压测，自定义指标 + 阈值告警 |
| 测试报告 | Allure, Newman HTML | 专业可视化报告，历史趋势追踪 |
| 缺陷管理 | TAPD API | 失败自动建 Bug，通过自动关闭（双向同步） |
| CI/CD | GitHub Actions | 推送即跑，制品留存 30 天 |
| 前端 | 原生 HTML/CSS/JS (SPA) | 订单管理仪表盘，侧边栏多页面导航 |

## 项目结构

```
OrderAPITestProject/
├── .github/workflows/
│   └── api-tests.yml              # CI 流水线（6 模块 + TAPD 同步）
├── mock-server/
│   ├── server.js                  # Express 自定义路由 + JWT 鉴权中间件
│   ├── db.json                    # 种子数据（6 用户 + 10 订单，覆盖各类状态）
│   └── package.json               # Node 依赖（json-server, jsonwebtoken）
├── postman/
│   ├── order_api_collection.json  # 完整测试集合（36 请求，191 断言）
│   ├── collections/               # 6 个拆分模块（CI 分步执行）
│   ├── data/                      # CSV 数据驱动文件（login_data, order_data）
│   └── environments/              # 环境变量（base_url, auth_token 等）
├── frontend/
│   └── index.html                 # SPA 管理端 v2.1（仪表盘 + 7 功能页面）
├── selenium_tests/
│   ├── test_ui.py                 # 21 个 UI 自动化用例（8 个测试类）
│   ├── conftest.py                # pytest 夹具 + WebDriver 生命周期管理
│   └── requirements.txt           # Python 依赖
├── docs/
│   ├── 需求分析.md                 # 接口规格与业务状态码定义
│   ├── 测试计划.md                 # 测试策略、资源安排、风险应对
│   ├── 测试用例.md                 # 详细测试用例（等价类 + 边界值）
│   └── 测试报告.md                 # 测试执行报告模板
├── performance-test.js            # k6 压测脚本（3 阶段渐进式）
├── newman-to-allure.js            # Newman JSON → Allure 结果转换
├── auto-create-bugs.js            # TAPD 双向缺陷同步（自动提单 + 自动关闭）
├── run.bat                        # 统一入口（--push / --server 模式）
├── tapd-config.example.json       # TAPD 凭证模板
├── PRINCIPLES.md                  # 项目设计原则与维护指南
├── 面试准备文档.md                 # 面试 Q&A + 知识点梳理
└── README.md
```

## 快速开始

### 环境要求

| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 16.x | Mock 服务 + Newman |
| Python | ≥ 3.9 | Selenium UI 测试 |
| Chrome | 最新稳定版 | Selenium WebDriver |
| k6 | ≥ 0.50 | 性能测试（可选） |
| Allure | ≥ 2.33 | 报告生成（可选） |

### 1. 克隆并安装依赖

```bash
git clone https://github.com/MHS-COME/order-api-test-project.git
cd order-api-test-project

# Node 依赖（Mock 服务 + 全局工具）
cd mock-server && npm install && cd ..
npm install -g newman newman-reporter-html

# Python 依赖（Selenium）
cd selenium_tests && pip install -r requirements.txt && cd ..
```

### 2. 启动 Mock 服务

```bash
cd mock-server
node server.js
# → http://localhost:3000  |  测试账号: testuser / Test@123456
```

新开一个终端确认服务正常：

```bash
curl http://localhost:3000/health
```

### 3. 运行 API 测试

```bash
# 方式一：统一入口（推荐）
run.bat                  # 重置数据 → 运行测试 → HTML 报告

# 方式二：Newman CLI
newman run postman/order_api_collection.json ^
  -e postman/environments/dev.environment.json ^
  -r cli,html ^
  --reporter-html-export newman/report.html
```

### 4. 运行 UI 测试

```bash
cd selenium_tests

# 全部用例
pytest test_ui.py -v

# 指定模块
pytest test_ui.py -v -k "TestLoginUI"
pytest test_ui.py -v -k "TestOrderListUI"

# 无头模式（CI）
pytest test_ui.py -v --headless
```

## 测试模块说明

### API 测试（Postman / Newman）

| 模块 | 文件 | 用例数 | 说明 |
|------|------|--------|------|
| 00-注册 | `00-注册模块` | 5 | 正向注册 + 边界值 + 重复用户名 |
| 01-登录 | `01-登录模块` | 10 | DDT 数据驱动，7 次迭代 × 11 请求 |
| 02-订单 | `02-订单模块` | 13 | 创建/查询/取消，6 次迭代 × 35 请求 |
| 03-E2E | `03-端到端E2E` | 5 | 登录→创建→支付→查询完整链路 |
| 04-支付 | `04-支付模块` | 8 | 正向支付 + 金额校验 + 超时检测 |
| 05-安全 | `05-安全测试模块` | 14 | SQL注入/XSS/越权/JWT攻击/参数污染 |

> **合计：36 请求，46 测试脚本，191 断言**

### UI 测试（Selenium / pytest）

| 测试类 | 用例数 | 覆盖场景 |
|--------|--------|----------|
| TestLoginUI | 3 | 正向登录、错误密码、空字段提示 |
| TestRegisterUI | 2 | 注册成功、用户名过短校验 |
| TestCreateOrderUI | 2 | 创建订单、未登录拦截 |
| TestOrderListUI | 5 | 列表加载、状态标签、支付按钮跳转、取消弹窗确认 |
| TestCancelBoundary | 2 | PAID 订单拒止取消、CANCELLED 重复取消拒止 |
| TestPaymentUI | 2 | 正向支付、空订单号校验 |
| TestFullE2E | 1 | 登录→创建→支付→列表确认 全链路 |
| TestNavigation | 1 | 侧边栏 7 页面切换 |
| TestDashboard | 2 | 统计卡片、健康检查 |

> **合计：21 个 UI 自动化用例，覆盖关键用户旅程**

### 性能测试（k6）

```bash
k6 run performance-test.js
```

- **3 阶段渐进式**：30s 爬坡 → 1min 20 VU 保持 → 30s 下降
- **自定义指标**：login / order_create / payment / e2e_flow 耗时
- **阈值告警**：p95 < 2000ms（总请求），p95 < 1000ms（登录/支付）

## 核心亮点

1. **JWT 双 token 认证** — access token（1h）+ refresh token（7d），auth 中间件统一拦截 `/orders/*` 和 `/payment/*`
2. **支付幂等性与超时关闭** — 已支付订单拒绝重复支付（code=4005），创建超 30 分钟自动关闭（code=4004）
3. **数据驱动测试** — CSV 文件驱动登录和订单模块，覆盖多组用户名/密码/商品/数量的正交组合
4. **安全测试全覆盖** — SQL 注入、XSS 脚本注入、越权访问、JWT 算法篡改/none 算法/签名缺失
5. **全自动缺陷闭环** — CI 执行后自动：失败用例 → TAPD 建 Bug（含去重）；通过用例 → 自动关闭历史 Bug
6. **Allure 专业报告** — `newman-to-allure.js` 将 Newman 结果转为 Allure 格式，支持历史趋势和附件
7. **Selenium UI 自动化** — 21 个用例覆盖 Web 端完整用户旅程，含边界状态（PAID 不能取消、CANCELLED 不可操作）
8. **模块化测试组织** — API 测试 6 模块独立可运行，CI 分步执行互不影响（`continue-on-error: true`）

## 生成 Allure 报告

```bash
# 1. 先跑 Newman 生成 JSON 报告
newman run postman/order_api_collection.json ^
  -e postman/environments/dev.environment.json ^
  -r json --reporter-json-export newman/results.json

# 2. 转换为 Allure 结果
node newman-to-allure.js --report newman/results.json

# 3. 生成 Allure HTML 报告
allure generate allure-results -o allure-report --clean

# 4. 打开报告
allure open allure-report
```

## GitHub CI 配置

项目已配置 `.github/workflows/api-tests.yml`，push 到 `main` 或 PR 时自动运行 6 个测试模块。

### Secrets 配置

如需 TAPD 缺陷同步功能，在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 说明 |
|--------|------|
| `TAPD_WORKSPACE_ID` | TAPD 项目 ID（URL 中 `workspaces/` 后的数字） |
| `TAPD_API_USER` | TAPD API 账号 |
| `TAPD_API_PASSWORD` | TAPD API 密码（与登录密码不同，需在开放平台申请） |

CI 最后一步会自动完成失败建 Bug + 通过关 Bug 的双向同步。

## TAPD 本地使用

```bash
# 1. 复制配置模板
copy tapd-config.example.json tapd-config.json

# 2. 编辑 tapd-config.json 填入真实凭证

# 3. 运行测试 + 推送缺陷
run.bat --push

# 或者先自己跑 Newman，再推送已有报告
node auto-create-bugs.js --report newman/report.json
```

---

**作者：** 马洪顺 — 独立设计与开发

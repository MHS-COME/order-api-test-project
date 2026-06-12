# OrderAPITest 设计原则

## 1. 架构总览

```
OrderAPITestProject/
├── mock-server/              # json-server 模拟后端
│   ├── server.js             # 自定义路由 + JWT 鉴权
│   ├── db.json               # 种子数据（4 用户 + 4 订单）
│   └── package.json
├── postman/                  # Postman 测试集合
│   ├── order_api_collection.json  # 36 请求, 191 断言
│   └── dev.environment.json       # 环境变量 (base_url, token 等)
├── auto-create-bugs.js        # Newman 报告 → TAPD 缺陷
├── run.bat                    # 统一入口 (--push / --server)
├── tapd-config.example.json   # TAPD 凭证模板
└── docs/                      # 需求分析、测试计划、测试报告
```

**数据流：** `run.bat` → curl 重置数据 → Newman 跑 Collection → (可选) auto-create-bugs.js 推送 TAPD → HTML 报告

## 2. Mock Server 设计

### 2.1 响应助手

```js
ok(res, data, status)    // { code: 0, message: 'success', data }
bad(res, msg, code, status, data?)  // { code, message, data? }
```

所有路由统一使用 `ok()` / `bad()` 返回，消除手写 `res.status(...).json(...)` 的重复模式。

### 2.2 产品目录

```js
const CATALOG = {
  5001: { name: '无线蓝牙耳机', price: 149.50 },
  5002: { name: '机械键盘', price: 399.00 },
  5003: { name: 'USB-C 数据线', price: 29.90 }
};
```

合并 name + price 为单一常量，创建订单时直接从 CATALOG 取值，避免维护两套 productNames / productPrices 的散落映射。

### 2.3 in-memory 数据管理

- **启动时** `db.getState()` 深拷贝为 `seed`
- **创建/取消** 使用 `db.getState()` → 修改 → `db.setState()`（不用 lowdb 链式 API，因其 `.push()` / `.assign()` 不可靠）
- **`POST /__reset`** 恢复 seed，不写磁盘

这确保每次测试运行是隔离的，不需要手动清洗数据。

### 2.4 Auth Guard

所有 `/orders/*` 请求统一经过 auth middleware 检查 Bearer token：

| Token 特征 | 响应 |
|---|---|
| 缺失 `Authorization` 头 | 401 code=2001 |
| 包含 `expired` | 401 code=2002 |
| 等于 `this.is.a.tampered.token.value` | 401 code=2001 |
| 不在 users 表中 | 401 code=2001 |

## 3. 测试集合设计

### 3.1 Collection 级 Pre-request

```js
// 自动注入 auth_token，无需每个请求单独设置
// 跳过列表: TC-ORDER-006, TC-ORDER-007, TC-ORDER-008, TC-GET-008, TC-CANCEL-010
```

原来是 **30 个相同** 的 item 级 pre-request 脚本，现在合并为 1 个 collection 级。特殊用例（过期 token、篡改 token、sendRequest 动态创建）保留 item 级覆盖。

### 3.2 测试结构

| 区块 | 用例 | 覆盖点 |
|---|---|---|
| 01-用户认证 | TC-LOGIN-001 ~ 010 | 正向登录 + 边界值 + 参数校验 + 错误凭证 |
| 02a-创建订单 | TC-ORDER-001 ~ 013 | 正向创建 + 边界值 + 鉴权 + 参数校验 |
| 02b-查询订单 | TC-GET-001 ~ 008 | 正向查询 + 404 + 越权 + 参数格式 |
| 02c-取消订单 | TC-CANCEL-001 ~ 010 | 正向取消 + 状态机 + 越权 + 幂等 |
| 03-全链路E2E | E2E-01 ~ 05 | 登录→创建→查询→取消→验证 完整链路 |

总计 **36 请求, 46 测试脚本, 191 断言**。

### 3.3 环境变量

| 变量 | 用途 |
|---|---|
| `auth_token` | TC-LOGIN-001 中提取，供后续请求自动注入 |
| `order_id` | TC-ORDER-001 中提取，供查询/取消请求使用 |
| `e2e_order_id` | E2E 链路专用，隔离于主测试 |

## 4. TAPD 集成

### 4.1 去重机制

`auto-create-bugs.js` 维护 `newman/.reported-bugs.json` 记录已提交的缺陷。

- **签名规则：** `{requestName}::{assertionNames}` — 相同请求 + 相同断言组合不会重复创建
- **行为：** 已有签名的失败输出 `[SKIP] Already Bug #N`，新失败创建新 bug
- **持久化：** 每次成功创建后回写 `.reported-bugs.json`

### 4.2 缺陷格式

- **标题：** `[AutoTest] {请求名} — {断言名}`
- **描述：** TAPD wiki 格式，含失败详情表 + 请求体 + 响应体
- **限流：** 每个请求间隔 500ms 调用 TAPD API

## 5. CI 流水线

统一入口 `run.bat`：

| 命令 | 行为 |
|---|---|
| `run.bat` | curl 重置 → Newman(HTML) → 报告 |
| `run.bat --push` | curl 重置 → Newman(JSON) → TAPD push → Newman(HTML) |
| `run.bat --server` | 启动 mock server → curl 重置 → Newman(HTML) |
| `run.bat --push --server` | 启动 mock server → JSON run → TAPD → HTML run |

TAPD push 路径跑 Newman 两次（JSON + HTML），因为 JSON reporter 和 HTML reporter 不能共享同一 run。纯测试路径只跑一次 HTML。

## 6. 设计决策与权衡

### server.js：行数 vs 可读性

`bad()` / `ok()` 助手将每个路由从 6-8 行响应代码压缩为 1 行。`val()` 提取了重复的参数校验模式。CATALOG 合并了分散的 name/price 映射。最终从 282 行压缩到 128 行，每个函数的职责范围更小、改动更集中。

### Collection Pre-request：统一 vs 灵活性

Collection 级 pre-request 消除 30 份重复脚本，但需要 no-auth（3 个）和特殊 token（2 个）用例加入跳过列表。这是有意识的权衡——统一注入的收益远大于维护 5 个特殊跳过的成本。

### TAPD 去重：请求名 vs 断言名

使用完整请求名作为签名键而非每条断言独立。原因：一个请求的多个断言失败通常共享同一根因，创建多个 bug 会产生噪音。如果后续 run 中同一请求的不同断言失败，将由已有的 bug 覆盖。

### run.bat 合并 vs 独立脚本

三个 bat 文件合并为一个，通过 `--push` / `--server` 标志区分行为。单一入口降低认知负担，避免"该用哪个 bat"的选择困难。

## 7. 维护原则

1. **新增接口测试：** 在 Postman Collection 对应文件夹添加 request，如有 auth 需求会自动注入
2. **新增产品：** 修改 `CATALOG` 和 `db.json` 中的 orders 种子数据
3. **新增错误码：** 同步更新 `server.js` 和对应的 Postman 断言
4. **TAPD 去重重置：** 删除 `newman/.reported-bugs.json` 即可重新创建所有 bug
5. **不要 json-server 链式 API：** `db.get().push().write()` 有已知问题，始终使用 `getState()` / `setState()`

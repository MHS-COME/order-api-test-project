# 缺陷修复记录

OrderAPI Mock 服务在安全测试阶段共发现 5 个漏洞，已全部修复并通过自动化回归验证。

---

## #1 JWT None 算法绕过（高危）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2025-04-12 |
| 状态 | 已修复 |
| 危害等级 | 高危 — 攻击者可伪造任意用户 Token |
| 发现途径 | 安全测试模块 TC-SEC-004 |

### 漏洞描述

`/orders` 和 `/payment` 接口的 JWT 认证中间件在使用 `jsonwebtoken` 库验证签名时，未指定 `algorithms` 参数。`jsonwebtoken` v9 在未指定算法时默认允许 `none` 算法，攻击者可将 Token header 中的 `alg` 改为 `none`，签名部分置空，从而绕过认证。

### 复现步骤

```
POST /orders HTTP/1.1
Authorization: Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoidGVzdHVzZXIifQ.
Content-Type: application/json

{"productId":5001,"quantity":1,"addressId":100}
```
实际结果：201 Created（攻击成功，无需真实签名）

### 根因分析

`mock-server/server.js` 第 42 行：

```js
// 修复前
const decoded = jwt.verify(token, JWT_SECRET);
```

`jsonwebtoken.verify()` 在未指定 `algorithms` 时，会接受 token header 中声明的算法，包括 `none`。

### 修复方案

```js
// 修复后 — 显式白名单允许的算法
const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
```

### 修复验证

TC-SEC-004（JWT None 算法攻击）从 FAIL 变为 PASS，无法再用 None 算法绕过认证，返回 401 + code 2001。

---

## #2 水平越权 — 查询/取消他人订单（高危）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2025-04-12 |
| 状态 | 已修复 |
| 危害等级 | 高危 — 用户可查看和操作他人的订单数据 |
| 发现途径 | 安全测试模块 TC-SEC-010~012 |

### 漏洞描述

`GET /orders/:id` 和 `PUT /orders/:id/cancel` 接口在初始版本中仅校验了 Token 有效性，未校验订单所属用户是否为当前登录用户。导致用户 A 登录后，可以查看和取消用户 B 的订单。

### 复现步骤

```
# 用户 alice 登录后，查询 testuser 的订单 10001
GET /orders/10001 HTTP/1.1
Authorization: Bearer <alice_token>
```
实际结果：200 OK（越权成功，返回了 testuser 的订单详情）

### 根因分析

`server.js` 原始代码中缺少 `order.userId` 与 `req.user.userId` 的比对逻辑：

```js
// 修复前 — 仅查订单是否存在，不校验归属
const order = db.getState().orders.find(o => o.id === id);
if (!order) return bad(res, '订单不存在', 3001, 404);
ok(res, order);
```

### 修复方案

```js
// 修复后 — 增加归属校验
const order = db.getState().orders.find(o => o.id === id);
if (!order) return bad(res, '订单不存在', 3001, 404);
if (order.userId !== req.user.userId) return bad(res, '无权访问该订单', 3002, 403);
ok(res, order);
```

### 修复验证

TC-SEC-010（越权查询）、TC-SEC-011（越权取消）、TC-SEC-012（越权支付）全部 PASS，越权请求返回 403 + code 3002。

---

## #3 支付幂等性缺失 — 重复支付未拦截（中危）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2025-04-14 |
| 状态 | 已修复 |
| 危害等级 | 中危 — 用户可能被重复扣款，产生多条支付记录 |
| 发现途径 | 支付模块 TC-PAY-006 |

### 漏洞描述

`POST /payment` 接口在初始版本中未校验订单当前状态，仅校验了金额和订单存在性。导致已支付（PAID）的订单可以被再次支付，每次支付都会覆盖前一次的 `transactionId`，造成支付记录丢失和潜在的重复扣款。

### 复现步骤

```
# 第一次支付 — 成功
POST /payment → 200 { "code": 0, "data": { "transactionId": "TXN001" } }

# 第二次支付同一订单 — 应拒绝，但实际成功
POST /payment → 200 { "code": 0, "data": { "transactionId": "TXN002" } }
```
实际结果：第二次支付成功，TXN001 被 TXN002 覆盖。

### 根因分析

原始支付逻辑缺少状态前置检查：

```js
// 修复前 — 未检查订单当前状态
const order = db.getState().orders.find(o => o.orderId === orderId);
if (!order) return bad(res, '订单不存在', 3001, 404);
if (order.userId !== req.user.userId) return bad(res, '无权操作该订单', 3002, 403);
// ...直接执行支付，覆盖已有支付记录
```

### 修复方案

```js
// 修复后 — 增加状态校验
const order = db.getState().orders.find(o => o.orderId === orderId);
if (!order) return bad(res, '订单不存在', 3001, 404);
if (order.userId !== req.user.userId) return bad(res, '无权操作该订单', 3002, 403);
if (order.status === 'PAID') return bad(res, '订单已支付', 4003, 409);
if (order.status !== 'PENDING') return bad(res, '订单状态不允许支付', 4003, 409);
```

### 修复验证

TC-PAY-006（重复支付）PASS，第一次支付 200，第二次支付 409 + code 4003 + message 包含"已支付"。

---

## #4 订单状态机漏洞 — 已取消订单可重复取消（中危）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2025-04-14 |
| 状态 | 已修复 |
| 危害等级 | 中危 — 取消时间戳被覆盖，审计日志失真 |
| 发现途径 | 订单模块 TC-CANCEL-008 |

### 漏洞描述

`PUT /orders/:id/cancel` 接口在初始版本中仅校验了 `SHIPPED` 状态不可取消，但未拦截 `CANCELLED` 状态的重复取消。已取消的订单再次调用取消接口时，`cancelledAt` 时间戳被覆盖为新值，导致审计追踪失效。

### 复现步骤

```
# 第一次取消 — 成功
PUT /orders/10003/cancel → 200 { "data": { "cancelledAt": "2025-04-14T10:00:00Z" } }

# 第二次取消同一订单 — 应拒绝，但实际成功并覆盖时间戳
PUT /orders/10003/cancel → 200 { "data": { "cancelledAt": "2025-04-14T10:05:00Z" } }
```

### 根因分析

取消接口的状态检查不完整：

```js
// 修复前 — 仅拦截 SHIPPED，未拦截 CANCELLED
if (order.status === 'SHIPPED')
  return bad(res, '当前订单状态不允许取消', 4001, 409, { currentStatus: 'SHIPPED' });
// 直接执行取消，覆盖已有 cancelledAt
```

### 修复方案

```js
// 修复后 — 完整的状态机校验
if (order.status === 'PAID') return bad(res, '订单已支付，不允许取消', 4005, 409);
if (order.status === 'CANCELLED') return bad(res, '订单已被取消，无法重复操作', 4002, 409);
if (order.status === 'SHIPPED') return bad(res, '当前订单状态不允许取消', 4001, 409, { currentStatus: 'SHIPPED' });
```

### 修复验证

TC-CANCEL-008（重复取消幂等性）PASS，第一次取消 200，第二次取消 409 + code 4002。

---

## #5 明文密码存储（中危）

| 字段 | 内容 |
|------|------|
| 发现时间 | 2025-04-15 |
| 状态 | 已修复 |
| 危害等级 | 中危 — 数据库泄露即凭据全量暴露 |
| 发现途径 | 代码审查中发现 |

### 漏洞描述

用户注册和登录逻辑中，密码以明文形式存储在 `db.json` 中，登录时直接进行明文比对。`db.json` 是 Mock 服务的持久化文件，任何可以访问服务器文件系统的人都可直接读取所有用户的密码。

### 复现步骤

```
# 查看 db.json 中的用户记录
cat mock-server/db.json | grep password
# {"id":1,"username":"testuser","password":"Test@123456",...}
```
所有用户密码明文可见。

### 根因分析

```js
// 修复前 — 明文存储 + 明文比对
// 注册：
const newUser = { ..., password };
// 登录：
const user = db.get('users').find({ username, password }).value();
```

### 修复方案

引入 bcrypt 哈希存储，登录时使用 bcrypt.compare 比对：

```js
const bcrypt = require('bcrypt');

// 注册 — 哈希存储
const hashed = await bcrypt.hash(password, 10);
const newUser = { ..., password: hashed };

// 登录 — 哈希比对
const user = db.get('users').find({ username }).value();
if (!user || !(await bcrypt.compare(password, user.password)))
  return bad(res, '用户名或密码错误', 1002, 401);
```

### 修复验证

`db.json` 中密码字段已替换为 bcrypt 哈希值，明文不可逆推。登录验证仍正常通过，TC-LOGIN-001~005 全部 PASS。

---

## 漏洞统计

| 编号 | 漏洞 | 等级 | 状态 |
|------|------|------|------|
| #1 | JWT None 算法绕过 | 高危 | 已修复 |
| #2 | 水平越权（查询/取消/支付） | 高危 | 已修复 |
| #3 | 支付幂等性缺失 | 中危 | 已修复 |
| #4 | 订单状态机漏洞 | 中危 | 已修复 |
| #5 | 明文密码存储 | 中危 | 已修复 |

全部 5 个漏洞已通过安全测试模块（14 条用例）和订单/支付模块的相关用例完成回归验证，当前 CI 流水线中所有测试均为 PASS。

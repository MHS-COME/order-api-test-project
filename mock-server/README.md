# Mock Server — 订单系统模拟后端

基于 [json-server](https://github.com/typicode/json-server) + Express 自定义路由构建的本地 Mock API 服务。

## 快速启动

```bash
cd mock-server
npm install          # 首次运行：安装依赖
node server.js       # 启动服务 → http://localhost:3000
```

或双击 `start-mock.bat`（首次自动执行 `npm install`）。

按 `Ctrl+C` 停止服务。

## 预置测试数据

| 资源 | 数量 | 说明 |
|------|------|------|
| 用户 | 1 条 | `testuser / Test@123456` |
| 订单 | 4 条 | PENDING × 2、SHIPPED × 1、CANCELLED × 1 |

## 接口一览

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/login` | 否 | 用户登录，返回 Token |
| `POST` | `/orders` | Bearer | 创建订单 |
| `GET`  | `/orders` | Bearer | 订单列表 |
| `GET`  | `/orders/:id` | Bearer | 订单详情 |
| `PUT`  | `/orders/:id/cancel` | Bearer | 取消订单 |

---

## cURL 验证示例

### 1. 登录 — POST /login

```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"testuser\",\"password\":\"Test@123456\"}"
```

**成功响应 (200):**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...mock-signature",
    "tokenType": "Bearer",
    "expiresIn": 7200,
    "userId": 1,
    "username": "testuser"
  }
}
```

**错误响应：**

```bash
# 缺 username → 400
curl -s -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"Test@123456\"}"

# 密码错误 → 401
curl -s -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"testuser\",\"password\":\"wrong\"}"
```

### 2. 创建订单 — POST /orders

```bash
# 先登录获取 token
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoidGVzdHVzZXIifQ.mock-signature"

curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":5001,\"quantity\":2,\"addressId\":100,\"remark\":\"测试订单\"}"
```

**成功响应 (201):**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "orderId": 20002,
    "orderNo": "ORD20260603065011",
    "status": "PENDING",
    "totalAmount": 299.00,
    "productId": 5001,
    "productName": "无线蓝牙耳机",
    "quantity": 2,
    "createdAt": "2026-06-03T06:50:11.123Z"
  }
}
```

**错误响应：**

```bash
# 缺 productId → 400
curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"quantity\":1,\"addressId\":100}"

# 未认证 → 401
curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d "{\"productId\":5001,\"quantity\":1,\"addressId\":100}"

# quantity 超出范围 → 400
curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":5001,\"quantity\":0,\"addressId\":100}"
```

### 3. 查询订单 — GET /orders/:id

```bash
# 查询本人订单（userId=1 拥有 10001、10002、10003）
curl -s http://localhost:3000/orders/10001 \
  -H "Authorization: Bearer $TOKEN"

# 查询他人订单（20001 属于 userId=2） → 403
curl -s http://localhost:3000/orders/20001 \
  -H "Authorization: Bearer $TOKEN"

# 查询不存在的订单 → 404
curl -s http://localhost:3000/orders/99999 \
  -H "Authorization: Bearer $TOKEN"

# ID 格式非法 → 400
curl -s http://localhost:3000/orders/abc \
  -H "Authorization: Bearer $TOKEN"
```

### 4. 取消订单 — PUT /orders/:id/cancel

```bash
# 取消 PENDING 订单 10001 → 200
curl -s -X PUT http://localhost:3000/orders/10001/cancel \
  -H "Authorization: Bearer $TOKEN"

# 取消已发货订单 10002 → 409
curl -s -X PUT http://localhost:3000/orders/10002/cancel \
  -H "Authorization: Bearer $TOKEN"

# 重复取消 10003（已 CANCELLED） → 409
curl -s -X PUT http://localhost:3000/orders/10003/cancel \
  -H "Authorization: Bearer $TOKEN"
```

---

## Windows (PowerShell) 等效命令

```powershell
$token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoidGVzdHVzZXIifQ.mock-signature"
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }

# 登录
Invoke-RestMethod -Uri http://localhost:3000/login -Method POST `
  -Body '{"username":"testuser","password":"Test@123456"}' -ContentType "application/json"

# 创建订单
Invoke-RestMethod -Uri http://localhost:3000/orders -Method POST `
  -Body '{"productId":5001,"quantity":2,"addressId":100}' -Headers $headers

# 查询订单
Invoke-RestMethod -Uri http://localhost:3000/orders/10001 -Headers $headers

# 取消订单
Invoke-RestMethod -Uri http://localhost:3000/orders/10001/cancel -Method PUT -Headers $headers
```

---

## 用 Postman 验证

1. 启动 Mock 服务后，打开 Postman
2. 导入 `postman/订单系统.postman_collection.json`（项目根目录）
3. 导入 `postman/dev.environment.json` 并选择环境 `OrderAPI-Dev`
4. 运行 Collection Runner 即可执行全部 46 个请求

---

## 路由映射说明

`routes.json` 记录了自定义路由到 json-server 标准资源的映射关系：

| 自定义路由 | 映射到 | 实现方式 |
|-----------|--------|---------|
| `POST /login` | `POST /users`（查库校验） | `server.js` 自定义 handler |
| `PUT /orders/:id/cancel` | `PUT /orders/:id`（修改 status） | `server.js` 自定义 handler，含状态机校验 |
| `POST /orders` | `POST /orders`（增加字段填充） | `server.js` 自定义 handler，含参数校验 |

> `server.js` 在 json-server 内置 REST 路由之上增加了认证守卫、参数校验、业务状态机等企业级逻辑。若仅需简单 CRUD Mock，可改用 `json-server --watch db.json --routes routes.json --port 3000`。

---

## 文件结构

```
mock-server/
├── db.json          # 数据库（users + orders）
├── server.js        # 自定义 Express 服务（认证 + 业务逻辑 + json-server 路由）
├── routes.json      # 路由映射表（文档参考）
├── package.json     # npm 依赖声明
├── start-mock.bat   # Windows 一键启动脚本
└── README.md        # 本文件
```

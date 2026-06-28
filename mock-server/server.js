const jsonServer = require('json-server');
const jwt = require('jsonwebtoken');
const server = jsonServer.create();
const router = jsonServer.router('db.json');
const db = router.db;

server.use(jsonServer.defaults({ noCors: false }));
server.use(jsonServer.bodyParser);

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'OrderAPI Mock Server',
      version: '1.0.0',
      description: '订单系统 Mock 接口文档 — JWT 双 token 认证 · 订单状态机 · 支付幂等性校验'
    },
    servers: [{ url: 'http://localhost:3000', description: '本地 Mock 服务' }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    }
  },
  apis: [__filename]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

const seed = JSON.parse(JSON.stringify(db.getState()));

const JWT_SECRET = 'order-api-mock-jwt-secret-2026';
const ACCESS_EXPIRES = '1h';
const REFRESH_EXPIRES = '7d';

const CATALOG = {
  5001: { name: '无线蓝牙耳机', price: 149.50 },
  5002: { name: '机械键盘', price: 399.00 },
  5003: { name: 'USB-C 数据线', price: 29.90 }
};

const ok = (res, data, status = 200) => res.status(status).json({ code: 0, message: 'success', data });
const bad = (res, msg, code = 1001, status = 400, data) => {
  const body = { code, message: msg };
  if (data !== undefined) body.data = data;
  return res.status(status).json(body);
};

const sanitize = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
};

// ── Auth middleware (JWT) ──────────────────────────────────
// Covers /orders/* and /payment/* routes
server.use((req, res, next) => {
  if (!req.path.startsWith('/orders') && !req.path.startsWith('/payment')) return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return bad(res, '未提供认证令牌', 2001, 401);
  const token = auth.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.get('users').find({ id: decoded.userId }).value();
    if (!user) return bad(res, '无效令牌', 2001, 401);
    req.user = { userId: decoded.userId, username: decoded.username };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return bad(res, '令牌已过期，请重新登录', 2002, 401);
    }
    return bad(res, '无效令牌', 2001, 401);
  }
});

// ── POST /register ────────────────────────────────────────

/**
 * @swagger
 * /register:
 *   post:
 *     tags: [认证]
 *     summary: 用户注册
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, minLength: 4, maxLength: 32, example: newuser }
 *               password: { type: string, minLength: 6, maxLength: 20, example: Pass@123 }
 *               email: { type: string, format: email, example: user@example.com, description: 可选 }
 *     responses:
 *       201: { description: 注册成功 }
 *       400: { description: 参数校验失败 — code 1001 }
 *       409: { description: 用户名已存在 — code 1003 }
 */
server.post('/register', (req, res) => {
  const { username, password, email } = req.body;
  if (!username) return bad(res, '参数校验失败：username 不能为空');
  if (!password) return bad(res, '参数校验失败：password 不能为空');
  if (username.length < 4 || username.length > 32) return bad(res, '参数校验失败：username 长度须为 4-32 字符');
  if (password.length < 6 || password.length > 20) return bad(res, '参数校验失败：password 长度须为 6-20 字符');
  if (email !== undefined && email !== null && email !== '') {
    if (typeof email !== 'string' || !email.includes('@') || !email.includes('.')) {
      return bad(res, '参数校验失败：email 格式不正确');
    }
  }
  const existing = db.get('users').find({ username }).value();
  if (existing) return bad(res, '用户名已存在', 1003, 409);
  const state = db.getState();
  const newId = state.users.reduce((m, u) => Math.max(m, u.id), 0) + 1;
  const newUser = { id: newId, username: sanitize(username), password, refreshToken: '' };
  if (email) newUser.email = email;
  state.users.push(newUser);
  db.setState(state);
  ok(res, { id: newUser.id, username: newUser.username, email: newUser.email || null });
});

// ── POST /login ───────────────────────────────────────────

/**
 * @swagger
 * /login:
 *   post:
 *     tags: [认证]
 *     summary: 用户登录
 *     description: 验证用户名密码，返回 access token + refresh token。`?expired=1` 可生成过期 token 供测试。
 *     parameters:
 *       - in: query
 *         name: expired
 *         schema: { type: integer, example: 0 }
 *         description: 设为 1 返回已过期 token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, example: testuser }
 *               password: { type: string, example: Test@123456 }
 *     responses:
 *       200: { description: 登录成功，返回 token + refreshToken }
 *       400: { description: 参数校验失败 — code 1001 }
 *       401: { description: 用户名或密码错误 — code 1002 }
 */
server.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username) return bad(res, '参数校验失败：username 不能为空');
  if (!password) return bad(res, '参数校验失败：password 不能为空');
  if (username.length < 4 || username.length > 32) return bad(res, '参数校验失败：username 长度须为 4-32 字符');
  if (password.length < 6 || password.length > 64) return bad(res, '参数校验失败：password 长度须为 6-64 字符');
  const user = db.get('users').find({ username, password }).value();
  if (!user) return bad(res, '用户名或密码错误', 1002, 401);

  const expiresIn = req.query.expired === '1' ? '0s' : ACCESS_EXPIRES;
  const payload = { userId: user.id, username: user.username };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn });
  const refreshToken = jwt.sign(
    { userId: user.id, username: user.username, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );

  const state = db.getState();
  const idx = state.users.findIndex(u => u.id === user.id);
  state.users[idx].refreshToken = refreshToken;
  db.setState(state);

  ok(res, {
    token,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: req.query.expired === '1' ? 0 : 3600,
    userId: user.id,
    username: user.username
  });
});

// ── POST /refresh ─────────────────────────────────────────

/**
 * @swagger
 * /refresh:
 *   post:
 *     tags: [认证]
 *     summary: 刷新 Token
 *     description: 用 refresh token 换新的 access token。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string, example: eyJhbGciOi... }
 *     responses:
 *       200: { description: 刷新成功 }
 *       401: { description: 无效或已过期的刷新令牌 — code 2001/2002 }
 */
server.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return bad(res, '参数校验失败：refreshToken 不能为空');
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    if (decoded.type !== 'refresh') return bad(res, '无效的刷新令牌', 2001, 401);
    const user = db.get('users').find({ id: decoded.userId }).value();
    if (!user) return bad(res, '无效的刷新令牌', 2001, 401);
    if (user.refreshToken !== refreshToken) return bad(res, '刷新令牌已被撤销', 2001, 401);
    const newToken = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRES }
    );
    ok(res, {
      token: newToken,
      tokenType: 'Bearer',
      expiresIn: 3600,
      userId: user.id,
      username: user.username
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return bad(res, '刷新令牌已过期，请重新登录', 2002, 401);
    }
    return bad(res, '无效的刷新令牌', 2001, 401);
  }
});

// ── GET /test/expired-token ───────────────────────────────
server.get('/test/expired-token', (req, res) => {
  const token = jwt.sign(
    { userId: 1, username: 'testuser', exp: Math.floor(Date.now() / 1000) - 3600 },
    JWT_SECRET
  );
  ok(res, { token, tokenType: 'Bearer', expiresIn: 0, note: '此 token 已过期，用于测试' });
});

// ── Helpers for order routes ──────────────────────────────
const val = (v, label, min, max) => {
  if (v === undefined || v === null) return `参数校验失败：${label} 不能为空`;
  if (!Number.isInteger(v) || v < min || v > max) return `参数校验失败：${label} 取值范围为 ${min}-${max}`;
  return null;
};

// ── POST /orders ──────────────────────────────────────────

/**
 * @swagger
 * /orders:
 *   post:
 *     tags: [订单]
 *     summary: 创建订单
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, quantity, addressId]
 *             properties:
 *               productId: { type: integer, minimum: 1, example: 5001, description: 5001=蓝牙耳机 5002=键盘 5003=数据线 }
 *               quantity: { type: integer, minimum: 1, maximum: 999, example: 2 }
 *               addressId: { type: integer, minimum: 1, example: 100 }
 *               remark: { type: string, maxLength: 200, example: 请尽快发货, description: 可选 }
 *     responses:
 *       201: { description: 创建成功，返回订单详情 }
 *       400: { description: 参数校验失败 — code 1001 }
 *       401: { description: 未认证 — code 2001 / 令牌过期 — code 2002 }
 *       404: { description: 商品不存在 — code 2003 }
 */
server.post('/orders', (req, res) => {
  const { productId, quantity, addressId, remark } = req.body;
  const err = val(productId, 'productId', 1, Infinity) || val(quantity, 'quantity', 1, 999) || val(addressId, 'addressId', 1, Infinity);
  if (err && err.includes('不能为空')) return bad(res, err);
  if (err) return bad(res, err);
  const prod = CATALOG[productId];
  if (!prod) return bad(res, '商品不存在或已下架', 2003, 404);
  if (productId === 5001 && quantity > 50) return bad(res, '库存不足，当前剩余 50 件', 2004);

  const state = db.getState();
  const newId = state.orders.reduce((m, o) => Math.max(m, o.id), 10000) + 1;
  const now = new Date().toISOString();
  const order = {
    id: newId, orderId: newId, userId: req.user.userId,
    orderNo: 'ORD' + now.replace(/\D/g, '').substring(0, 14),
    productId, productName: prod.name, quantity,
    totalAmount: +(prod.price * quantity).toFixed(2),
    status: 'PENDING', addressId, remark: remark ? sanitize(remark) : null,
    items: [{ productId, productName: prod.name, price: prod.price, quantity, subtotal: +(prod.price * quantity).toFixed(2) }],
    address: { recipient: '张三', phone: '138****5678', province: '广东省', city: '深圳市', detail: '南山区科技园路 1 号' },
    createdAt: now, updatedAt: now
  };
  state.orders.push(order);
  db.setState(state);
  ok(res, order, 201);
});

// ── PUT /orders/:id/cancel ────────────────────────────────

/**
 * @swagger
 * /orders/{id}/cancel:
 *   put:
 *     tags: [订单]
 *     summary: 取消订单
 *     description: 仅 PENDING 状态可取消。PAID/SHIPPED/CANCELLED 均拒绝，附带取消原因可选。
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, maxLength: 200, example: 不想要了, description: 取消原因（可选） }
 *     responses:
 *       200: { description: 取消成功，返回 CANCELLED + cancelledAt }
 *       401: { description: 未认证 — code 2001 }
 *       403: { description: 越权 — code 3002 }
 *       404: { description: 订单不存在 — code 3001 }
 *       409:
 *         description: 状态冲突
 *         content:
 *           application/json:
 *             examples:
 *               shipped: { value: { code: 4001, message: "当前订单状态不允许取消", data: { currentStatus: "SHIPPED" } } }
 *               cancelled: { value: { code: 4002, message: "订单已被取消，无法重复操作" } }
 *               paid: { value: { code: 4005, message: "订单已支付，不允许取消" } }
 */
server.put('/orders/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) return bad(res, '参数校验失败：id 必须为正整数');
  const order = db.getState().orders.find(o => o.id === id);
  if (!order) return bad(res, '订单不存在', 3001, 404);
  if (order.userId !== req.user.userId) return bad(res, '无权操作该订单', 3002, 403);
  if (order.status === 'PAID') return bad(res, '订单已支付，不允许取消', 4005, 409);
  if (order.status === 'CANCELLED') return bad(res, '订单已被取消，无法重复操作', 4002, 409);
  if (order.status === 'SHIPPED') return bad(res, '当前订单状态不允许取消', 4001, 409, { currentStatus: 'SHIPPED' });
  const now = new Date().toISOString();
  const state = db.getState();
  const idx = state.orders.findIndex(o => o.id === id);
  Object.assign(state.orders[idx], { status: 'CANCELLED', cancelledAt: now, updatedAt: now });
  db.setState(state);
  ok(res, state.orders[idx]);
});

// ── GET /orders/:id ───────────────────────────────────────

/**
 * @swagger
 * /orders/{id}:
 *   get:
 *     tags: [订单]
 *     summary: 查询订单详情
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: 查询成功 }
 *       400: { description: ID 非法 — code 1001 }
 *       401: { description: 未认证 — code 2001 }
 *       403: { description: 越权 — code 3002 }
 *       404: { description: 订单不存在 — code 3001 }
 */
server.get('/orders/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) return bad(res, '参数校验失败：id 必须为正整数');
  const order = db.getState().orders.find(o => o.id === id);
  if (!order) return bad(res, '订单不存在', 3001, 404);
  if (order.userId !== req.user.userId) return bad(res, '无权访问该订单', 3002, 403);
  ok(res, order);
});

// ── GET /orders ───────────────────────────────────────────
server.get('/orders', (req, res) => {
  const state = db.getState();
  const userOrders = state.orders
    .filter(o => o.userId === req.user.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  ok(res, {
    orders: userOrders,
    total: userOrders.length,
    userId: req.user.userId
  });
});

// ── POST /payment ─────────────────────────────────────────

/**
 * @swagger
 * /payment:
 *   post:
 *     tags: [支付]
 *     summary: 支付订单
 *     description: 金额须匹配、订单须为 PENDING 且创建不超过 30 分钟。
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, amount]
 *             properties:
 *               orderId: { type: integer, example: 10001 }
 *               amount: { type: number, example: 149.50 }
 *               paymentMethod: { type: string, example: card, description: 可选 }
 *     responses:
 *       200: { description: 支付成功，返回 transactionId + PAID }
 *       400: { description: 参数缺失 — code 1001 / 金额不符 — code 1005 }
 *       401: { description: 未认证 — code 2001 }
 *       403: { description: 越权 — code 3002 }
 *       404: { description: 订单不存在 — code 3001 }
 *       409: { description: 已支付 — code 4003 / 超时 — code 4004 }
 */
server.post('/payment', (req, res) => {
  const { orderId, amount, paymentMethod } = req.body;
  if (orderId === undefined || orderId === null) return bad(res, '参数校验失败：orderId 不能为空');
  if (amount === undefined || amount === null) return bad(res, '参数校验失败：amount 不能为空');
  const order = db.getState().orders.find(o => o.orderId === orderId);
  if (!order) return bad(res, '订单不存在', 3001, 404);
  if (order.userId !== req.user.userId) return bad(res, '无权操作该订单', 3002, 403);
  if (order.status === 'PAID') return bad(res, '订单已支付', 4003, 409);
  if (order.status !== 'PENDING') return bad(res, '订单状态不允许支付', 4003, 409);
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  if (new Date(order.createdAt).getTime() < thirtyMinAgo) {
    return bad(res, '订单已超时关闭', 4004, 409);
  }
  if (Math.abs(amount - order.totalAmount) > 0.001) {
    return bad(res, '金额与订单实际金额不符', 1005, 400);
  }
  const now = new Date().toISOString();
  const transactionId = 'TXN' + Date.now();
  const state = db.getState();
  const idx = state.orders.findIndex(o => o.orderId === orderId);
  Object.assign(state.orders[idx], {
    status: 'PAID', paidAt: now, transactionId, paymentMethod: paymentMethod || 'card', updatedAt: now
  });
  db.setState(state);
  ok(res, { orderId: order.orderId, transactionId, paidAt: now, status: 'PAID' });
});

// ── GET /payment/:orderId ─────────────────────────────────

/**
 * @swagger
 * /payment/{orderId}:
 *   get:
 *     tags: [支付]
 *     summary: 查询支付状态
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: 查询成功 }
 *       401: { description: 未认证 — code 2001 }
 *       403: { description: 越权 — code 3002 }
 *       404: { description: 订单不存在 — code 3001 }
 */
server.get('/payment/:orderId', (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (isNaN(orderId) || orderId <= 0) return bad(res, '参数校验失败：orderId 必须为正整数');
  const order = db.getState().orders.find(o => o.orderId === orderId);
  if (!order) return bad(res, '订单不存在', 3001, 404);
  if (order.userId !== req.user.userId) return bad(res, '无权访问该订单', 3002, 403);
  ok(res, {
    orderId: order.orderId,
    status: order.status,
    totalAmount: order.totalAmount,
    transactionId: order.transactionId || null,
    paidAt: order.paidAt || null
  });
});

// ── POST /payment/simulate ────────────────────────────────
server.post('/payment/simulate', (req, res) => {
  const { orderId, result } = req.body;
  if (orderId === undefined || orderId === null) return bad(res, '参数校验失败：orderId 不能为空');
  const order = db.getState().orders.find(o => o.orderId === orderId);
  if (!order) return bad(res, '订单不存在', 3001, 404);
  if (order.userId !== req.user.userId) return bad(res, '无权操作该订单', 3002, 403);
  if (order.status === 'PAID') return bad(res, '订单已支付', 4003, 409);
  if (order.status !== 'PENDING') return bad(res, '订单状态不允许支付', 4003, 409);
  if (result !== 'SUCCESS') return bad(res, '支付失败', 4006, 400);
  const now = new Date().toISOString();
  const transactionId = 'TXN' + Date.now();
  const state = db.getState();
  const idx = state.orders.findIndex(o => o.orderId === orderId);
  Object.assign(state.orders[idx], {
    status: 'PAID', paidAt: now, transactionId, paymentMethod: 'simulate', updatedAt: now
  });
  db.setState(state);
  ok(res, { orderId: order.orderId, transactionId, paidAt: now, status: 'PAID' });
});

// ── Response wrapper for json-server router ───────────────
router.render = (req, res) => {
  const data = res.locals.data;
  if (res.headersSent) return;
  if (req.method === 'GET') {
    const empty = !data || (Array.isArray(data) && !data.length) || (!Array.isArray(data) && !Object.keys(data).length);
    if (empty) return res.status(404).json({ code: 3001, message: '订单不存在' });
  }
  res.jsonp({ code: 0, message: 'success', data });
};

// ── GET /health ────────────────────────────────────────────
server.get('/health', (req, res) => ok(res, { status: 'UP', uptime: process.uptime() }));

// ── POST /__reset — restore seed data in-memory ───────────

/**
 * @swagger
 * /__reset:
 *   post:
 *     tags: [系统]
 *     summary: 重置种子数据
 *     responses:
 *       200: { description: 重置成功 }
 */
server.post('/__reset', (req, res) => {
  db.setState(JSON.parse(JSON.stringify(seed)));
  ok(res, { message: '数据已重置' });
});

// ── Swagger UI ────────────────────────────────────────────
server.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

server.use(router);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n  OrderAPI Mock Server (JWT) running at http://localhost:${PORT}\n  Users: testuser/Test@123456, abcd/T@1234\n  Press Ctrl+C to stop\n`));

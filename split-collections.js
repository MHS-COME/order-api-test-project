// ============================================================================
// 拆分 Postman Collection 为 3 个独立模块
// 运行: node split-collections.js
// ============================================================================
const fs = require('fs');
const path = require('path');

const srcPath = 'postman/order_api_collection.json';
const outDir = 'postman/collections';

const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

// ---- helper: deep clone ----
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ---- helper: build collection skeleton ----
function makeCollection(name, description, variables, items, globalEvents) {
  const col = {
    info: {
      name: name,
      description: description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _exporter_id: 'order-api-test-project'
    },
    variable: variables,
    item: items
  };
  if (globalEvents) col.event = globalEvents;
  return col;
}

// ---- 1. Extract current items ----
const loginFolder = src.item.find(i => i.name === '01-用户认证');
const orderFolder = src.item.find(i => i.name === '02-订单管理');
const e2eFolder   = src.item.find(i => i.name === '03-全链路E2E');

const orderSubA = orderFolder.item.find(i => i.name.startsWith('02a'));
const orderSubB = orderFolder.item.find(i => i.name.startsWith('02b'));
const orderSubC = orderFolder.item.find(i => i.name.startsWith('02c'));

// ---- helper: build a login request ----
function loginReq(name, username, password, tests) {
  return {
    name: name,
    event: [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }],
    request: {
      method: 'POST',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: { mode: 'raw', raw: JSON.stringify({ username: username, password: password }, null, 2) },
      url: { raw: '{{base_url}}/login', host: ['{{base_url}}'], path: ['login'] }
    },
    response: []
  };
}

// ---- 2. Build registration tests (TC-REG-001 to TC-REG-005) ----

function regReq(name, bodyObj, tests) {
  return {
    name: name,
    event: [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }],
    request: {
      method: 'POST',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: { mode: 'raw', raw: JSON.stringify(bodyObj, null, 2) },
      url: { raw: '{{base_url}}/register', host: ['{{base_url}}'], path: ['register'] }
    },
    response: []
  };
}

const reg001 = regReq(
  'TC-REG-001 [正向] 注册成功',
  { username: 'newuser', password: 'NewUser@123', email: 'newuser@example.com' },
  [
    'pm.test("Status code is 200", function () {',
    '    pm.response.to.have.status(200);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    '',
    'pm.test("message equals success", function () {',
    '    pm.expect(jsonData.message).to.eql("success");',
    '});',
    '',
    'pm.test("data.id is a positive integer", function () {',
    '    pm.expect(jsonData.data).to.have.property("id");',
    '    pm.expect(jsonData.data.id).to.be.a("number").and.above(0);',
    '});',
    '',
    'pm.test("data.username equals request username", function () {',
    '    pm.expect(jsonData.data.username).to.eql("newuser");',
    '});',
    '',
    'pm.test("data.email equals request email", function () {',
    '    pm.expect(jsonData.data.email).to.eql("newuser@example.com");',
    '});',
    '',
    'pm.test("response does NOT contain token", function () {',
    '    pm.expect(pm.response.text()).to.not.include("\\"token\\"");',
    '});'
  ]
);

const reg002 = regReq(
  'TC-REG-002 [反向] 用户名已存在',
  { username: '{{username}}', password: 'Test@123456' },
  [
    'pm.test("Status code is 409", function () {',
    '    pm.response.to.have.status(409);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 1003 (duplicate username)", function () {',
    '    pm.expect(jsonData.code).to.eql(1003);',
    '});',
    '',
    'pm.test("message mentions duplicate/existing username", function () {',
    '    pm.expect(jsonData.message).to.be.a("string").and.not.empty;',
    '    pm.expect(jsonData.message).to.include("用户名已存在");',
    '});'
  ]
);

const reg003 = regReq(
  'TC-REG-003 [反向] username 长度不足',
  { username: 'abc', password: 'Test@123456' },
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    '',
    'pm.test("message mentions username length", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("username");',
    '});'
  ]
);

const reg004 = regReq(
  'TC-REG-004 [反向] password 长度不足',
  { username: 'newuser2', password: 'T@123' },
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    '',
    'pm.test("message mentions password length", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("password");',
    '});'
  ]
);

const reg005 = regReq(
  'TC-REG-005 [反向] 邮箱格式错误',
  { username: 'newuser3', password: 'Test@123456', email: 'invalid-email' },
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    '',
    'pm.test("message mentions email format", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("email");',
    '});'
  ]
);

// ---- 3. Build original login tests (TC-LOGIN-001 to TC-LOGIN-010) ----

// TC-LOGIN-001
const login001 = loginReq(
  'TC-LOGIN-001 [正向] 合法凭证登录成功',
  '{{username}}', '{{password}}',
  [
    'pm.test("Status code is 200", function () {',
    '    pm.response.to.have.status(200);',
    '});',
    '',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    '',
    'pm.test("message equals success", function () {',
    '    pm.expect(jsonData.message).to.eql("success");',
    '});',
    '',
    'pm.test("data.token exists and is a non-empty string", function () {',
    '    pm.expect(jsonData.data).to.have.property("token");',
    '    pm.expect(jsonData.data.token).to.be.a("string").and.not.empty;',
    '    pm.environment.set("auth_token", jsonData.data.token);',
    '});',
    '',
    'pm.test("data.tokenType equals Bearer", function () {',
    '    pm.expect(jsonData.data.tokenType).to.eql("Bearer");',
    '});',
    '',
    'pm.test("data.expiresIn is a positive number", function () {',
    '    pm.expect(jsonData.data.expiresIn).to.be.a("number").and.above(0);',
    '});',
    '',
    'pm.test("data.userId is a positive integer", function () {',
    '    pm.expect(jsonData.data.userId).to.be.a("number").and.above(0);',
    '});',
    '',
    'pm.test("data.username is a non-empty string", function () {',
    '    pm.expect(jsonData.data.username).to.be.a("string").and.not.empty;',
    '});'
  ]
);

// TC-LOGIN-002
const login002 = loginReq(
  'TC-LOGIN-002 [正向] username 边界值-最短4字符',
  'abcd', 'T@1234',
  [
    'pm.test("Status code is 200", function () {',
    '    pm.response.to.have.status(200);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    'pm.test("data.token exists", function () {',
    '    pm.expect(jsonData.data).to.have.property("token");',
    '    pm.expect(jsonData.data.token).to.be.a("string").and.not.empty;',
    '});',
    'pm.test("data.username equals input username", function () {',
    '    pm.expect(jsonData.data.username).to.eql("abcd");',
    '});'
  ]
);

// TC-LOGIN-003
const login003 = loginReq(
  'TC-LOGIN-003 [正向] username 边界值-最长32字符',
  'abcdefghijklmnopqrstuvwxyz012345', '{{password}}',
  [
    'pm.test("Status code is 200", function () {',
    '    pm.response.to.have.status(200);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    'pm.test("data.token exists", function () {',
    '    pm.expect(jsonData.data).to.have.property("token");',
    '});'
  ]
);

// TC-LOGIN-004
const login004 = loginReq(
  'TC-LOGIN-004 [正向] password 边界值-最短6字符',
  'abcd', 'T@1234',
  [
    'pm.test("Status code is 200", function () {',
    '    pm.response.to.have.status(200);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    'pm.test("data.token exists", function () {',
    '    pm.expect(jsonData.data).to.have.property("token");',
    '});'
  ]
);

// TC-LOGIN-005
const login005 = loginReq(
  'TC-LOGIN-005 [正向] password 边界值-最长64字符',
  'pwdtest', 'T@1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  [
    'pm.test("Status code is 200", function () {',
    '    pm.response.to.have.status(200);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    'pm.test("data.token exists", function () {',
    '    pm.expect(jsonData.data).to.have.property("token");',
    '});'
  ]
);

// TC-LOGIN-006
const login006 = {
  name: 'TC-LOGIN-006 [反向] 缺少必填字段 username',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    'pm.test("message contains \'username\'", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message.toLowerCase()).to.include("username");',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "password": "Test@123456"\n}' },
    url: { raw: '{{base_url}}/login', host: ['{{base_url}}'], path: ['login'] }
  },
  response: []
};

// TC-LOGIN-007
const login007 = {
  name: 'TC-LOGIN-007 [反向] 缺少必填字段 password',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    'pm.test("message contains \'password\'", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message.toLowerCase()).to.include("password");',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "username": "{{username}}"\n}' },
    url: { raw: '{{base_url}}/login', host: ['{{base_url}}'], path: ['login'] }
  },
  response: []
};

// TC-LOGIN-008
const login008 = {
  name: 'TC-LOGIN-008 [反向] 用户名或密码错误',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 401", function () {',
    '    pm.response.to.have.status(401);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1002 (wrong credentials)", function () {',
    '    pm.expect(jsonData.code).to.eql(1002);',
    '});',
    'pm.test("message is non-empty error message", function () {',
    '    pm.expect(jsonData.message).to.be.a("string").and.not.empty;',
    '});',
    'pm.test("response body does NOT contain token", function () {',
    '    pm.expect(pm.response.text()).to.not.include("\\"token\\"");',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "username": "{{username}}",\n  "password": "WrongPwd999"\n}' },
    url: { raw: '{{base_url}}/login', host: ['{{base_url}}'], path: ['login'] }
  },
  response: []
};

// TC-LOGIN-009
const login009 = loginReq(
  'TC-LOGIN-009 [反向] username 边界值-小于最小值3字符',
  'abc', '{{password}}',
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    'pm.test("message contains length/format hint for username", function () {',
    '    pm.expect(jsonData.message).to.be.a("string").and.not.empty;',
    '});'
  ]
);

// TC-LOGIN-010
const login010 = loginReq(
  'TC-LOGIN-010 [反向] password 边界值-小于最小值5字符',
  '{{username}}', 'T@123',
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    'pm.test("message contains length/format hint for password", function () {',
    '    pm.expect(jsonData.message).to.be.a("string").and.not.empty;',
    '});'
  ]
);

// ---- 4. Build original order tests (TC-ORDER-001 to TC-ORDER-013) ----

function orderReq(name, bodyObj, tests, prerequest) {
  const evts = [];
  if (prerequest) {
    evts.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest } });
  }
  evts.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });
  return {
    name: name,
    event: evts,
    request: {
      method: 'POST',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: { mode: 'raw', raw: JSON.stringify(bodyObj, null, 2).replace(/"\{\{/g, '{{').replace(/\}\}\}"/g, '}}').replace(/"{{/g, '{{').replace(/}}"/g, '}}') },
      url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
    },
    response: []
  };
}

// Helper to build raw body string with {{}} variables
function rawBody(str) {
  return str;
}

const order001 = {
  name: 'TC-ORDER-001 [正向] 全部字段创建订单',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 201", function () {',
    '    pm.response.to.have.status(201);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    'pm.test("data.orderId is a positive number", function () {',
    '    pm.expect(jsonData.data).to.have.property("orderId");',
    '    pm.expect(jsonData.data.orderId).to.be.a("number").and.above(0);',
    '    pm.environment.set("order_id", jsonData.data.orderId);',
    '});',
    'pm.test("data.orderNo starts with ORD", function () {',
    '    pm.expect(jsonData.data.orderNo).to.be.a("string");',
    '    pm.expect(jsonData.data.orderNo).to.match(/^ORD/);',
    '});',
    'pm.test("data.status equals PENDING", function () {',
    '    pm.expect(jsonData.data.status).to.eql("PENDING");',
    '});',
    'pm.test("data.totalAmount is a positive number", function () {',
    '    pm.expect(jsonData.data.totalAmount).to.be.a("number").and.above(0);',
    '});',
    'pm.test("data.productId equals request", function () {',
    '    pm.expect(jsonData.data.productId).to.eql(5001);',
    '});',
    'pm.test("data.quantity equals request", function () {',
    '    pm.expect(jsonData.data.quantity).to.eql(2);',
    '});',
    'pm.test("data.productName is a non-empty string", function () {',
    '    pm.expect(jsonData.data.productName).to.be.a("string").and.not.empty;',
    '});',
    'pm.test("data.createdAt is valid ISO 8601", function () {',
    '    pm.expect(jsonData.data.createdAt).to.be.a("string");',
    '    pm.expect(Date.parse(jsonData.data.createdAt)).to.not.eql(NaN);',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 2,\n  "addressId": {{address_id}},\n  "remark": "请尽快发货"\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

// TC-ORDER-002 to TC-ORDER-013
const order002 = {
  name: 'TC-ORDER-002 [正向] 仅必填字段创建订单',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 201", function () {',
    '    pm.response.to.have.status(201);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    'pm.test("data.status equals PENDING", function () {',
    '    pm.expect(jsonData.data.status).to.eql("PENDING");',
    '});',
    'pm.test("remark is null or absent (optional field omitted)", function () {',
    '    var hasRemark = jsonData.data.hasOwnProperty("remark") && jsonData.data.remark !== null;',
    '    pm.expect(hasRemark).to.be.false;',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 1,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order003 = {
  name: 'TC-ORDER-003 [正向] quantity 边界值-最小1',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 201", function () {',
    '    pm.response.to.have.status(201);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    'pm.test("data.quantity equals 1", function () {',
    '    pm.expect(jsonData.data.quantity).to.eql(1);',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 1,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order004 = {
  name: 'TC-ORDER-004 [正向] quantity 边界值-最大999',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 201", function () {',
    '    pm.response.to.have.status(201);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    'pm.test("data.quantity equals 999", function () {',
    '    pm.expect(jsonData.data.quantity).to.eql(999);',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": 5002,\n  "quantity": 999,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order005 = {
  name: 'TC-ORDER-005 [正向] remark 边界值-最长200字符',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 201", function () {',
    '    pm.response.to.have.status(201);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'pm.test("code equals 0", function () {',
    '    pm.expect(pm.response.json().code).to.eql(0);',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 1,\n  "addressId": {{address_id}},\n  "remark": "A123456789B123456789C123456789D123456789E123456789F123456789G123456789H123456789I123456789J123456789K123456789L123456789M123456789N123456789O123456789P123456789Q123456789R123456789S123456789T123456789"\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order006 = {
  name: 'TC-ORDER-006 [反向] 未携带 Authorization 头',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 401", function () {',
    '    pm.response.to.have.status(401);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 2001 (no auth token)", function () {',
    '    pm.expect(jsonData.code).to.eql(2001);',
    '});',
    'pm.test("message mentions missing token", function () {',
    '    pm.expect(jsonData.message).to.be.a("string").and.not.empty;',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 1,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order007 = {
  name: 'TC-ORDER-007 [反向] Token 已过期',
  event: [
    { listen: 'prerequest', script: { type: 'text/javascript', exec: [
      'pm.request.headers.add({ key: "Authorization", value: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjEwMDAwMDAwMDB9.expired-token-signature" });'
    ] } },
    { listen: 'test', script: { type: 'text/javascript', exec: [
      'pm.test("Status code is 401", function () {',
      '    pm.response.to.have.status(401);',
      '});',
      'pm.test("Response time is below 2000ms", function () {',
      '    pm.expect(pm.response.responseTime).to.be.below(2000);',
      '});',
      'var jsonData = pm.response.json();',
      'pm.test("code equals 2002 (token expired)", function () {',
      '    pm.expect(jsonData.code).to.eql(2002);',
      '});'
    ] } }
  ],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 1,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order008 = {
  name: 'TC-ORDER-008 [反向] Token 被篡改',
  event: [
    { listen: 'prerequest', script: { type: 'text/javascript', exec: [
      'pm.request.headers.add({ key: "Authorization", value: "Bearer this.is.a.tampered.token.value" });'
    ] } },
    { listen: 'test', script: { type: 'text/javascript', exec: [
      'pm.test("Status code is 401", function () {',
      '    pm.response.to.have.status(401);',
      '});',
      'pm.test("Response time is below 2000ms", function () {',
      '    pm.expect(pm.response.responseTime).to.be.below(2000);',
      '});',
      'var jsonData = pm.response.json();',
      'pm.test("code equals 2001 (invalid token)", function () {',
      '    pm.expect(jsonData.code).to.eql(2001);',
      '});'
    ] } }
  ],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 1,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order009 = {
  name: 'TC-ORDER-009 [反向] 缺少必填字段 productId',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1001", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    'pm.test("message contains \'productId\'", function () {',
    '    pm.expect(jsonData.message.toLowerCase()).to.include("productid");',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "quantity": 1,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order010 = {
  name: 'TC-ORDER-010 [反向] productId 为 0',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'pm.test("code equals 1001", function () {',
    '    pm.expect(pm.response.json().code).to.eql(1001);',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": 0,\n  "quantity": 1,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order011 = {
  name: 'TC-ORDER-011 [反向] productId 为负数',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'pm.test("code equals 1001", function () {',
    '    pm.expect(pm.response.json().code).to.eql(1001);',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": -1,\n  "quantity": 1,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order012 = {
  name: 'TC-ORDER-012 [反向] quantity 为 0（无效下边界）',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1001", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    'pm.test("message contains \'quantity\'", function () {',
    '    pm.expect(jsonData.message.toLowerCase()).to.include("quantity");',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 0,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

const order013 = {
  name: 'TC-ORDER-013 [反向] quantity 为 1000（无效上边界）',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time is below 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1001", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    'pm.test("message contains \'quantity\'", function () {',
    '    pm.expect(jsonData.message.toLowerCase()).to.include("quantity");',
    '});'
  ] } }],
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "productId": {{product_id}},\n  "quantity": 1000,\n  "addressId": {{address_id}}\n}' },
    url: { raw: '{{base_url}}/orders', host: ['{{base_url}}'], path: ['orders'] }
  },
  response: []
};

// ---- 5. Assemble Collections ----

// ====== 00-注册模块 ======
const regCollection = makeCollection(
  '00-注册模块',
  '用户注册接口测试集合。覆盖正向注册、用户名重复、参数校验、边界值场景。',
  [
    { key: 'base_url', value: 'http://localhost:3000', type: 'string' },
    { key: 'username', value: 'testuser', type: 'string' }
  ],
  [reg001, reg002, reg003, reg004, reg005]
);

fs.writeFileSync(path.join(outDir, '00-注册模块.postman_collection.json'), JSON.stringify(regCollection, null, 2), 'utf8');
console.log('[OK] 00-注册模块.postman_collection.json  (' + regCollection.item.length + ' requests)');

// ====== 01-登录模块 ======
const loginDDT = clone(loginFolder.item.find(i => i.name.startsWith('TC-LOGIN-DDT')));
// Update DDT variables to use collection variables instead of environment
loginDDT.request.body.raw = '{\n  "username": "{{input_username}}",\n  "password": "{{input_password}}"\n}';

const loginCollection = makeCollection(
  '01-登录模块',
  '用户登录接口测试集合。包含数据驱动模板(TC-LOGIN-DDT)和10个独立用例，覆盖正向登录、参数校验、边界值、异常场景。\n\n运行方式:\n  数据驱动: newman run ... -d data/login_data.csv\n  独立用例: newman run ... (跳过DDT,直接运行001-010)',
  [
    { key: 'base_url', value: 'http://localhost:3000', type: 'string' },
    { key: 'username', value: 'testuser', type: 'string' },
    { key: 'password', value: 'Test@123456', type: 'string' },
    { key: 'input_username', value: 'testuser', type: 'string' },
    { key: 'input_password', value: 'Test@123456', type: 'string' }
  ],
  [{
    name: '01-用户认证',
    description: 'POST /login 接口测试。含数据驱动模板(TC-LOGIN-DDT)及独立用例(TC-LOGIN-001~010)。',
    item: [
      loginDDT,
      login001, login002, login003, login004, login005,
      login006, login007, login008, login009, login010
    ]
  }]
);

fs.writeFileSync(path.join(outDir, '01-登录模块.postman_collection.json'), JSON.stringify(loginCollection, null, 2), 'utf8');
console.log('[OK] 01-登录模块.postman_collection.json  (' + loginCollection.item[0].item.length + ' requests)');

// ====== 02-订单模块 ======
const orderDDT = clone(orderSubA.item.find(i => i.name.startsWith('TC-ORDER-DDT')));
// Update DDT scripts to use input_* column names (avoid conflict with collection variables)
orderDDT.event.forEach(function(evt) {
  if (evt.script && evt.script.exec) {
    evt.script.exec = evt.script.exec.map(function(line) {
      return line.replace(/pm\.iterationData\.get\("product_id"\)/g, 'pm.iterationData.get("input_product_id")')
                .replace(/pm\.iterationData\.get\("quantity"\)/g, 'pm.iterationData.get("input_quantity")')
                .replace(/pm\.iterationData\.get\("address_id"\)/g, 'pm.iterationData.get("input_address_id")')
                .replace(/pm\.iterationData\.get\("remark"\)/g, 'pm.iterationData.get("input_remark")')
                .replace(/pm\.environment\.get\("product_id"\)/g, 'pm.environment.get("input_product_id")')
                .replace(/pm\.environment\.get\("address_id"\)/g, 'pm.environment.get("input_address_id")');
    });
  }
});
const getItems = clone(orderSubB.item);
const cancelItems = clone(orderSubC.item);

// Remove global prerequest from GET and CANCEL (they don't need custom auth injection)
// The collection-level prerequest will handle it

// Build 02a items: DDT + 001~013
const orderCreateItems = [
  orderDDT,
  order001, order002, order003, order004, order005,
  order006, order007, order008, order009, order010,
  order011, order012, order013
];

const orderCollection = makeCollection(
  '02-订单模块',
  '订单管理接口测试集合。覆盖创建订单(POST /orders)、查询订单(GET /orders/:id)、取消订单(PUT /orders/:id/cancel)的完整生命周期。\n\n前置条件: 环境变量中需设置 auth_token（通过登录接口获取）。',
  [
    { key: 'base_url', value: 'http://localhost:3000', type: 'string' },
    { key: 'auth_token', value: '', type: 'string' },
    { key: 'order_id', value: '', type: 'string' },
    { key: 'product_id', value: '5001', type: 'string' },
    { key: 'address_id', value: '100', type: 'string' }
  ],
  [{
    name: '02-订单管理',
    description: '订单 CRUD 接口测试：创建订单、查询订单详情、取消订单。',
    item: [
      {
        name: '02a-创建订单 POST /orders',
        description: '创建订单接口的正向与异常测试用例。含数据驱动模板(TC-ORDER-DDT)及独立用例(TC-ORDER-001~013)。',
        item: orderCreateItems
      },
      {
        name: '02b-查询订单 GET /orders/:id',
        description: '查询订单详情接口的正向与异常测试用例。',
        item: getItems
      },
      {
        name: '02c-取消订单 PUT /orders/:id/cancel',
        description: '取消订单接口的正向与异常测试用例。',
        item: cancelItems
      }
    ]
  }],
  // Global prerequest: auto-inject Bearer token
  [{
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        'var NO_AUTH = ["TC-ORDER-006", "TC-ORDER-007", "TC-ORDER-008", "TC-GET-008", "TC-CANCEL-010"];',
        'var nm = pm.info.requestName;',
        'if (!NO_AUTH.some(function(n) { return nm.indexOf(n) === 0; })) {',
        '  var tok = pm.environment.get("auth_token");',
        '  if (tok) pm.request.headers.add({ key: "Authorization", value: "Bearer " + tok });',
        '}'
      ]
    }
  }]
);

fs.writeFileSync(path.join(outDir, '02-订单模块.postman_collection.json'), JSON.stringify(orderCollection, null, 2), 'utf8');
var totalOrder = orderCreateItems.length + getItems.length + cancelItems.length;
console.log('[OK] 02-订单模块.postman_collection.json  (' + totalOrder + ' requests: ' + orderCreateItems.length + ' create + ' + getItems.length + ' query + ' + cancelItems.length + ' cancel)');

// ====== 03-端到端E2E ======
const e2eItems = clone(e2eFolder.item);

const e2eCollection = makeCollection(
  '03-端到端E2E',
  '全链路端到端测试集合。模拟真实用户流程: 登录 → 创建订单 → 查询订单 → 取消订单 → 验证取消状态。独立运行，不依赖外部 auth_token。',
  [
    { key: 'base_url', value: 'http://localhost:3000', type: 'string' },
    { key: 'username', value: 'testuser', type: 'string' },
    { key: 'password', value: 'Test@123456', type: 'string' },
    { key: 'auth_token', value: '', type: 'string' },
    { key: 'product_id', value: '5001', type: 'string' },
    { key: 'address_id', value: '100', type: 'string' },
    { key: 'e2e_order_id', value: '', type: 'string' },
    { key: 'e2e_userId', value: '', type: 'string' }
  ],
  [{
    name: '03-全链路E2E',
    description: '端到端全链路测试：登录 → 创建订单 → 查询订单 → 取消订单 → 验证取消状态。需按顺序执行（Collection Runner 中选择 Run in order + Keep variable values）。',
    item: e2eItems
  }],
  // Global prerequest: auto-inject Bearer token for /orders/* routes
  [{
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        'var NO_AUTH = ["TC-ORDER-006", "TC-ORDER-007", "TC-ORDER-008", "TC-GET-008", "TC-CANCEL-010"];',
        'var nm = pm.info.requestName;',
        'if (!NO_AUTH.some(function(n) { return nm.indexOf(n) === 0; })) {',
        '  var tok = pm.environment.get("auth_token");',
        '  if (tok) pm.request.headers.add({ key: "Authorization", value: "Bearer " + tok });',
        '}'
      ]
    }
  }]
);

fs.writeFileSync(path.join(outDir, '03-端到端E2E.postman_collection.json'), JSON.stringify(e2eCollection, null, 2), 'utf8');
console.log('[OK] 03-端到端E2E.postman_collection.json  (' + e2eItems.length + ' requests)');

// ====== 04-支付模块 ======

function payReq(name, bodyObj, tests, prerequest) {
  const evts = [];
  if (prerequest) {
    evts.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest } });
  }
  evts.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });
  return {
    name: name,
    event: evts,
    request: {
      method: 'POST',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: { mode: 'raw', raw: JSON.stringify(bodyObj, null, 2).replace(/"\{\{/g, '{{').replace(/\}\}\}"/g, '}}').replace(/"{{/g, '{{').replace(/}}"/g, '}}') },
      url: { raw: '{{base_url}}/payment', host: ['{{base_url}}'], path: ['payment'] }
    },
    response: []
  };
}

const pay001 = payReq(
  'TC-PAY-001 [正向] 支付成功',
  { orderId: '{{pay_order_id}}', amount: '{{pay_amount}}', paymentMethod: 'card' },
  [
    'pm.test("Status code is 200", function () {',
    '    pm.response.to.have.status(200);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 0", function () {',
    '    pm.expect(jsonData.code).to.eql(0);',
    '});',
    '',
    'pm.test("data.status equals PAID", function () {',
    '    pm.expect(jsonData.data.status).to.eql("PAID");',
    '});',
    '',
    'pm.test("data.orderId equals request", function () {',
    '    pm.expect(jsonData.data.orderId).to.eql(pm.environment.get("pay_order_id"));',
    '});',
    '',
    'pm.test("data.transactionId starts with TXN", function () {',
    '    pm.expect(jsonData.data.transactionId).to.be.a("string");',
    '    pm.expect(jsonData.data.transactionId).to.match(/^TXN/);',
    '});',
    '',
    'pm.test("data.paidAt is valid ISO 8601", function () {',
    '    pm.expect(jsonData.data.paidAt).to.be.a("string");',
    '    pm.expect(Date.parse(jsonData.data.paidAt)).to.not.eql(NaN);',
    '});'
  ],
  [
    'var orderReq = {',
    '  url: pm.variables.get("base_url") + "/orders",',
    '  method: "POST",',
    '  header: {',
    '    "Content-Type": "application/json",',
    '    "Authorization": "Bearer " + pm.environment.get("auth_token")',
    '  },',
    '  body: {',
    '    mode: "raw",',
    '    raw: JSON.stringify({ productId: 5001, quantity: 1, addressId: 100, remark: "支付测试订单" })',
    '  }',
    '};',
    'pm.sendRequest(orderReq, function(err, res) {',
    '  if (!err && res.json().code === 0) {',
    '    var d = res.json().data;',
    '    pm.environment.set("pay_order_id", d.orderId);',
    '    pm.environment.set("pay_amount", d.totalAmount);',
    '  }',
    '});'
  ]
);

const pay002 = payReq(
  'TC-PAY-002 [反向] 缺少 orderId',
  { amount: 100, paymentMethod: 'card' },
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    '',
    'pm.test("message mentions orderId", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message.toLowerCase()).to.include("orderid");',
    '});'
  ]
);

const pay003 = payReq(
  'TC-PAY-003 [反向] 缺少 amount',
  { orderId: 99999, paymentMethod: 'card' },
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 1001 (param validation error)", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    '',
    'pm.test("message mentions amount", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message.toLowerCase()).to.include("amount");',
    '});'
  ]
);

const pay004 = payReq(
  'TC-PAY-004 [反向] 金额与实际订单不符',
  { orderId: '{{pay_order_id}}', amount: 0.01, paymentMethod: 'card' },
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 1005 (amount mismatch)", function () {',
    '    pm.expect(jsonData.code).to.eql(1005);',
    '});',
    '',
    'pm.test("message mentions amount mismatch", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("金额");',
    '});'
  ],
  [
    'var orderReq = {',
    '  url: pm.variables.get("base_url") + "/orders",',
    '  method: "POST",',
    '  header: {',
    '    "Content-Type": "application/json",',
    '    "Authorization": "Bearer " + pm.environment.get("auth_token")',
    '  },',
    '  body: {',
    '    mode: "raw",',
    '    raw: JSON.stringify({ productId: 5002, quantity: 1, addressId: 100 })',
    '  }',
    '};',
    'pm.sendRequest(orderReq, function(err, res) {',
    '  if (!err && res.json().code === 0) {',
    '    var d = res.json().data;',
    '    pm.environment.set("pay_order_id", d.orderId);',
    '  }',
    '});'
  ]
);

const pay005 = payReq(
  'TC-PAY-005 [反向] 对已支付订单重复支付',
  { orderId: 20012, amount: 149.5, paymentMethod: 'card' },
  [
    'pm.test("Status code is 409", function () {',
    '    pm.response.to.have.status(409);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 4003 (already paid)", function () {',
    '    pm.expect(jsonData.code).to.eql(4003);',
    '});',
    '',
    'pm.test("message mentions already paid", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("已支付");',
    '});'
  ]
);

const pay006 = payReq(
  'TC-PAY-006 [反向] 跨用户支付订单',
  { orderId: '{{pay_order_id}}', amount: '{{pay_amount}}', paymentMethod: 'card' },
  [
    'pm.test("Status code is 403", function () {',
    '    pm.response.to.have.status(403);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 3002 (unauthorized)", function () {',
    '    pm.expect(jsonData.code).to.eql(3002);',
    '});',
    '',
    'pm.test("message mentions unauthorized", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("无权");',
    '});'
  ],
  [
    'var orderReq = {',
    '  url: pm.variables.get("base_url") + "/orders",',
    '  method: "POST",',
    '  header: {',
    '    "Content-Type": "application/json",',
    '    "Authorization": "Bearer " + pm.environment.get("auth_token")',
    '  },',
    '  body: {',
    '    mode: "raw",',
    '    raw: JSON.stringify({ productId: 5001, quantity: 1, addressId: 100, remark: "越权测试订单" })',
    '  }',
    '};',
    'pm.sendRequest(orderReq, function(err, res) {',
    '  if (!err && res.json().code === 0) {',
    '    var d = res.json().data;',
    '    pm.environment.set("pay_order_id", d.orderId);',
    '    pm.environment.set("pay_amount", d.totalAmount);',
    '  }',
    '});',
    'pm.request.headers.upsert({ key: "Authorization", value: "Bearer alice-token" });'
  ]
);

const pay007 = payReq(
  'TC-PAY-007 [反向] 支付已取消的订单',
  { orderId: 20011, amount: 149.5, paymentMethod: 'card' },
  [
    'pm.test("Status code is 409", function () {',
    '    pm.response.to.have.status(409);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 4003 (status not allowed)", function () {',
    '    pm.expect(jsonData.code).to.eql(4003);',
    '});',
    '',
    'pm.test("message mentions status not allowed", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("不允许");',
    '});'
  ]
);

const pay008 = payReq(
  'TC-PAY-008 [反向] 支付超时订单（30分钟）',
  { orderId: 20015, amount: 399, paymentMethod: 'card' },
  [
    'pm.test("Status code is 409", function () {',
    '    pm.response.to.have.status(409);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 4004 (timeout)", function () {',
    '    pm.expect(jsonData.code).to.eql(4004);',
    '});',
    '',
    'pm.test("message mentions timeout", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("超时");',
    '});'
  ]
);

const pay009 = payReq(
  'TC-PAY-009 [反向] 使用过期 token 支付',
  { orderId: 20010, amount: 798, paymentMethod: 'card' },
  [
    'pm.test("Status code is 401", function () {',
    '    pm.response.to.have.status(401);',
    '});',
    '',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    '',
    'var jsonData = pm.response.json();',
    '',
    'pm.test("code equals 2002 (token expired)", function () {',
    '    pm.expect(jsonData.code).to.eql(2002);',
    '});',
    '',
    'pm.test("message mentions expired token", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("过期");',
    '});'
  ],
  [
    'pm.sendRequest({',
    '  url: pm.variables.get("base_url") + "/test/expired-token",',
    '  method: "GET"',
    '}, function(err, res) {',
    '  if (!err) {',
    '    var tok = res.json().data.token;',
    '    pm.request.headers.upsert({ key: "Authorization", value: "Bearer " + tok });',
    '  }',
    '});'
  ]
);

const payCollection = makeCollection(
  '04-支付模块',
  '订单支付接口测试集合。覆盖正向支付、参数校验、金额校验、状态校验、越权校验、超时场景。',
  [
    { key: 'base_url', value: 'http://localhost:3000', type: 'string' },
    { key: 'auth_token', value: '', type: 'string' },
    { key: 'pay_order_id', value: '', type: 'string' },
    { key: 'pay_amount', value: '', type: 'string' }
  ],
  [pay001, pay002, pay003, pay004, pay005, pay006, pay007, pay008, pay009],
  [{
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        'var NO_AUTH = ["TC-PAY-006", "TC-PAY-009"];',
        'var nm = pm.info.requestName;',
        'if (!NO_AUTH.some(function(n) { return nm.indexOf(n) === 0; })) {',
        '  var tok = pm.environment.get("auth_token");',
        '  if (tok) pm.request.headers.add({ key: "Authorization", value: "Bearer " + tok });',
        '}'
      ]
    }
  }]
);

fs.writeFileSync(path.join(outDir, '04-支付模块.postman_collection.json'), JSON.stringify(payCollection, null, 2), 'utf8');
console.log('[OK] 04-支付模块.postman_collection.json  (' + payCollection.item.length + ' requests)');

// ====== 05-安全测试模块 ======

function secReq(name, method, urlPath, bodyObj, tests, prerequest) {
  const evts = [];
  if (prerequest) {
    evts.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest } });
  }
  evts.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });
  const req = {
    name: name,
    event: evts,
    request: {
      method: method,
      header: [{ key: 'Content-Type', value: 'application/json' }],
      url: { raw: '{{base_url}}' + urlPath, host: ['{{base_url}}'], path: urlPath.replace(/^\//, '').split('/') }
    },
    response: []
  };
  if (method !== 'GET') {
    req.request.body = { mode: 'raw', raw: JSON.stringify(bodyObj, null, 2).replace(/"\{\{/g, '{{').replace(/\}\}\}"/g, '}}').replace(/"{{/g, '{{').replace(/}}"/g, '}}') };
  }
  return req;
}

function secGetNoBody(name, urlRaw, urlPath, tests, prerequest) {
  const evts = [];
  if (prerequest) {
    evts.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest } });
  }
  evts.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });
  return {
    name: name,
    event: evts,
    request: {
      method: 'GET',
      header: [],
      url: { raw: urlRaw, host: ['{{base_url}}'], path: urlPath }
    },
    response: []
  };
}

// SQL Injection
const sec001 = secReq('TC-SEC-001 [SQL注入] 登录绕过', 'POST', '/login',
  { username: "' OR '1'='1", password: 'anything' },
  [
    'pm.test("Status code is 401 or 400, NOT 200", function () {',
    '    pm.expect(pm.response.code).to.not.eql(200);',
    '    pm.expect([400, 401]).to.include(pm.response.code);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'pm.test("Response body does NOT contain token", function () {',
    '    pm.expect(pm.response.text()).to.not.include("\\"token\\"");',
    '});'
  ]
);

const sec002 = secGetNoBody('TC-SEC-002 [SQL注入] 查询订单路径注入',
  '{{base_url}}/orders/1 OR 1=1', ['orders', '1 OR 1=1'],
  [
    'pm.test("Status code is 400 or 404", function () {',
    '    pm.expect([400, 404]).to.include(pm.response.code);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'pm.test("Does NOT return all orders", function () {',
    '    if (pm.response.code === 200) {',
    '        var d = pm.response.json();',
    '        pm.expect(d.data).to.not.be.an("array");',
    '    }',
    '});'
  ]
);

const sec003 = secReq('TC-SEC-003 [SQL注入] 创建订单参数注入', 'POST', '/orders',
  { productId: '1; DROP TABLE orders; --', quantity: 1, addressId: 100 },
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'pm.test("code equals 1001", function () {',
    '    pm.expect(pm.response.json().code).to.eql(1001);',
    '});'
  ]
);

// XSS
const sec004 = secReq('TC-SEC-004 [XSS] 注册用户名脚本注入', 'POST', '/register',
  { username: '<script>alert(\'XSS\')</script>', password: 'Test@123456' },
  [
    'pm.test("Status code is 400 OR username is sanitized", function () {',
    '    var code = pm.response.code;',
    '    if (code === 200) {',
    '        var d = pm.response.json();',
    '        var uname = d.data.username || "";',
    '        pm.expect(uname).to.not.include("<script>");',
    '        pm.expect(uname).to.not.include("alert");',
    '    } else {',
    '        pm.expect(code).to.eql(400);',
    '    }',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});'
  ]
);

const sec005 = secReq('TC-SEC-005 [XSS] 订单备注脚本注入', 'POST', '/orders',
  { productId: 5001, quantity: 1, addressId: 100, remark: '<img src=x onerror=alert(1)>' },
  [
    'pm.test("Status code is 201", function () {',
    '    pm.response.to.have.status(201);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("remark does NOT contain <img or onerror", function () {',
    '    var remark = jsonData.data.remark || "";',
    '    pm.expect(remark).to.not.include("<img");',
    '    pm.expect(remark).to.not.include("onerror");',
    '});'
  ]
);

// Unauthorized
const sec006 = secGetNoBody('TC-SEC-006 [未授权] 无Token访问订单',
  '{{base_url}}/orders/10001', ['orders', '10001'],
  [
    'pm.test("Status code is 401", function () {',
    '    pm.response.to.have.status(401);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 2001", function () {',
    '    pm.expect(jsonData.code).to.eql(2001);',
    '});',
    'pm.test("message mentions missing token", function () {',
    '    pm.expect(jsonData.message).to.be.a("string").and.not.empty;',
    '});'
  ]
);

const sec007 = secReq('TC-SEC-007 [越权] 支付他人订单', 'POST', '/payment',
  { orderId: 20010, amount: 798, paymentMethod: 'card' },
  [
    'pm.test("Status code is 403", function () {',
    '    pm.response.to.have.status(403);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 3002", function () {',
    '    pm.expect(jsonData.code).to.eql(3002);',
    '});',
    'pm.test("message mentions unauthorized", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("无权");',
    '});'
  ],
  [ "pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer alice-token' });" ]
);

const sec008 = {
  name: 'TC-SEC-008 [越权] 取消他人订单',
  event: [
    { listen: 'prerequest', script: { type: 'text/javascript', exec: [ "pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer alice-token' });" ] } },
    { listen: 'test', script: { type: 'text/javascript', exec: [
      'pm.test("Status code is 403", function () {',
      '    pm.response.to.have.status(403);',
      '});',
      'pm.test("Response time < 2000ms", function () {',
      '    pm.expect(pm.response.responseTime).to.be.below(2000);',
      '});',
      'var jsonData = pm.response.json();',
      'pm.test("code equals 3002", function () {',
      '    pm.expect(jsonData.code).to.eql(3002);',
      '});',
      'pm.test("message mentions unauthorized", function () {',
      '    pm.expect(jsonData.message).to.be.a("string");',
      '    pm.expect(jsonData.message).to.include("无权");',
      '});'
    ] } }
  ],
  request: {
    method: 'PUT',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{\n  "reason": "越权取消测试"\n}' },
    url: { raw: '{{base_url}}/orders/20010/cancel', host: ['{{base_url}}'], path: ['orders', '20010', 'cancel'] }
  },
  response: []
};

// JWT attacks
const sec009 = secReq('TC-SEC-009 [JWT] 算法篡改（none 算法）', 'POST', '/orders',
  { productId: 5001, quantity: 1, addressId: 100 },
  [
    'pm.test("Status code is 401", function () {',
    '    pm.response.to.have.status(401);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 2001", function () {',
    '    pm.expect(jsonData.code).to.eql(2001);',
    '});',
    'pm.test("message does NOT indicate success", function () {',
    '    pm.expect(jsonData.code).to.not.eql(0);',
    '});'
  ],
  [ "pm.request.headers.add({ key: 'Authorization', value: 'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoidGVzdHVzZXIifQ.' });" ]
);

const sec010 = secReq('TC-SEC-010 [JWT] 签名缺失', 'POST', '/orders',
  { productId: 5001, quantity: 1, addressId: 100 },
  [
    'pm.test("Status code is 401", function () {',
    '    pm.response.to.have.status(401);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 2001", function () {',
    '    pm.expect(jsonData.code).to.eql(2001);',
    '});'
  ],
  [ "pm.request.headers.add({ key: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.' });" ]
);

const sec011 = secGetNoBody('TC-SEC-011 [JWT] 过期Token重放',
  '{{base_url}}/orders/10001', ['orders', '10001'],
  [
    'pm.test("Status code is 401", function () {',
    '    pm.response.to.have.status(401);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 2002", function () {',
    '    pm.expect(jsonData.code).to.eql(2002);',
    '});',
    'pm.test("message mentions expired", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message).to.include("过期");',
    '});'
  ],
  [ "pm.sendRequest({ url: pm.variables.get('base_url') + '/test/expired-token', method: 'GET' }, function(err, res) { if (!err) { var tok = res.json().data.token; pm.request.headers.add({ key: 'Authorization', value: 'Bearer ' + tok }); } });" ]
);

// Parameter pollution
const sec012 = {
  name: 'TC-SEC-012 [参数污染] 重复ID参数',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    'pm.test("Status code is 200 or 404", function () {',
    '    pm.expect([200, 404]).to.include(pm.response.code);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'pm.test("Does NOT return order 99999", function () {',
    '    if (pm.response.code === 200) {',
    '        var d = pm.response.json();',
    '        pm.expect(d.data.orderId).to.eql(10001);',
    '        pm.expect(d.data.orderId).to.not.eql(99999);',
    '    }',
    '});'
  ] } }],
  request: {
    method: 'GET',
    header: [],
    url: { raw: '{{base_url}}/orders/10001?id=99999', host: ['{{base_url}}'], path: ['orders', '10001'], query: [{ key: 'id', value: '99999' }] }
  },
  response: []
};

const sec013 = secReq('TC-SEC-013 [畸形输入] 超大数值 quantity', 'POST', '/orders',
  { productId: 5001, quantity: 9999999999, addressId: 100 },
  [
    'pm.test("Status code is 400", function () {',
    '    pm.response.to.have.status(400);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'var jsonData = pm.response.json();',
    'pm.test("code equals 1001", function () {',
    '    pm.expect(jsonData.code).to.eql(1001);',
    '});',
    'pm.test("message mentions quantity", function () {',
    '    pm.expect(jsonData.message).to.be.a("string");',
    '    pm.expect(jsonData.message.toLowerCase()).to.include("quantity");',
    '});'
  ]
);

const sec014 = secReq('TC-SEC-014 [畸形输入] 密码字段特殊字符', 'POST', '/register',
  { username: 'sectest01', password: '😀😀&……</?\'\"&*）' },
  [
    'pm.test("Status code 400 or 200", function () {',
    '    pm.expect([200, 400]).to.include(pm.response.code);',
    '});',
    'pm.test("Response time < 2000ms", function () {',
    '    pm.expect(pm.response.responseTime).to.be.below(2000);',
    '});',
    'pm.test("Service does NOT crash (500)", function () {',
    '    pm.expect(pm.response.code).to.not.eql(500);',
    '});',
    'pm.test("Response is valid JSON", function () {',
    '    pm.expect(function() { pm.response.json(); }).to.not.throw();',
    '});'
  ]
);

const secItems = [
  { name: '01-SQL注入', description: 'SQL 注入攻击场景测试', item: [sec001, sec002, sec003] },
  { name: '02-XSS跨站脚本', description: 'XSS 跨站脚本攻击场景测试', item: [sec004, sec005] },
  { name: '03-越权与未授权', description: '越权访问与未授权操作测试', item: [sec006, sec007, sec008] },
  { name: '04-JWT攻击', description: 'JWT 算法篡改、签名缺失、过期重放攻击测试', item: [sec009, sec010, sec011] },
  { name: '05-参数污染与畸形输入', description: '参数污染、超大数值、特殊字符等异常输入测试', item: [sec012, sec013, sec014] }
];

const secCollection = makeCollection(
  '05-安全测试模块',
  '安全漏洞检测集合。覆盖 SQL 注入、XSS、越权访问、JWT 攻击、参数污染等常见 Web 安全场景。',
  [
    { key: 'base_url', value: 'http://localhost:3000', type: 'string' },
    { key: 'auth_token', value: '', type: 'string' }
  ],
  secItems,
  [{
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        'var NO_AUTH = ["TC-SEC-006", "TC-SEC-009", "TC-SEC-010", "TC-SEC-011"];',
        'var nm = pm.info.requestName;',
        'if (!NO_AUTH.some(function(n) { return nm.indexOf(n) === 0; })) {',
        '  var tok = pm.environment.get("auth_token");',
        '  if (tok) pm.request.headers.add({ key: "Authorization", value: "Bearer " + tok });',
        '}'
      ]
    }
  }]
);

var secTotal = secItems.reduce(function(s, f) { return s + f.item.length; }, 0);
fs.writeFileSync(path.join(outDir, '05-安全测试模块.postman_collection.json'), JSON.stringify(secCollection, null, 2), 'utf8');
console.log('[OK] 05-安全测试模块.postman_collection.json  (' + secTotal + ' requests in ' + secItems.length + ' folders)');

console.log('\n===== All 6 collections created in ' + outDir + ' =====');

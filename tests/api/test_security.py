import requests
# 导入 requests 库，发 HTTP 请求

import base64
# 用于 Base64 编解码（修改 JWT 用）

import json
# 用于 JSON 序列化（构造 JWT payload）

from conftest import BASE_URL
# 从 conftest.py 引入 BASE_URL


# ==================== 认证安全 ====================

def test_no_token():
    """TC-SEC-001 无 Token 访问受保护接口"""
    resp = requests.get(f"{BASE_URL}/orders")
    # 不带 Authorization 头请求订单接口
    assert resp.status_code == 401
    # 401 = 未认证
    body = resp.json()
    assert body["code"] == 2001
    # 2001 = 未提供 Token


def test_expired_token():
    """TC-SEC-002 过期 Token"""
    resp = requests.get(f"{BASE_URL}/test/expired-token")
    # 从测试接口获取一个已过期的 Token
    expired_token = resp.json()["data"]["token"]
    # 取出过期 token
    headers = {"Authorization": f"Bearer {expired_token}"}
    # 拼请求头（token 已过期）
    resp2 = requests.get(f"{BASE_URL}/orders", headers=headers)
    # 用过期 token 请求订单接口
    assert resp2.status_code == 401
    # 401 = 未认证
    body = resp2.json()
    assert body["code"] == 2002
    # 2002 = Token 已过期


def test_tampered_token(token):
    """TC-SEC-003 篡改 Token（修改 payload 后重签名不符）"""
    parts = token.split(".")
    # JWT 格式：header.payload.signature，按 . 分割
    header_b64 = parts[0]
    payload_b64 = parts[1]
    signature = parts[2]
    # 拆成三部分

    payload_bytes = base64.urlsafe_b64decode(payload_b64 + "==")
    # Base64 解码 payload（加 == 补齐）
    payload = json.loads(payload_bytes)
    # 把 JSON 字符串转成字典
    payload["userId"] = 2
    # 把 userId 改成 2（原本是 1）
    new_payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).decode().rstrip("=")
    # 重新 Base64 编码（去掉末尾的 =）

    tampered_token = f"{header_b64}.{new_payload_b64}.{signature}"
    # 拼回三段，但签名还是旧的，对不上 → 无效

    headers = {"Authorization": f"Bearer {tampered_token}"}
    resp = requests.get(f"{BASE_URL}/orders", headers=headers)
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001
    # 2001 = Token 无效


def test_none_algorithm(token):
    """TC-SEC-004 none 算法攻击"""
    parts = token.split(".")
    # 拆 JWT
    payload_b64 = parts[1]
    # 取 payload 部分

    none_header = '{"alg":"none","typ":"JWT"}'
    # 构造一个 alg:none 的 header
    none_header_b64 = base64.urlsafe_b64encode(
        none_header.encode()
    ).decode().rstrip("=")
    # Base64 编码

    none_token = f"{none_header_b64}.{payload_b64}."
    # payload 不变，签名部分为空

    headers = {"Authorization": f"Bearer {none_token}"}
    resp = requests.get(f"{BASE_URL}/orders", headers=headers)
    assert resp.status_code == 401
    # 服务端拒绝 none 算法


def test_missing_signature(token):
    """TC-SEC-005 签名缺失（仅 header.payload）"""
    parts = token.split(".")
    # 拆 JWT
    no_sig = f"{parts[0]}.{parts[1]}"
    # 只要 header 和 payload，不要签名部分

    headers = {"Authorization": f"Bearer {no_sig}"}
    resp = requests.get(f"{BASE_URL}/orders", headers=headers)
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001
    # 2001 = Token 无效


# ==================== 注入攻击 ====================

def test_sql_injection_login():
    """TC-SEC-006 SQL 注入 — 登录"""
    data = {"username": "' OR '1'='1", "password": "' OR '1'='1"}
    # SQL 注入 payload：永真条件
    resp = requests.post(f"{BASE_URL}/login", json=data)
    # 发送登录请求
    assert resp.status_code in [400, 401]
    # 应该被参数校验或凭证错误拦截，不能登录成功


def test_sql_injection_order_query(token):
    """TC-SEC-007 SQL 注入 — 订单查询"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/orders/' OR '1'='1", headers=headers)
    # 把 SQL 注入 payload 拼到 URL 里
    assert resp.status_code == 400
    # 400 = 参数校验拦截（非数字 ID）
    body = resp.json()
    assert body["code"] == 1001
    # 1001 = 参数校验失败


def test_xss_injection(token):
    """TC-SEC-008 XSS 脚本注入"""
    headers = {"Authorization": f"Bearer {token}"}
    data = {
        "productId": 5001, "quantity": 1, "addressId": 100,
        "remark": "<script>alert(1)</script>"
    }
    # 在 remark 字段注入 XSS 脚本
    resp = requests.post(f"{BASE_URL}/orders", json=data, headers=headers)
    assert resp.status_code == 201
    # 订单创建成功
    body = resp.json()
    remark = body["data"]["remark"]
    # 取出返回的 remark
    assert "<" not in remark or "&lt;" in remark
    # 尖括号被转义（HTML 实体编码），不会被浏览器执行


# ==================== 越权攻击 ====================

def test_horizontal_escalation_query(other_token):
    """TC-SEC-010 水平越权 — 查询订单"""
    headers = {"Authorization": f"Bearer {other_token}"}
    # 用 alice 的 token 去查 testuser 的订单
    resp = requests.get(f"{BASE_URL}/orders/20001", headers=headers)
    # 20001 是 abcd 的订单，alice 无权访问
    assert resp.status_code == 403
    # 403 = 禁止访问
    body = resp.json()
    assert body["code"] == 3002
    # 3002 = 无权访问


def test_horizontal_escalation_cancel(other_token):
    """TC-SEC-011 水平越权 — 取消订单"""
    headers = {"Authorization": f"Bearer {other_token}"}
    # 用 alice 的 token
    resp = requests.put(f"{BASE_URL}/orders/10001/cancel", headers=headers)
    # 尝试取消 testuser 的订单
    assert resp.status_code == 403
    body = resp.json()
    assert body["code"] == 3002


def test_horizontal_escalation_pay(other_token):
    """TC-SEC-012 水平越权 — 支付订单"""
    headers = {"Authorization": f"Bearer {other_token}"}
    # 用 alice 的 token
    resp = requests.post(f"{BASE_URL}/payment",
                         json={"orderId": 10001, "amount": 299},
                         headers=headers)
    # 尝试支付 testuser 的订单
    assert resp.status_code == 403
    body = resp.json()
    assert body["code"] == 3002


# ==================== JWT 专项 ====================

def test_bearer_prefix_removed(token):
    """TC-SEC-013 Bearer 前缀移除"""
    headers = {"Authorization": token}
    # Authorization 头直接传 token 字符串，没有 "Bearer " 前缀
    resp = requests.get(f"{BASE_URL}/orders", headers=headers)
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001
    # 2001 = 认证格式错误


def test_empty_token():
    """TC-SEC-014 空 Token"""
    headers = {"Authorization": "Bearer "}
    # Authorization 头只有 "Bearer "，后面是空的
    resp = requests.get(f"{BASE_URL}/orders", headers=headers)
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001


# ==================== 参数污染 ====================

def test_parameter_pollution():
    """TC-SEC-009 参数污染"""
    resp = requests.post(
        f"{BASE_URL}/login",
        data="username=testuser&password=Test@123456&password=hacked",
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    # 发送两个 password 字段（参数污染攻击），使用表单格式
    # 服务器应只取第一个或直接拒绝，不能因为第二个值而受影响
    assert resp.status_code in [200, 400]
    # 200 = 取第一个正确值  /  400 = 拒绝重复参数

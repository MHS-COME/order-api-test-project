import requests
# 导入 requests 库，发 HTTP 请求

import pytest
# 导入 pytest 框架，提供 parametrize 和 fixture

from conftest import BASE_URL
# 从 conftest.py 引入 BASE_URL（"http://localhost:3000"）


# ==================== 支付 正向 ====================

def test_payment_success(token):
    """TC-PAY-001 正常支付"""
    headers = {"Authorization": f"Bearer {token}"}
    # 拼请求头，带上 token

    create_data = {"productId": 5001, "quantity": 1, "addressId": 100}
    # 准备创建订单的数据

    create_resp = requests.post(f"{BASE_URL}/orders", json=create_data, headers=headers)
    # 第1步：创建一笔新订单

    order_id = create_resp.json()["data"]["orderId"]
    # 从响应里取出订单 ID

    total = create_resp.json()["data"]["totalAmount"]
    # 从响应里取出订单总金额

    pay_data = {"orderId": order_id, "amount": total}
    # 组装支付数据：订单 ID + 实际金额

    resp = requests.post(f"{BASE_URL}/payment", json=pay_data, headers=headers)
    # 第2步：发起支付

    assert resp.status_code == 200
    # HTTP 200 = 支付成功

    body = resp.json()
    # 解析响应 JSON

    assert body["code"] == 0
    # 业务码 0 = 成功

    assert body["data"]["status"] == "PAID"
    # 支付后状态变为 PAID

    assert body["data"]["transactionId"].startswith("TXN")
    # 交易流水号以 TXN 开头

    assert body["data"]["paidAt"] is not None
    # 支付时间不为空


# ==================== 支付 反向 — 参数校验 ====================

@pytest.mark.parametrize("data,expected_word", [
    ({"amount": 299}, "orderId"),
    # TC-PAY-002：缺少 orderId，message 里应包含 "orderId"

    ({"orderId": 10001}, "amount"),
    # TC-PAY-003：缺少 amount，message 里应包含 "amount"
])
def test_payment_bad_request(token, data, expected_word):
    """支付 — 参数校验失败"""
    headers = {"Authorization": f"Bearer {token}"}
    # 拼请求头

    resp = requests.post(f"{BASE_URL}/payment", json=data, headers=headers)
    # 发支付请求，body 缺字段

    assert resp.status_code == 400
    # 400 = 参数错误

    body = resp.json()
    # 解析响应

    assert body["code"] == 1001
    # 1001 = 参数校验失败

    assert expected_word in body["message"]
    # 确认 message 指出了哪个字段的问题


def test_payment_wrong_amount(token):
    """TC-PAY-009 金额与订单不符"""
    headers = {"Authorization": f"Bearer {token}"}
    # 拼请求头

    create_data = {"productId": 5001, "quantity": 1, "addressId": 100}
    # 准备创建订单

    create_resp = requests.post(f"{BASE_URL}/orders", json=create_data, headers=headers)
    # 第1步：创建订单

    order_id = create_resp.json()["data"]["orderId"]
    # 取出订单 ID

    resp = requests.post(f"{BASE_URL}/payment",
                         json={"orderId": order_id, "amount": 9999},
                         headers=headers)
    # 第2步：支付，但金额故意给错（实际约 149，给 9999）

    assert resp.status_code == 400
    # 400 = 金额校验失败

    body = resp.json()
    # 解析响应

    assert body["code"] == 1005
    # 1005 = 金额与订单不匹配

    assert "金额" in body["message"]
    # message 里提到"金额"


# ==================== 支付 反向 — 资源/越权 ====================

def test_payment_order_not_found(token):
    """TC-PAY-004 支付不存在的订单"""
    headers = {"Authorization": f"Bearer {token}"}
    # 拼请求头

    resp = requests.post(f"{BASE_URL}/payment",
                         json={"orderId": 99999, "amount": 100},
                         headers=headers)
    # 支付一个不存在的订单 ID

    assert resp.status_code == 404
    # 404 = 资源不存在

    body = resp.json()
    # 解析响应

    assert body["code"] == 3001
    # 3001 = 订单不存在


def test_payment_other_user(other_token):
    """TC-PAY-005 越权支付别人订单"""
    headers = {"Authorization": f"Bearer {other_token}"}
    # 用 alice 的 token 去支付 testuser 的订单

    resp = requests.post(f"{BASE_URL}/payment",
                         json={"orderId": 10001, "amount": 299},
                         headers=headers)
    # 支付 testuser 的订单

    assert resp.status_code == 403
    # 403 = 无权限

    body = resp.json()
    # 解析响应

    assert body["code"] == 3002
    # 3002 = 无权限操作此订单


# ==================== 支付 反向 — 状态冲突 ====================

def test_payment_duplicate(token):
    """TC-PAY-006 重复支付（幂等性）"""
    headers = {"Authorization": f"Bearer {token}"}
    # 拼请求头

    create_data = {"productId": 5001, "quantity": 1, "addressId": 100}
    # 准备创建订单

    create_resp = requests.post(f"{BASE_URL}/orders", json=create_data, headers=headers)
    # 第1步：创建订单

    order_id = create_resp.json()["data"]["orderId"]
    # 取出订单 ID

    total = create_resp.json()["data"]["totalAmount"]
    # 取出订单金额

    pay_data = {"orderId": order_id, "amount": total}
    # 组装支付数据

    r1 = requests.post(f"{BASE_URL}/payment", json=pay_data, headers=headers)
    # 第一次支付 — 应该成功

    assert r1.status_code == 200
    # 确认第一次支付成功

    r2 = requests.post(f"{BASE_URL}/payment", json=pay_data, headers=headers)
    # 第二次支付同一订单 — 应该被拒绝

    assert r2.status_code == 409
    # 409 = 状态冲突（已支付，不能重复支付）

    body = r2.json()
    # 解析第二次的响应

    assert body["code"] == 4003
    # 4003 = 订单已支付

    assert "已支付" in body["message"]
    # message 包含"已支付"


def test_payment_cancelled_order(token):
    """TC-PAY-007 支付已取消订单"""
    headers = {"Authorization": f"Bearer {token}"}
    # 拼请求头

    resp = requests.post(f"{BASE_URL}/payment",
                         json={"orderId": 10003, "amount": 100},
                         headers=headers)
    # 10003 是 CANCELLED 状态，不能支付

    assert resp.status_code == 409
    # 409 = 状态冲突

    body = resp.json()
    # 解析响应

    assert body["code"] == 4003
    # 4003 = 订单状态不允许支付


def test_payment_timeout_order(token):
    """TC-PAY-008 支付超时订单"""
    headers = {"Authorization": f"Bearer {token}"}
    # 拼请求头

    resp = requests.post(f"{BASE_URL}/payment",
                         json={"orderId": 10001, "amount": 299},
                         headers=headers)
    # 10001 创建时间超过 30 分钟，已超时关闭

    assert resp.status_code == 409
    # 409 = 状态冲突

    body = resp.json()
    # 解析响应

    assert body["code"] == 4004
    # 4004 = 订单超时关闭

    assert "超时" in body["message"]
    # message 包含"超时"


def test_payment_no_token():
    """无 Token 支付"""
    resp = requests.post(f"{BASE_URL}/payment",
                         json={"orderId": 10001, "amount": 299})
    # 不带 headers，没有 token

    assert resp.status_code == 401
    # 401 = 未认证

    body = resp.json()
    # 解析响应

    assert body["code"] == 2001
    # 2001 = 未提供 Token

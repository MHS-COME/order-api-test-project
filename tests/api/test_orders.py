import requests
import pytest
from conftest import BASE_URL


# ==================== 创建订单 正向 ====================

@pytest.mark.parametrize("data,expected_total", [
    ({"productId": 5001, "quantity": 2, "addressId": 100, "remark": "请尽快发货"}, 299.00),
    ({"productId": 5001, "quantity": 1, "addressId": 100}, 149.50),
    ({"productId": 5002, "quantity": 999, "addressId": 100}, 398601),
])
def test_create_order_success(token, data, expected_total):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/orders", json=data, headers=headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["status"] == "PENDING"
    assert body["data"]["totalAmount"] == expected_total
    assert body["data"]["orderNo"].startswith("ORD")


def test_create_order_remark_200_chars(token):
    data = {
        "productId": 5001, "quantity": 1, "addressId": 100,
        "remark": "测" * 200
    }
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/orders", json=data, headers=headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["code"] == 0
    assert len(body["data"]["remark"]) == 200


# ==================== 创建订单 反向 ====================

@pytest.mark.parametrize("data,expected_word", [
    ({"quantity": 1, "addressId": 100}, "productId"),
    ({"productId": 0, "quantity": 1, "addressId": 100}, "productId"),
    ({"productId": -1, "quantity": 1, "addressId": 100}, "productId"),
    ({"productId": 5001, "quantity": 0, "addressId": 100}, "quantity"),
    ({"productId": 5001, "quantity": 1000, "addressId": 100}, "quantity"),
])
def test_create_order_bad_request(token, data, expected_word):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/orders", json=data, headers=headers)
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 1001
    assert expected_word in body["message"]


def test_create_order_no_token():
    data = {"productId": 5001, "quantity": 1, "addressId": 100}
    resp = requests.post(f"{BASE_URL}/orders", json=data)
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001


# ==================== 订单列表 ====================

def test_order_list(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/orders", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert isinstance(body["data"]["orders"], list)
    assert body["data"]["total"] >= 0


# ==================== 查询订单详情 正向 ====================

def test_get_order(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/orders/10001", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["orderId"] == 10001


def test_get_order_cancelled(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/orders/10003", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["status"] == "CANCELLED"


# ==================== 查询订单详情 反向 ====================

def test_get_order_not_found(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/orders/99999", headers=headers)
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == 3001


def test_get_order_invalid_id(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/orders/abc", headers=headers)
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 1001


def test_get_order_other_user(other_token):
    headers = {"Authorization": f"Bearer {other_token}"}
    resp = requests.get(f"{BASE_URL}/orders/10001", headers=headers)
    assert resp.status_code == 403
    body = resp.json()
    assert body["code"] == 3002


def test_get_order_no_token():
    resp = requests.get(f"{BASE_URL}/orders/10001")
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001


# ==================== 取消订单 正向 ====================

def test_cancel_order(token):
    headers = {"Authorization": f"Bearer {token}"}
    create_data = {"productId": 5001, "quantity": 1, "addressId": 100}
    create_resp = requests.post(f"{BASE_URL}/orders", json=create_data, headers=headers)
    order_id = create_resp.json()["data"]["orderId"]
    resp = requests.put(f"{BASE_URL}/orders/{order_id}/cancel", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["status"] == "CANCELLED"
    assert body["data"]["cancelledAt"] is not None


def test_cancel_order_with_reason(token):
    headers = {"Authorization": f"Bearer {token}"}
    create_data = {"productId": 5001, "quantity": 1, "addressId": 100}
    create_resp = requests.post(f"{BASE_URL}/orders", json=create_data, headers=headers)
    order_id = create_resp.json()["data"]["orderId"]
    resp = requests.put(f"{BASE_URL}/orders/{order_id}/cancel", headers=headers,
                        json={"reason": "不想要了"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0


# ==================== 取消订单 反向 ====================

def test_cancel_order_not_found(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.put(f"{BASE_URL}/orders/99999/cancel", headers=headers)
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == 3001


def test_cancel_order_other_user(other_token):
    headers = {"Authorization": f"Bearer {other_token}"}
    resp = requests.put(f"{BASE_URL}/orders/10001/cancel", headers=headers)
    assert resp.status_code == 403
    body = resp.json()
    assert body["code"] == 3002


def test_cancel_shipped_order(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.put(f"{BASE_URL}/orders/10002/cancel", headers=headers)
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == 4001
    assert body["data"]["currentStatus"] == "SHIPPED"


def test_cancel_cancelled_order(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.put(f"{BASE_URL}/orders/10003/cancel", headers=headers)
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == 4002


def test_cancel_paid_order(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.put(f"{BASE_URL}/orders/20012/cancel", headers=headers)
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == 4005
    assert "已支付" in body["message"]


def test_cancel_order_no_token():
    resp = requests.put(f"{BASE_URL}/orders/10001/cancel")
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001

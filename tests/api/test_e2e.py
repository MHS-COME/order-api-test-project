import requests
import random
from conftest import BASE_URL


def test_e2e_full_flow():

    # 1. 注册
    username = f"e2euser_{random.randint(1000, 9999)}"
    reg_data = {"username": username, "password": "Test@123", "email": f"{username}@test.com"}
    reg_resp = requests.post(f"{BASE_URL}/register", json=reg_data)
    assert reg_resp.status_code == 200
    reg_body = reg_resp.json()
    assert reg_body["code"] == 0
    assert reg_body["data"]["username"] == username

    # 2. 登录
    login_data = {"username": username, "password": "Test@123"}
    login_resp = requests.post(f"{BASE_URL}/login", json=login_data)
    assert login_resp.status_code == 200
    login_body = login_resp.json()
    assert login_body["code"] == 0
    token = login_body["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 3. 创建订单
    order_data = {
        "productId": 5001, "quantity": 2, "addressId": 100,
        "remark": "E2E 全链路测试订单"
    }
    order_resp = requests.post(f"{BASE_URL}/orders", json=order_data, headers=headers)
    assert order_resp.status_code == 201
    order_body = order_resp.json()
    assert order_body["code"] == 0
    order_id = order_body["data"]["orderId"]
    total = order_body["data"]["totalAmount"]
    assert order_body["data"]["status"] == "PENDING"

    # 4. 支付
    pay_data = {"orderId": order_id, "amount": total}
    pay_resp = requests.post(f"{BASE_URL}/payment", json=pay_data, headers=headers)
    assert pay_resp.status_code == 200
    pay_body = pay_resp.json()
    assert pay_body["code"] == 0
    assert pay_body["data"]["status"] == "PAID"
    assert pay_body["data"]["transactionId"].startswith("TXN")
    assert pay_body["data"]["paidAt"] is not None

    # 5. 查询确认
    get_resp = requests.get(f"{BASE_URL}/orders/{order_id}", headers=headers)
    assert get_resp.status_code == 200
    get_body = get_resp.json()
    assert get_body["code"] == 0
    assert get_body["data"]["status"] == "PAID"

    # 6. 已支付不可取消
    cancel_resp = requests.put(f"{BASE_URL}/orders/{order_id}/cancel", headers=headers)
    assert cancel_resp.status_code == 409
    cancel_body = cancel_resp.json()
    assert cancel_body["code"] == 4005
    assert "已支付" in cancel_body["message"]

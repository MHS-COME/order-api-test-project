import requests
import pytest
from conftest import BASE_URL


# ==================== 刷新 Token 正向 ====================

def test_refresh_success():
    """TC-REF-001 正常刷新 Token"""
    login_data = {"username": "testuser", "password": "Test@123456"}
    login_resp = requests.post(f"{BASE_URL}/login", json=login_data)
    refresh_token = login_resp.json()["data"]["refreshToken"]

    resp = requests.post(f"{BASE_URL}/refresh", json={"refreshToken": refresh_token})
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert len(body["data"]["token"]) > 10
    assert body["data"]["tokenType"] == "Bearer"
    assert body["data"]["expiresIn"] == 3600


# ==================== 刷新 Token 反向 ====================

def test_refresh_no_token():
    """TC-REF-002 不传 refreshToken"""
    resp = requests.post(f"{BASE_URL}/refresh", json={})
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 1001
    assert "refreshToken" in body["message"]


def test_refresh_invalid_token():
    """TC-REF-003 无效的 refreshToken"""
    resp = requests.post(f"{BASE_URL}/refresh", json={"refreshToken": "this_is_garbage"})
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001


def test_refresh_using_access_token(token):
    """TC-REF-004 拿 access token 冒充 refresh token"""
    resp = requests.post(f"{BASE_URL}/refresh", json={"refreshToken": token})
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 2001
    assert "刷新" in body["message"]


def test_refresh_new_token_works():
    """TC-REF-005 刷新后的新 token 可以正常访问接口"""
    login_data = {"username": "testuser", "password": "Test@123456"}
    login_resp = requests.post(f"{BASE_URL}/login", json=login_data)
    refresh_token = login_resp.json()["data"]["refreshToken"]

    refresh_resp = requests.post(f"{BASE_URL}/refresh", json={"refreshToken": refresh_token})
    new_token = refresh_resp.json()["data"]["token"]
    headers = {"Authorization": f"Bearer {new_token}"}

    resp = requests.get(f"{BASE_URL}/orders", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0

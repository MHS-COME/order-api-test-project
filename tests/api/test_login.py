import requests
import pytest

@pytest.mark.parametrize("username,password", [
    ("testuser", "Test@123456"),                                          # TC-LOGIN-001 正常登录
    ("abcd", "T@1234"),                                                   # TC-LOGIN-002/004 用户名4字符 + 密码6字符边界
    ("abcdefghijklmnopqrstuvwxyz012345", "Test@123456"),                  # TC-LOGIN-003 用户名32字符边界
    ("pwdtest", "T@1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"),  # TC-LOGIN-005 密码64字符边界
])
def test_login_success(username, password):
    """正向登录 — 多种合法凭证"""
    data = {"username": username, "password": password}
    resp = requests.post("http://localhost:3000/login", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert len(body["data"]["token"]) > 10
    assert len(body["data"]["refreshToken"]) > 10
    assert body["data"]["tokenType"] == "Bearer"
    assert body["data"]["expiresIn"] == 3600


@pytest.mark.parametrize("data,expected_word", [
    ({"password": "Test@123456"}, "username"),                           # TC-LOGIN-006 缺少username
    ({"username": "testuser"}, "password"),                              # TC-LOGIN-007 缺少password
    ({"username": "abc", "password": "T@1234"}, "username"),             # TC-LOGIN-009 username过短（3字符）
    ({"username": "testuser", "password": "T@123"}, "password"),         # TC-LOGIN-010 password过短（5字符）
])
def test_login_bad_request(data, expected_word):
    """参数校验失败 — 缺字段 / 边界值过短"""
    resp = requests.post("http://localhost:3000/login", json=data)
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 1001
    assert expected_word in body["message"]


def test_login_wrong_password():
    """TC-LOGIN-008 密码错误"""
    data = {"username": "testuser", "password": "wrongpassword"}
    resp = requests.post("http://localhost:3000/login", json=data)
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == 1002
    assert "用户名或密码错误" in body["message"]

import random
import requests
import pytest

@pytest.mark.parametrize("base_username,password,email", [
    ("newuser", "Test@123", "new@test.com"),
    ("user2", "Pass@123", None),
])
def test_register_success(base_username, password, email):
    username = f"{base_username}_{random.randint(1000, 9999)}"
    data = {"username": username, "password": password}
    if email is not None:
        data["email"] = email
    resp = requests.post("http://localhost:3000/register", json=data)
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["username"] == username
    assert body["data"]["email"] == email


@pytest.mark.parametrize("data,expected_word", [
    ({"password": "Test@123"}, "username"),           # REG-003 缺username
    ({"username": "user3"}, "password"),              # REG-004 缺password
    ({"username": "abc", "password": "Test@123"}, "username"),  # REG-006 username过短
])
def test_register_bad_request(data, expected_word):
    resp = requests.post("http://localhost:3000/register", json=data)
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 1001
    assert expected_word in body["message"]


def test_register_duplicate():
    data = {"username": "testuser", "password": "Test@123"}
    resp = requests.post("http://localhost:3000/register", json=data)
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == 1003
    assert "用户名已存在" in body["message"]

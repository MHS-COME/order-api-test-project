import requests
from conftest import BASE_URL


def test_get_user_info(access_token, openid):
    resp = requests.get(f"{BASE_URL}/cgi-bin/user/info", params={
        "access_token": access_token,
        "openid": openid,
        "lang": "zh_CN"
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["subscribe"] == 1
    assert body["openid"] == openid
    assert "nickname" in body


def test_user_info_invalid_openid(access_token):
    resp = requests.get(f"{BASE_URL}/cgi-bin/user/info", params={
        "access_token": access_token,
        "openid": "invalid_openid_12345",
        "lang": "zh_CN"
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] != 0


def test_user_info_no_openid(access_token):
    resp = requests.get(f"{BASE_URL}/cgi-bin/user/info", params={
        "access_token": access_token,
        "lang": "zh_CN"
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] != 0


def test_user_info_no_token():
    resp = requests.get(f"{BASE_URL}/cgi-bin/user/info", params={
        "openid": "openid_test",
        "lang": "zh_CN"
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] in [40001, 41001]


def test_user_info_fields(access_token, openid):
    resp = requests.get(f"{BASE_URL}/cgi-bin/user/info", params={
        "access_token": access_token,
        "openid": openid,
        "lang": "zh_CN"
    })
    assert resp.status_code == 200
    body = resp.json()
    for field in ["subscribe", "openid", "nickname", "sex", "language", "city", "province", "country", "headimgurl"]:
        assert field in body

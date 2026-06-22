import requests
from conftest import BASE_URL

TEMPLATE_DATA = {
    "first": {"value": "测试标题", "color": "#173177"},
    "keyword1": {"value": "测试内容一行", "color": "#173177"},
    "keyword2": {"value": "2025-06-22", "color": "#173177"},
    "remark": {"value": "测试备注信息", "color": "#173177"}
}


def test_send_template(access_token, openid, template_id):
    body = {
        "touser": openid,
        "template_id": template_id,
        "data": TEMPLATE_DATA
    }
    resp = requests.post(f"{BASE_URL}/cgi-bin/message/template/send", params={"access_token": access_token}, json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["errcode"] == 0
    assert data["msgid"] is not None


def test_send_template_invalid_openid(access_token, template_id):
    body = {
        "touser": "invalid_openid_12345",
        "template_id": template_id,
        "data": TEMPLATE_DATA
    }
    resp = requests.post(f"{BASE_URL}/cgi-bin/message/template/send", params={"access_token": access_token}, json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["errcode"] != 0


def test_send_template_invalid_template_id(access_token, openid):
    body = {
        "touser": openid,
        "template_id": "invalid_template_id_12345",
        "data": TEMPLATE_DATA
    }
    resp = requests.post(f"{BASE_URL}/cgi-bin/message/template/send", params={"access_token": access_token}, json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["errcode"] != 0


def test_send_template_no_openid(access_token, template_id):
    body = {
        "touser": "",
        "template_id": template_id,
        "data": TEMPLATE_DATA
    }
    resp = requests.post(f"{BASE_URL}/cgi-bin/message/template/send", params={"access_token": access_token}, json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["errcode"] != 0


def test_send_template_missing_touser(access_token, template_id):
    body = {
        "template_id": template_id,
        "data": TEMPLATE_DATA
    }
    resp = requests.post(f"{BASE_URL}/cgi-bin/message/template/send", params={"access_token": access_token}, json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["errcode"] != 0


def test_send_template_no_token(openid, template_id):
    body = {
        "touser": openid,
        "template_id": template_id,
        "data": TEMPLATE_DATA
    }
    resp = requests.post(f"{BASE_URL}/cgi-bin/message/template/send", json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["errcode"] in [40001, 41001]

import requests
from conftest import BASE_URL

MENU_DATA = {
    "button": [
        {"type": "click", "name": "music", "key": "MUSIC_001"},
        {"type": "view", "name": "search", "url": "https://www.baidu.com"},
        {"type": "click", "name": "help", "key": "HELP_001"}
    ]
}


def test_create_menu(access_token):
    resp = requests.post(f"{BASE_URL}/cgi-bin/menu/create", params={"access_token": access_token}, json=MENU_DATA)
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] == 0


def test_get_menu(access_token):
    requests.post(f"{BASE_URL}/cgi-bin/menu/create", params={"access_token": access_token}, json=MENU_DATA)
    resp = requests.get(f"{BASE_URL}/cgi-bin/menu/get", params={"access_token": access_token})
    assert resp.status_code == 200
    body = resp.json()
    assert "menu" in body
    assert "button" in body["menu"]
    assert len(body["menu"]["button"]) == 3


def test_delete_menu(access_token):
    resp = requests.get(f"{BASE_URL}/cgi-bin/menu/delete", params={"access_token": access_token})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] == 0


def test_get_menu_after_delete(access_token):
    requests.get(f"{BASE_URL}/cgi-bin/menu/delete", params={"access_token": access_token})
    resp = requests.get(f"{BASE_URL}/cgi-bin/menu/get", params={"access_token": access_token})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] in [0, 46003]


def test_create_menu_invalid_json(access_token):
    resp = requests.post(f"{BASE_URL}/cgi-bin/menu/create", params={"access_token": access_token}, json={"button": "invalid"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] != 0


def test_create_menu_empty_body(access_token):
    resp = requests.post(f"{BASE_URL}/cgi-bin/menu/create", params={"access_token": access_token}, json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] != 0


def test_create_menu_no_token():
    resp = requests.post(f"{BASE_URL}/cgi-bin/menu/create", json=MENU_DATA)
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] in [40001, 41001]


def test_delete_menu_twice(access_token):
    requests.get(f"{BASE_URL}/cgi-bin/menu/delete", params={"access_token": access_token})
    resp = requests.get(f"{BASE_URL}/cgi-bin/menu/delete", params={"access_token": access_token})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] in [0, 46003]

import requests
import ipaddress
from conftest import BASE_URL


def test_get_callback_ip(access_token):
    resp = requests.get(f"{BASE_URL}/cgi-bin/getcallbackip", params={"access_token": access_token})
    assert resp.status_code == 200
    body = resp.json()
    assert "ip_list" in body
    assert isinstance(body["ip_list"], list)
    assert len(body["ip_list"]) > 0
    for ip in body["ip_list"]:
        ipaddress.ip_network(ip)


def test_get_callback_ip_no_token():
    resp = requests.get(f"{BASE_URL}/cgi-bin/getcallbackip")
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] in [40001, 41001]

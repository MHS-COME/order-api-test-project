import requests

def test_health():
    resp = requests.get("http://localhost:3000/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["status"] == "UP"

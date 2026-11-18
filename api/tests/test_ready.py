def test_ready_at_head(client):
    response = client.get("/api/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"

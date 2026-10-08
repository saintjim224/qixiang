"""业务展示边界与模拟处置的回归验证。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import decision
from app.core import dataio


def test_dispatch_recalculates_budget_and_saves_simulation(tmp_path, monkeypatch):
    monkeypatch.setattr(decision, "DISPATCH_LOG_FILE", tmp_path / "dispatch.json")
    client = TestClient(app)
    response = client.post("/api/decision/dispatch", json={
        "region_id": "naqu-seni", "hay_tons": 10, "grain_tons": 2,
        "feed_cost_wan": 999,
    })
    assert response.status_code == 200
    record = response.json()["record"]
    # 干草 10,000 kg × 0.85 + 精料 2,000 kg × 3.6 = 15,700 元。
    assert record["feed_cost_wan"] == 1.57
    assert record["status"] == "模拟登记"
    assert record["data_source"] == "runtime_simulation"
    assert "未对接金融系统" in record["credit_action"]
    saved = client.get("/api/decision/dispatch-logs").json()
    assert saved["logs"] == [record]
    assert saved["provenance"]["runtime_entries"] == 1


@pytest.mark.parametrize("changes,status", [
    ({"hay_tons": -1}, 422),
    ({"grain_tons": -1}, 422),
    ({"hay_tons": "NaN"}, 422),
    ({"grain_tons": "Infinity"}, 422),
    ({"region_id": "missing-county"}, 404),
])
def test_invalid_dispatch_does_not_write(tmp_path, monkeypatch, changes, status):
    target = tmp_path / "dispatch.json"
    monkeypatch.setattr(decision, "DISPATCH_LOG_FILE", target)
    payload = {"region_id": "naqu-seni", "hay_tons": 10, "grain_tons": 2, **changes}
    response = TestClient(app).post("/api/decision/dispatch", json=payload)
    assert response.status_code == status
    assert not target.exists()


def test_event_amounts_are_not_inferred_from_magnitude(monkeypatch):
    monkeypatch.setattr(dataio, "get_pu_labeled_dataset", lambda: ([{
        "region_id": "naqu-seni", "month": "2024-06", "event_type": "earthquake",
        "loss_amount": 642600, "claim_amount": 350000,
        "note": "原字段含义与单位尚未复核", "source_url": "https://example.org/report",
    }], []))
    response = TestClient(app).get("/api/datasource/verified-events")
    assert response.status_code == 200
    row = response.json()["events"][0]
    assert row["is_meteorological"] is False
    assert row["loss_amount_wan"] is None
    assert row["claim_amount_wan"] is None
    assert row["amount_status"] == "pending_review"

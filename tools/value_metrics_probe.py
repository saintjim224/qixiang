# -*- coding: utf-8 -*-
"""按 AIC 评分改稿所需的"价值量化指标"取数探针。

用途：为《参赛作品设计方案说明书》§5.3 提供可复现的真实数值，
     避免文档中出现任何未经计算的字面量。

运行：
    python tools/value_metrics_probe.py

口径说明：全部数值来自现有 API / 算法模块的真实输出，
         情景设定参数（单价、存栏、损失率）一律随输出显式打印，便于在文档中披露。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

# GB/T 20482 轻度雪灾积雪阈值（cm），与 app/algorithm/disaster.py 内置阈值一致
SNOW_TRIGGER_CM = 5.0
# 补饲单价（元/kg），与 app/algorithm/carrying.py 的 calculate_feed_cost_wan 一致
PRICE_HAY = 0.85
PRICE_GRAIN = 3.60
# 情景设定存栏
HERD_SIZE = 1000
FEED_DAYS = 14


def _pct(a: float, b: float) -> float:
    return round((a - b) / a * 100, 1) if a else 0.0


def main() -> int:
    client = TestClient(app)
    out: dict = {}

    # ---------- B5 / B2 / B4：全域投放优先级 ----------
    r = client.get(f"/api/decision/priority-ranking?herd_size={HERD_SIZE}&days={FEED_DAYS}")
    print(f"[priority-ranking] HTTP {r.status_code}")
    if r.status_code == 200:
        d = r.json()
        counties = d.get("counties") or []
        totals = d.get("totals") or {}
        coverage = d.get("coverage") or {}
        quotas = [c.get("credit_quota_wan") for c in counties if c.get("credit_quota_wan") is not None]

        # 旧版"全域满额兜底"口径复算：feed_ratio 恒为 1.0
        full_hay = 4.0 * 1.05 * HERD_SIZE * FEED_DAYS / 1000.0  # 吨/县
        full_total_hay = full_hay * len(counties)
        actual_hay = totals.get("hay_tons") or 0.0
        saved_tons = round(full_total_hay - actual_hay, 1)
        saved_wan = round(saved_tons * 1000 * PRICE_HAY / 10000.0, 1)

        out["priority"] = {
            "county_count": len(counties),
            "coverage": coverage,
            "totals": totals,
            "credit_quota_range_wan": [min(quotas), max(quotas)] if quotas else None,
            "assumptions": {
                "herd_size_per_county": HERD_SIZE,
                "forecast_days": FEED_DAYS,
                "price_hay_yuan_per_kg": PRICE_HAY,
                "price_grain_yuan_per_kg": PRICE_GRAIN,
                "full_ration_kg_per_head_day": round(4.0 * 1.05, 2),
            },
            "b2_savings_vs_full_ration": {
                "full_ration_hay_tons": round(full_total_hay, 1),
                "actual_hay_tons": round(actual_hay, 1),
                "saved_hay_tons": saved_tons,
                "saved_cost_wan": saved_wan,
                "saved_pct": _pct(full_total_hay, actual_hay),
            },
        }
        # 预报源登记：本表全部指标由**本次预报窗口**驱动，而实时预报接口（Open-Meteo）
        # 可达与否会整体改变补饲档位——实测两个档位下 hay_tons 相差 2.7 倍、损失敞口相差 9 倍。
        # 不把来源写进结果，数字就会在不同人复跑时"对不上"，故强制随结果落盘并显式告警。
        realtime_n = d.get("realtime_counties")
        out["priority"]["forecast_source"] = {
            "realtime_counties": realtime_n,
            "county_count": len(counties),
            "regime": "realtime_forecast" if realtime_n else "climatological_projection",
            "note": "实时驱动县数为 0 时，全部档位由气候态外推序列驱动，资源需求整体偏高",
        }
        print(json.dumps(out["priority"], ensure_ascii=False, indent=2))
        if not realtime_n:
            print(
                f"\n[警告] 本轮 {len(counties)} 县全部由**气候态外推**驱动（realtime_counties=0）。\n"
                "        实时预报可达时，同口径的 hay_tons 与 loss_exposure_wan 会显著下降。\n"
                "        引用本文件数值时必须同时写明预报源档位。\n"
            )

    # ---------- B1：预警提前量 ----------
    regions = client.get("/api/overview/regions")
    region_ids = []
    if regions.status_code == 200:
        payload = regions.json()
        rows = payload.get("regions") if isinstance(payload, dict) else payload
        region_ids = [x.get("region_id") for x in (rows or []) if x.get("region_id")]

    leads = []
    for rid in region_ids:
        rr = client.get(f"/api/forecast/disaster/{rid}?days=30")
        if rr.status_code != 200:
            continue
        dd = rr.json()
        series = ((dd.get("forecast_series") or {}).get("snow_16")) or []
        lead = None
        for i, v in enumerate(series):
            if v is not None and v >= SNOW_TRIGGER_CM:
                lead = i + 1
                break
        if lead is not None:
            leads.append({"region_id": rid, "lead_days": lead,
                          "confidence_tier": dd.get("confidence_tier")})
    tiers: dict = {}
    for x in leads:
        tiers[x["confidence_tier"]] = tiers.get(x["confidence_tier"], 0) + 1

    out["lead_time"] = {
        "trigger_cm": SNOW_TRIGGER_CM,
        "counties_with_trigger": len(leads),
        "counties_probed": len(region_ids),
        "tier_breakdown": tiers,
        "detail": leads,
        "note": "提前量＝预报窗口内首次积雪达阈值的日序，非实际灾情发生日；"
                "气候态外推档（climatological_projection）只代表历史同期节律，不构成预警能力",
    }
    print(f"[lead-time] 触发县域 {len(leads)}/{len(region_ids)}，档位分布 {tiers}")

    # ---------- B8：干旱虚警抑制 ----------
    mc = client.get("/api/index/method-compare")
    if mc.status_code == 200:
        md = mc.json()
        counties = md.get("counties") or []
        suppressed = [
            c for c in counties
            if c.get("spi_class_old") and c.get("spi_class_new")
            and c["spi_class_old"] != c["spi_class_new"]
        ]
        out["drought_false_alarm"] = {
            "compared_counties": len([c for c in counties
                                      if c.get("spi_class_old") and c.get("spi_class_new")]),
            "class_changed": len(suppressed),
            "detail": [{"region_id": c.get("region_id"),
                        "old": c.get("spi_class_old"),
                        "new": c.get("spi_class_new")} for c in suppressed],
            "spi_summary": md.get("spi_summary"),
        }
        print(f"[drought] 等级变化县数 {len(suppressed)}")

    # ---------- B7：覆盖范围 ----------
    st = client.get("/api/overview/status")
    if st.status_code == 200:
        out["coverage_scope"] = st.json()

    out_path = ROOT / "tools" / "out" / "aic_value_metrics.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n已写入 {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

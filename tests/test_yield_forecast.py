"""
Unit tests for Grassland NPP Spatio-Temporal Forecasting & Baseline Benchmarking
(规格书 §4.4 标准实现测试)
"""

import pytest
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.main import app
from app.algorithm.yield_forecast import (
    load_npp_features_dataset,
    ClimatologicalMeanBaseline,
    LinearTrendBaseline,
    MovingAverageBaseline,
    MultivariateMeteoRegressor,
    evaluate_loyo_protocol,
    evaluate_loro_protocol,
    predict_single_county_npp,
)


@pytest.fixture(scope="module")
def npp_df():
    """全量 26 县 × 25 年数据集 fixture。"""
    df = load_npp_features_dataset()
    return df


def test_dataset_shape_and_integrity(npp_df):
    """验证数据集规约: 26 县 × 25 年 = 650 条样本，无缺失值。"""
    assert len(npp_df) == 650, f"Expected 650 rows, got {len(npp_df)}"
    assert npp_df["region_id"].nunique() == 26, "Expected 26 unique regions"
    assert npp_df["year"].nunique() == 25, "Expected 25 years (2001-2025)"
    assert npp_df["year"].min() == 2001
    assert npp_df["year"].max() == 2025

    # 验证关键特征无缺失
    required_cols = [
        "region_id", "region_name", "year", "longitude", "latitude", "altitude",
        "pasture_type", "n_pixels", "temp_mean_annual", "temp_growing_season",
        "precip_total_annual", "precip_growing_season", "spi", "snow_depth_cm", "npp"
    ]
    for col in required_cols:
        assert col in npp_df.columns, f"Missing required column: {col}"
        assert npp_df[col].isnull().sum() == 0, f"Column {col} has null values"

    # 验证 NPP 物理区间 (0.05 ~ 3.5 kgC/m²/yr)
    assert (npp_df["npp"] > 0.05).all()
    assert (npp_df["npp"] < 3.5).all()


def test_baselines_fit_predict(npp_df):
    """验证三条经典基线模型在测试切片上的拟合与推断行为。"""
    train_df = npp_df[npp_df["year"] < 2024]
    test_df = npp_df[npp_df["year"] == 2024]

    # Baseline 1
    b1 = ClimatologicalMeanBaseline().fit(train_df)
    p1 = b1.predict(test_df, protocol="loyo")
    assert len(p1) == len(test_df)
    assert not np.isnan(p1).any()

    # Baseline 2
    b2 = LinearTrendBaseline().fit(train_df)
    p2 = b2.predict(test_df, protocol="loyo")
    assert len(p2) == len(test_df)
    assert not np.isnan(p2).any()

    # Baseline 3
    b3 = MovingAverageBaseline(window=3).fit(train_df)
    p3 = b3.predict(test_df, protocol="loyo")
    assert len(p3) == len(test_df)
    assert not np.isnan(p3).any()


def test_loyo_evaluation(npp_df):
    """测试协议 A: 留一年交叉验证 (LOYO)。"""
    res = evaluate_loyo_protocol(npp_df)
    assert res["n_folds"] == 25
    assert res["n_samples"] == 650
    assert "models" in res

    models = res["models"]
    assert "Baseline 1: 历史气候态均值 (Clim Mean)" in models
    assert "Baseline 2: 线性趋势外推 (Linear Trend OLS)" in models
    assert "Baseline 3: 近3年移动平均 (3-Year MA)" in models
    assert "本系统方法: 多元气象驱动回归 (Meteo-Ridge)" in models

    our_model = models["本系统方法: 多元气象驱动回归 (Meteo-Ridge)"]
    # 验证 MAE 必须优于所有基线
    b1 = models["Baseline 1: 历史气候态均值 (Clim Mean)"]
    b2 = models["Baseline 2: 线性趋势外推 (Linear Trend OLS)"]
    b3 = models["Baseline 3: 近3年移动平均 (3-Year MA)"]

    assert our_model["mae"] < b1["mae"]
    assert our_model["mae"] < b2["mae"]
    assert our_model["mae"] < b3["mae"]
    assert our_model["reduction_vs_b1_pct"] > 0
    assert our_model["reduction_vs_b2_pct"] > 0
    assert our_model["reduction_vs_b3_pct"] > 0


def test_loro_evaluation(npp_df):
    """测试协议 B: 留一县交叉验证 (LORO)。"""
    res = evaluate_loro_protocol(npp_df)
    assert res["n_folds"] == 26
    assert res["n_samples"] == 650
    assert "models" in res

    models = res["models"]
    our_model = models["本系统方法: 多元环境梯度回归 (GBDT/XGBoost)"]
    b1 = models["Baseline 1: 历史气候态均值 (Clim Mean)"]

    # 空间迁移误差应明显优于均值基线
    assert our_model["mae"] < b1["mae"]
    assert our_model["reduction_vs_b1_pct"] > 10.0  # 相对降幅超 10%


def test_single_county_forecast():
    """测试单县 NPP 预报接口输出。"""
    res = predict_single_county_npp("naqu-seni", target_year=2026)
    assert res["region_id"] == "naqu-seni"
    assert res["target_year"] == 2026
    assert 0.1 < res["npp_forecast"] < 1.0
    assert len(res["npp_ci95"]) == 2
    assert res["npp_ci95"][0] < res["npp_forecast"] < res["npp_ci95"][1]
    assert res["equivalent_sheep_units"] > 50000
    assert "baselines_comparison" in res
    assert "driving_features" in res
    assert res["is_derived"] is True


def test_fastapi_endpoints():
    """通过 TestClient 测试 REST 路由。"""
    client = TestClient(app)

    # 1. 测试单县预测路由
    resp = client.get("/api/forecast/npp/naqu-seni?year=2026")
    assert resp.status_code == 200
    data = resp.json()
    assert data["region_id"] == "naqu-seni"
    assert "npp_forecast" in data
    assert "baselines_comparison" in data

    # 2. 测试对照基准报告路由
    resp_bench = client.get("/api/forecast/npp-benchmark")
    assert resp_bench.status_code == 200
    bench_data = resp_bench.json()
    assert "loyo_protocol" in bench_data
    assert "loro_protocol" in bench_data

    # 3. 测试 26 县全域综合风险评估接口
    resp_cr = client.get("/api/overview/county-risks")
    assert resp_cr.status_code == 200
    cr_data = resp_cr.json()
    assert "macro_stats" in cr_data
    assert cr_data["macro_stats"]["total_counties"] == 26
    assert len(cr_data["counties"]) == 26

    # 4. 测试全量 GeoJSON 规范要素集 (包含 4 省底图与 26 县)
    resp_geo = client.get("/api/overview/geojson-all")
    assert resp_geo.status_code == 200
    geo_data = resp_geo.json()
    assert geo_data["type"] == "FeatureCollection"
    assert len(geo_data["features"]) == 30  # 4 省界底图 + 26 监测县
    assert geo_data["features"][0]["geometry"]["type"] in ["Polygon", "MultiPolygon"]
    assert "name" in geo_data["features"][0]["properties"]

    # 测试仅县域模式 (include_provinces=false)
    resp_counties = client.get("/api/overview/geojson-all?include_provinces=false")
    assert resp_counties.status_code == 200
    assert len(resp_counties.json()["features"]) == 26

    # 5. 测试应急处置调度与留痕接口 (写操作闭环)
    resp_logs = client.get("/api/decision/dispatch-logs")
    assert resp_logs.status_code == 200
    assert "logs" in resp_logs.json()

    resp_disp = client.post(
        "/api/decision/dispatch",
        json={
            "region_id": "naqu-seni",
            "hay_tons": 15.0,
            "grain_tons": 3.0,
            "feed_cost_wan": 2.3,
            "action_type": "自动化回归测试调度",
            "memo": "Pytest 自动化审计验证",
        },
    )
    assert resp_disp.status_code == 200
    assert resp_disp.json()["success"] is True
    assert "dispatch_id" in resp_disp.json()


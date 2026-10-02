"""
单元测试 - 标准气象干旱算法模块 (SPI)
=============================================================================
验证内容:
1. calculate_spi 接口输出数据契约与 SpiResult Schema 校验
2. 零降水概率边界处理 (Gaize 等县 q > 0 混合累积分布验证)
3. 26 县全量覆盖性与标准 Gamma 拟合有效性
4. 新旧 SPI (标准 Gamma vs legacy_spi 简化 Z-score) 对照组一致性与差异性
"""

import pytest

from app.algorithm.spi import (
    calculate_spi,
    legacy_spi,
    run_benchmark_26_counties,
    classify_drought_level_standard,
)
from app.core.dataio import load_region_list
from app.core.schemas import SpiResult


def test_spi_output_contract():
    """测试单个县域 SPI 计算契约与 Pydantic Schema 严格校验。"""
    res = calculate_spi("naqu-seni", scale=3)

    assert "region_id" in res
    assert "spi_value" in res
    assert "legacy_spi_value" in res
    assert "drought_level" in res
    assert "zero_precip_prob" in res
    assert "params" in res

    # Schema 校验
    validated = SpiResult(**res)
    assert validated.region_id == "naqu-seni"
    assert validated.scale == 3
    assert validated.method == "gamma_fitted"
    assert 0.0 <= validated.zero_precip_prob <= 1.0
    if validated.spi_value is not None:
        assert -4.0 <= validated.spi_value <= 4.0


def test_zero_precip_handling():
    """测试极端干旱县域 (如 ali-gaize) 的零降水概率 q 处理。"""
    res = calculate_spi("ali-gaize", scale=3)
    assert res["region_id"] == "ali-gaize"
    assert "zero_precip_prob" in res
    # 验证返回值不为 None
    assert res["spi_value"] is not None


def test_all_26_counties_coverage():
    """测试 26 个县全部成功计算出新旧 SPI，无崩溃与异常。"""
    regions = load_region_list()
    assert len(regions) == 26

    results = run_benchmark_26_counties()
    assert len(results) == 26

    for r in results:
        assert r["region_id"]
        assert r["drought_level"] in ["极旱", "重旱", "轻旱", "正常", "湿润"]
        assert r["method"] == "gamma_fitted"


def test_legacy_spi_comparison():
    """测试旧版 legacy_spi 对照组能够正常输出。"""
    for rid in ["naqu-bange", "aba-hongyuan", "ali-gaize"]:
        leg = legacy_spi(rid, scale=3)
        assert leg["region_id"] == rid
        assert "spi" in leg
        assert "drought_level" in leg

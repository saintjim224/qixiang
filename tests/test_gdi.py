"""
单元测试 - 草地退化指数 (GDI) 论文级复现与改进模块
=============================================================================
验证内容:
1. compute_gdi 接口数据契约与 GdiResult Schema 校验
2. 26 县全量覆盖性与分布非平庸性 (严禁全量同级)
3. 论文级 PCA + K-Means + 曲率分析阈值合理性
4. 旧版 legacy_gdi 简化算法对照与向后兼容性
"""

from collections import Counter
import pytest

from app.algorithm.gdi import compute_gdi, legacy_gdi, run_all_gdi
from app.core.dataio import load_region_list
from app.core.schemas import GdiResult


def test_gdi_output_contract():
    """测试单个县域 GDI 计算输出契约与 Pydantic 模式兼容."""
    res = compute_gdi("aba-hongyuan", target_year=2024)

    # 必需字段检查
    required_keys = [
        "region_id",
        "target_year",
        "gdi_value",
        "degradation_level",
        "legacy_gdi_value",
        "legacy_level",
        "pca_variance_ratio",
        "indicators",
        "is_derived",
    ]
    for k in required_keys:
        assert k in res, f"缺少必需字段: {k}"

    # Pydantic 模式严格校验
    validated = GdiResult(**res)
    assert validated.region_id == "aba-hongyuan"
    assert validated.target_year == 2024
    assert 0.0 <= validated.gdi_value <= 1.0
    assert 0.0 <= validated.pca_variance_ratio <= 1.0

    # 原始指标完整性
    for ind_key in ["npp", "ndvi", "veg_cover", "yield"]:
        assert ind_key in validated.indicators, f"indicators 缺少 {ind_key}"
        assert validated.indicators[ind_key] >= 0.0


def test_all_26_regions_coverage_and_distribution():
    """测试 26 个县全部成功计算，且各退化等级呈自然梯度分布 (严禁全量同级)."""
    regions = load_region_list()
    assert len(regions) == 26

    results = run_all_gdi(target_year=2024)
    assert len(results) == 26

    # 统计四级分布
    levels = [r["degradation_level"] for r in results]
    counter = Counter(levels)

    # 严禁全量同级: 至少存在 3 个及以上不同退化级别
    assert len(counter) >= 3, f"退化等级过于集中单一: {counter}"

    # 验证四个标准等级均被定义
    for lvl in ["基本稳定 (Stable)", "轻度退化 (Light)", "中度退化 (Moderate)", "重度退化 (Severe)"]:
        assert lvl in counter, f"缺失退化等级: {lvl}"

    # 各等级数量合理性校验
    assert counter["基本稳定 (Stable)"] >= 2
    assert counter["轻度退化 (Light)"] >= 5
    assert counter["中度退化 (Moderate)"] >= 5
    assert counter["重度退化 (Severe)"] >= 2


def test_legacy_gdi_baseline():
    """测试旧版等权简化算法 baseline 计算."""
    for rid in ["naqu-bange", "aba-hongyuan", "ali-gaize"]:
        leg = legacy_gdi(rid, target_year=2024)
        assert "region_id" in leg
        assert "gdi_value" in leg
        assert "risk_level" in leg
        assert 0.0 <= leg["gdi_value"] <= 1.0
        assert leg["risk_level"] in ["低风险", "中风险", "高风险"]


def test_pca_variance_ratio():
    """测试 PCA 主成分方差解释比具有统计显著性 (> 50%)."""
    res = compute_gdi("naqu-bange", target_year=2024)
    ratio = res["pca_variance_ratio"]
    assert ratio >= 0.50, f"PCA 第一主成分方差解释比过低: {ratio}"


if __name__ == "__main__":
    pytest.main(["-v", __file__])

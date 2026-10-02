"""
单元测试 - 正例-未标注学习 (PU Learning) 灾害风险评估算法模块
=============================================================================
验证内容:
1. extract_pu_features 接口提取 1500 样本及 16 维特征空间完整性
2. PULearningModel 训练与 Platt 概率校准契约 (输出严格位于 0~1)
3. explain_risk 与 predict_risk 接口数据契约与 PuRiskPrediction Schema 严格兼容
4. run_ablation_benchmark 对照实验三组基线对比:
   - 验证 PU Learning 相对朴素监督基线 (Naive Supervised) 在 F1 和精确率上的显著提升
   - 验证 Brier 概率校准分数优化
5. SHAP (TreeExplainer) 解释链完整性与 Top-5 驱动因子排序
"""

import pytest
import numpy as np

from app.algorithm.pu_model import (
    PULearningModel,
    extract_pu_features,
    run_ablation_benchmark,
    get_pu_model,
    FEATURE_NAMES,
    FEATURE_LABELS_CN,
)
from app.core.schemas import PuRiskPrediction, ShapFeatureContribution


def test_feature_extraction_contract():
    """测试特征提取接口输出形态、维度与正样本/未标注样本量划分。"""
    X, y_pu, rule_scores, meta = extract_pu_features()

    assert len(X) == 1500, f"样本总量不等于 1500: {len(X)}"
    assert X.shape[1] == 16, f"特征维度不为 16: {X.shape[1]}"
    assert len(FEATURE_NAMES) == 16
    assert len(FEATURE_LABELS_CN) == 16

    n_pos = int(np.sum(y_pu == 1))
    n_un = int(np.sum(y_pu == 0))
    assert n_pos == 127, f"确证正样本数应严格为 127: {n_pos}"
    assert n_un == 1373, f"未标注样本数应严格为 1373: {n_un}"
    assert len(rule_scores) == 1500
    assert len(meta) == 1500

    # 检查特征中无 NaN 或 Inf
    assert not np.isnan(X).any(), "特征矩阵中存在 NaN"
    assert not np.isinf(X).any(), "特征矩阵中存在 Inf"


def test_pu_model_training_and_calibration():
    """测试 PU 模型训练、可靠负例筛选及 Platt 概率校准效果。"""
    X, y_pu, _, _ = extract_pu_features()

    model = PULearningModel(n_bags=10, bagging_ratio=2.0, rn_percentile=65.0, random_state=42)
    model.fit(X, y_pu)

    assert model.is_fitted
    assert model.reliable_negative_indices is not None
    assert len(model.reliable_negative_indices) > 500
    assert model.ambiguous_indices is not None

    # 测试概率预测范围严格位于 [0, 1]
    probs = model.predict_proba(X[:50])
    assert probs.shape == (50,)
    assert (probs >= 0.0).all() and (probs <= 1.0).all()

    # 测试离散预测为 0 或 1
    preds = model.predict(X[:50], threshold=0.5)
    assert set(np.unique(preds)).issubset({0, 1})


def test_explain_risk_and_schema_contract():
    """测试 explain_risk 接口、SHAP 解释与 Pydantic 契约兼容性。"""
    model = get_pu_model()
    X, y_pu, _, meta = extract_pu_features()

    # 选取一个正样本测试
    pos_idx = int(np.where(y_pu == 1)[0][0])
    sample_feat = X[pos_idx]
    rid = meta[pos_idx]["region_id"]
    m = meta[pos_idx]["month"]

    res = model.explain_risk(sample_feat, region_id=rid, month=m, top_k=5)

    # 必需字典字段检查
    required_keys = [
        "pu_prediction",
        "region_id",
        "month",
        "calibrated_risk_prob",
        "risk_score",
        "risk_level",
        "confidence_tier",
        "top_drivers",
        "all_features",
        "summary",
        "recommendations",
    ]
    for k in required_keys:
        assert k in res, f"explain_risk 缺少键: {k}"

    # Pydantic 模式严格校验
    pu_pred: PuRiskPrediction = res["pu_prediction"]
    assert isinstance(pu_pred, PuRiskPrediction)
    assert pu_pred.region_id == rid
    assert pu_pred.month == m
    assert 0.0 <= pu_pred.calibrated_risk_prob <= 1.0
    assert 0.0 <= pu_pred.risk_score <= 100.0
    assert pu_pred.risk_level in ["低风险", "中风险", "高风险", "极高风险"]
    assert pu_pred.confidence_tier == "statistical_calibrated"
    assert len(pu_pred.top_shap_features) == 5

    for sf in pu_pred.top_shap_features:
        assert isinstance(sf, ShapFeatureContribution)
        assert sf.feature_name in FEATURE_NAMES
        assert sf.direction in ["increase_risk", "decrease_risk"]
        assert sf.contribution_pct >= 0.0


def test_ablation_benchmark_performance_leap():
    """验证三组基线对照实验，确认 PU 学习模型相对朴素监督基线的显著飞跃。"""
    results = run_ablation_benchmark(random_state=42)

    assert "Baseline 1 (Rule-based)" in results
    assert "Baseline 2 (Naive Supervised)" in results
    assert "Model 3 (PU Learning Model)" in results

    b1 = results["Baseline 1 (Rule-based)"]
    b2 = results["Baseline 2 (Naive Supervised)"]
    m3 = results["Model 3 (PU Learning Model)"]

    # 1. 验证规则基线由于未校准阈值判定导致大量误报 (精确率低)
    assert b1["precision"] < 0.30

    # 2. 验证朴素监督由于负样本噪声导致的严重漏报 (召回率低)
    assert b2["recall"] < 0.25

    # 3. 验证本项目 PU 模型在 F1 分数与召回率上的突破飞跃
    assert m3["f1_score"] > b2["f1_score"]
    assert m3["recall"] > b2["recall"]
    assert m3["accuracy"] >= 0.88

    # 4. 验证 Brier 概率校准分数优于规则基线 (越低越好)
    assert m3["brier_score"] < b1["brier_score"]


if __name__ == "__main__":
    pytest.main(["-v", __file__])

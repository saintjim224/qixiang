"""
单元测试 - 正例-未标注学习 (PU Learning) 灾害风险评估算法模块
=============================================================================
验证内容:
1. extract_pu_features 接口提取 1500 样本及 16 维特征空间完整性
2. PULearningModel 训练与 Platt 概率校准契约 (输出严格位于 0~1)
3. explain_risk 与 predict_risk 接口数据契约与 PuRiskPrediction Schema 严格兼容
4. run_ablation_benchmark 对照实验三组基线对比:
   - 验证时间留出、训练隔离与记录标签诊断契约
   - 验证全部模型不读取留出样本参与拟合
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


def test_ablation_benchmark_metric_contract():
    """验证指标契约，不把某个模型必须胜出作为软件测试的前提。"""
    from app.algorithm.pu_evaluation import run_pu_evaluation
    report = run_pu_evaluation(random_state=42)
    results, protocol = report["benchmark_results"], report["evaluation"]
    assert len(results) == 4
    assert protocol["name"] == "末年时间留出"
    assert protocol["held_out_year"] == 2024
    train, test = set(protocol["train_indices"]), set(protocol["test_indices"])
    assert not train & test
    assert len(train | test) == 1500
    assert set(protocol["reliable_negative_indices"]) <= train
    for model in results.values():
        if not model["available"]:
            assert model["f1_score"] is None
            continue
        assert model["metric_target"] == "observed_annotation_not_disaster_truth"
        for key in ("accuracy", "precision", "recall", "f1_score", "brier_score",
                    "labeled_positive_recall", "unlabeled_alert_rate"):
            assert 0 <= model[key] <= 1


def test_evaluation_never_fits_held_out_rows(monkeypatch):
    """用携带行身份的样本拦截每个拟合入口，验证留出样本从未参加训练。"""
    from app.algorithm import pu_model, pu_evaluation
    seen = []
    class SpyPU:
        def __init__(self, **kwargs):
            pass
        def fit(self, X, y):
            seen.append(("pu", X[:, 0].tolist()))
            self.reliable_negative_indices = np.flatnonzero(y == 0)
            return self
        def predict_proba(self, X):
            return np.full(len(X), 0.4)
    class SpyBaseline:
        def __init__(self, **kwargs):
            pass
        def fit(self, X, y):
            seen.append(("naive", X[:, 0].tolist()))
            return self
        def predict_proba(self, X):
            return np.tile([0.7, 0.3], (len(X), 1))
    def spy_elkan(X_tr, X_te, y_tr, y_te, **kwargs):
        seen.append(("elkan", X_tr[:, 0].tolist()))
        assert set(X_tr[:, 0]).isdisjoint(X_te[:, 0])
        return {"available": False, "f1_score": None}
    monkeypatch.setattr(pu_model, "PULearningModel", SpyPU)
    monkeypatch.setattr(pu_evaluation, "XGBClassifier", SpyBaseline)
    monkeypatch.setattr(pu_model, "_elkanoto_benchmark_row", spy_elkan)
    X = np.arange(60).reshape(-1, 1).astype(float)
    y = np.array([1, 0, 0] * 20)
    metadata = [{"region_id": str(i % 30), "month": "2023-01" if i < 30 else "2024-01"} for i in range(60)]
    pu_evaluation.run_pu_evaluation(X, y, np.zeros(60), metadata)
    assert {name for name, _ in seen} == {"pu", "naive", "elkan"}
    assert all(set(ids) == set(range(30)) for _, ids in seen)
    original_training = list(seen)
    seen.clear()
    X[30:] += 10000  # 验证集特征变化不能改变任何模型的训练输入。
    pu_evaluation.run_pu_evaluation(X, y, np.zeros(60), metadata)
    assert seen == original_training


if __name__ == "__main__":
    pytest.main(["-v", __file__])

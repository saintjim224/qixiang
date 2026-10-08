"""PU 模型的独立留出诊断；区分已记录标签与真实灾害标签。"""

from __future__ import annotations

from typing import Any
import numpy as np
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, brier_score_loss
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier


def _split_indices(y, sample_meta, test_size, random_state):
    indices = np.arange(len(y))
    if sample_meta is not None:
        if len(sample_meta) != len(y):
            raise ValueError("样本元数据长度与特征不一致")
        months = [str(m.get("month", "")) for m in sample_meta]
        if any(len(m) != 7 or not m[:4].isdigit() for m in months):
            raise ValueError("时间留出要求每条样本提供 YYYY-MM")
        years = np.array([int(m[:4]) for m in months])
        if len(np.unique(years)) < 2:
            raise ValueError("时间留出至少需要两个年份")
        held_out_year = int(years.max())
        train, test = indices[years < held_out_year], indices[years == held_out_year]
        groups = [f"{m.get('region_id', '')}|{month}" for m, month in zip(sample_meta, months)]
        overlap = set(groups[i] for i in train) & set(groups[i] for i in test)
        if overlap:
            raise ValueError("训练与验证县月重叠")
        protocol = {"name": "末年时间留出", "held_out_year": held_out_year,
                    "train_years": sorted(set(int(v) for v in years[train]))}
    else:
        train, test = train_test_split(indices, test_size=test_size, random_state=random_state, stratify=y)
        protocol = {"name": "分层随机留出（仅用于自定义数组诊断）", "held_out_year": None}
    if len(np.intersect1d(train, test)) or not len(train) or not len(test):
        raise ValueError("训练与验证划分必须非空且互斥")
    if np.sum(y[train] == 1) < 3 or np.sum(y[train] == 0) < 3:
        raise ValueError("训练期至少需要 3 条已标注事件与 3 条未标注样本")
    return train, test, protocol


def _diagnostic_metrics(y, probability, prediction):
    """F1 等只比较记录标签 s，不将 U 的 0 解释为真实无灾。"""
    labeled, unlabeled = y == 1, y == 0
    return {
        "accuracy": float(accuracy_score(y, prediction)),
        "precision": float(precision_score(y, prediction, zero_division=0)),
        "recall": float(recall_score(y, prediction, zero_division=0)),
        "f1_score": float(f1_score(y, prediction, zero_division=0)),
        "brier_score": float(brier_score_loss(y, probability)),
        "labeled_positive_recall": float(np.mean(prediction[labeled])) if np.any(labeled) else None,
        "unlabeled_alert_rate": float(np.mean(prediction[unlabeled])) if np.any(unlabeled) else None,
        "available": True,
        "metric_target": "observed_annotation_not_disaster_truth",
    }


def run_pu_evaluation(X=None, y_pu=None, rule_scores=None, sample_meta=None,
                      test_size=0.25, random_state=42) -> dict[str, Any]:
    from app.algorithm.pu_model import PULearningModel, extract_pu_features, _elkanoto_benchmark_row

    if X is None or y_pu is None or rule_scores is None:
        X, y_pu, rule_scores, sample_meta = extract_pu_features()
    X, y, rules = np.asarray(X), np.asarray(y_pu), np.asarray(rule_scores)
    if X.ndim != 2 or len(X) != len(y) or len(y) != len(rules):
        raise ValueError("特征、标签和规则分长度必须一致")
    if not np.isfinite(X).all() or not np.isfinite(rules).all() or not set(np.unique(y)) <= {0, 1}:
        raise ValueError("特征需为有限数，标签须为 0/1")
    train, test, protocol = _split_indices(y, sample_meta, test_size, random_state)
    X_tr, X_te, y_tr, y_te = X[train], X[test], y[train], y[test]

    # 划分先于任何拟合；生产 PU 流程的筛 RN、训练与校准均只能看到训练期。
    pu = PULearningModel(n_bags=25, random_state=random_state)
    pu.fit(X_tr, y_tr)
    probability = pu.predict_proba(X_te)
    ours = _diagnostic_metrics(y_te, probability, (probability >= 0.40).astype(int))
    ours.update(name_cn="模型 3: 本项目 PU Learning 模型", threshold=0.40)

    naive = XGBClassifier(n_estimators=100, max_depth=3, learning_rate=0.05,
                          random_state=random_state, eval_metric="logloss")
    naive.fit(X_tr, y_tr)
    naive_probability = naive.predict_proba(X_te)[:, 1]
    baseline = _diagnostic_metrics(y_te, naive_probability, (naive_probability >= 0.50).astype(int))
    baseline.update(name_cn="基线 2: 朴素监督（U 作为 0 训练）", threshold=0.50)
    rule_probability = np.clip(rules[test] / 100.0, 0, 1)
    rule = _diagnostic_metrics(y_te, rule_probability, (rules[test] >= 25).astype(int))
    rule.update(name_cn="基线 1: 固定规则评分", threshold=25)

    # 第三方方法同样使用原始训练期 P/U；不能混入任何验证行或使用全量 RN。
    elkan = _elkanoto_benchmark_row(X_tr, X_te, y_tr, y_te, random_state=random_state)
    rows = {"Baseline 1 (Rule-based)": rule, "Baseline 2 (Naive Supervised)": baseline,
            "Model 3 (PU Learning Model)": ours, "Baseline 4 (Elkan-Noto PU)": elkan}
    rn_indices = train[pu.reliable_negative_indices]
    protocol.update({
        "random_state": random_state, "train_count": len(train), "test_count": len(test),
        "test_labeled_count": int(np.sum(y_te == 1)), "test_unlabeled_count": int(np.sum(y_te == 0)),
        "train_indices": train.tolist(), "test_indices": test.tolist(),
        "reliable_negative_indices": rn_indices.tolist(),
        "train_test_overlap": 0,
        "fit_scope": "RN selection, fitting and calibration use training rows only",
        "metric_target": "observed_annotation_not_disaster_truth",
        "limitations": [
            "未标注样本没有真实阴性标签；F1、精确率和 Brier 仅为记录标签诊断，不能解释为真实灾害识别性能。",
            "已标注召回率只针对有来源记录；未标注告警率不是误报率。",
            "来源记录仍需县域与气象关联复核；静态经营特征和同期气象特征使结果不等于提前预警能力。",
            "各模型阈值预先固定，未使用留出集调优；不同阈值的细微名次差不能单独解释为方法优劣。",
        ],
    })
    return {"benchmark_results": rows, "evaluation": protocol}

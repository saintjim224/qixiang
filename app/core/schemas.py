"""
MeteoRiskPlatform - Pydantic 数据模式与接口响应契约
=============================================================================
规范遵循:
- 明确标注数据类型与字段说明
- 派生数据显式标识 is_derived
"""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class _LooseContract(BaseModel):
    """
    挂到 FastAPI `response_model` 上的契约基类。

    `extra="allow"`：契约的职责是**声明并校验关键字段**，而不是把契约之外的
    字段静默裁掉。若用默认的 extra="ignore" 挂 response_model，任何契约未列举
    的字段（例如新增的 assumptions / degraded_inputs 等披露项）都会在出网时
    被悄悄删除——契约就从"文档"变成了"隐形的删字段开关"。

    仅用于对外响应契约；测试中用 `**res` 严格校验的 Schema 不继承此类，
    以保留"多一个字段就报错"的强校验能力。
    """

    model_config = ConfigDict(extra="allow")


class RegionMeta(_LooseContract):
    region_id: str
    name_cn: str
    province: str
    prefecture: str
    pasture_type: str
    elevation: float
    latitude: float
    longitude: float


class SpiResult(BaseModel):
    region_id: str
    scale: int = 3
    target_month: str
    spi_value: float = Field(..., description="标准 Gamma 拟合 SPI 值")
    legacy_spi_value: float = Field(..., description="旧版简化 Z-score SPI 值")
    drought_level: str = Field(..., description="干旱等级: 极旱/重旱/轻旱/正常/湿润")
    zero_precip_prob: float = Field(..., description="零降水概率 q")
    method: str = "gamma_fitted"
    historical_years_count: int


class GdiResult(BaseModel):
    region_id: str
    target_year: int
    gdi_value: float = Field(..., description="科学 GDI 指数 (0~1)")
    degradation_level: str = Field(..., description="中英双语退化等级，如 中度退化 (Moderate)")
    degradation_level_cn: str = Field(..., description="纯中文退化等级，供载畜量惩罚系数使用")
    degradation_level_en: str = Field(..., description="英文退化等级")
    legacy_gdi_value: float = Field(..., description="旧版等权简化 GDI")
    legacy_level: str = Field(..., description="旧版退化等级")
    pca_variance_ratio: float = Field(..., description="PCA 主成分解释方差比")
    indicators: dict[str, float] = Field(default_factory=dict, description="原始遥感生态指标")
    is_derived: bool = True


class ShapFeatureContribution(BaseModel):
    feature_name: str
    feature_label_cn: str
    shap_value: float
    contribution_pct: float
    direction: str  # "increase_risk" | "decrease_risk"


class PuRiskPrediction(BaseModel):
    region_id: str
    month: str
    calibrated_risk_prob: float = Field(..., description="PU 校准后真实致灾后验概率 P(Y=1|X)")
    risk_score: float = Field(..., description="0-100 综合灾害风险分")
    risk_level: str = Field(..., description="低风险/中风险/高风险/极高风险")
    top_shap_features: list[ShapFeatureContribution] = Field(default_factory=list)
    confidence_tier: str = Field("statistical_calibrated", description="置信层级")


class NppForecastResult(_LooseContract):
    """
    `/api/forecast/npp/{region_id}` 响应契约。

    注：字段名必须与 `predict_single_county_npp` 的真实返回一致。原契约写的是
    `forecast_year` / `predicted_npp` / `carrying_capacity_sheep_unit`，与实际
    返回的 `target_year` / `npp_forecast` / `equivalent_sheep_units` 全不相同，
    属于"有契约但从未接线"——照着契约写前端会全部取到 undefined。
    """

    region_id: str
    region_name: str
    target_year: int
    npp_forecast: float = Field(..., description="多元气象驱动预测 NPP (kgC/m²/yr)")
    npp_ci95: list[float] | None = Field(None, description="95% 预测区间 [lower, upper]；样本不足时为 null")
    ci_unavailable: bool = Field(..., description="true 表示本县样本不足以给出置信区间")
    ci_basis: dict[str, Any] = Field(default_factory=dict, description="置信区间的构造口径与留一年残差")
    unit: str
    equivalent_sheep_units: int = Field(..., description="等效生态载畜量 (羊单位)")
    baselines_comparison: dict[str, float] = Field(default_factory=dict, description="三条基线对照值")
    baseline_basis: dict[str, Any] = Field(default_factory=dict, description="三年移动平均的实际取样年份与边界处理口径")
    driving_features: dict[str, Any] = Field(default_factory=dict, description="气象驱动因子归因")
    is_derived: bool = True


class DecisionSignal(_LooseContract):
    """
    `/api/decision/signal/{region_id}` 响应契约。

    同 NppForecastResult：原契约的 `month` / `disaster_risk_level` / `feed_hay_tons`
    等字段在实际返回中并不存在，且缺少 `assumptions`——而 assumptions 正是本系统
    用来披露"哪些数字是下游情景设定、哪些是气象观测"的关键字段，绝不能被契约裁掉。
    """

    region_id: str
    disaster_status: str | None = Field(None, description="雪灾等级；数据不足时为 null")
    total_exposed_assets_wan: float = Field(..., description="牲畜活体资产敞口 (万元)")
    estimated_loss_exposure_wan: float | None = Field(None, description="预计灾害损失敞口 (万元)")
    resilience_credit_quota_wan: float | None = Field(None, description="气候韧性防灾信贷额度建议 (万元)")
    emergency_feed_demand: dict[str, Any] = Field(default_factory=dict, description="应急补饲测算明细")
    recommended_actions: list[str] = Field(default_factory=list, description="分级应急减灾动作清单")
    assumptions: dict[str, Any] = Field(default_factory=dict, description="下游应用情景的设定参数披露(非观测值)")
    is_derived: bool = True

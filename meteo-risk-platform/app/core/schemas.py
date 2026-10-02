"""
MeteoRiskPlatform - Pydantic 数据模式与接口响应契约
=============================================================================
规范遵循:
- 明确标注数据类型与字段说明
- 派生数据显式标识 is_derived
"""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class RegionMeta(BaseModel):
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
    degradation_level: str = Field(..., description="退化等级: 基本稳定/轻度/中度/重度")
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


class NppForecastResult(BaseModel):
    region_id: str
    forecast_year: int
    predicted_npp: float = Field(..., description="多元气象驱动预测 NPP (g C/m²/yr)")
    baseline_climatology: float = Field(..., description="气候态均值基线")
    baseline_linear_trend: float = Field(..., description="线性趋势基线")
    carrying_capacity_sheep_unit: int = Field(..., description="理论草场载畜量 (羊单位)")
    is_derived: bool = True


class DecisionSignal(BaseModel):
    region_id: str
    month: str
    disaster_risk_level: str
    feed_hay_tons: float = Field(..., description="建议储备干草 (吨)")
    feed_grain_tons: float = Field(..., description="建议储备精饲料 (吨)")
    estimated_loss_exposure_wan: float = Field(..., description="预计灾害损失敞口 (万元)")
    resilience_credit_quota_wan: float = Field(..., description="气候韧性防灾信贷额度建议 (万元)")
    insurance_buffer_pct: float = Field(..., description="政策性农业保险覆盖缓释度 (%)")
    recommended_actions: list[str] = Field(default_factory=list, description="分级应急减灾动作清单")

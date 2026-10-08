"""验证外部预报缺值和单位边界，测试不依赖网络。"""
import io
import json
from urllib.parse import parse_qs, urlparse

import pytest

from app.algorithm import disaster


def daily_values():
    return {
        'temperature_2m_max': [2.0] * 16,
        'temperature_2m_min': [-2.0] * 16,
        'snowfall_sum': [0.0] * 16,
        'wind_speed_10m_max': [5.0] * 16,
    }


@pytest.fixture
def forecast_cache(monkeypatch):
    monkeypatch.setattr(disaster, '_FORECAST_CACHE', {})
    monkeypatch.setattr(disaster, '_FORECAST_SOURCE', {})
    monkeypatch.setattr(disaster, '_FORECAST_FALLBACK_REASON', {})
    monkeypatch.setattr(disaster, '_CACHE_TIMESTAMP', 0)
    monkeypatch.setattr(disaster, '_NETWORK_DOWN_UNTIL', 0)
    monkeypatch.setattr(disaster, 'get_region_meta', lambda rid: {'latitude': 30, 'longitude': 90})


@pytest.mark.parametrize('missing', [None, float('nan'), float('inf')])
def test_incomplete_live_county_is_explicitly_downgraded(monkeypatch, forecast_cache, missing):
    incomplete = daily_values()
    incomplete['temperature_2m_max'][-1] = missing
    payload = [{'daily': incomplete}, {'daily': daily_values()}]
    monkeypatch.setattr(disaster, 'urlopen', lambda *a, **kw: io.BytesIO(json.dumps(payload).encode()))
    fallback = {**daily_values(), 'base_snow': 0}
    monkeypatch.setattr(disaster, '_generate_climatological_forecast', lambda *a, **kw: fallback.copy())
    result = disaster.fetch_open_meteo_forecast(['incomplete', 'complete', 'omitted'])
    assert result['incomplete'] == fallback
    assert disaster._FORECAST_SOURCE['incomplete'] == disaster.SOURCE_CLIMATOLOGY
    assert '16 天' in disaster._FORECAST_FALLBACK_REASON['incomplete']
    assert disaster._FORECAST_SOURCE['complete'] == disaster.SOURCE_REALTIME
    assert disaster._FORECAST_SOURCE['omitted'] == disaster.SOURCE_CLIMATOLOGY


def test_live_request_uses_metres_per_second_and_preserves_zero(monkeypatch, forecast_cache):
    def fake_open(request, **kwargs):
        query = parse_qs(urlparse(request.full_url).query)
        assert query['wind_speed_unit'] == ['ms']
        return io.BytesIO(json.dumps({'daily': daily_values()}).encode())
    monkeypatch.setattr(disaster, 'urlopen', fake_open)
    result = disaster.fetch_open_meteo_forecast(['county'])
    assert result['county']['snowfall_sum'] == [0.0] * 16
    assert disaster._FORECAST_SOURCE['county'] == disaster.SOURCE_REALTIME


def test_zero_degree_climatology_is_not_replaced_with_minus_ten(monkeypatch):
    from datetime import date
    monkeypatch.setattr(disaster, 'get_weather_series', lambda rid: [{
        'month': date.today().strftime('%Y-%m'), 'temperature_c': 0.0, 'snow_depth_cm': 0.0,
    }])
    result = disaster._generate_climatological_forecast('county')
    assert result['temperature_2m_max'] == [2.0] * 16
    assert result['temperature_2m_min'] == [-4.0] * 16

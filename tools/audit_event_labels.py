"""生成来源标签的人工复核队列；不自动更改原标签或推断真实金额。"""
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
import csv
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.core.dataio import get_pu_labeled_dataset, load_region_list
from app.api.datasource import DISASTER_TYPE_MAPPING


def main():
    positives, _ = get_pu_labeled_dataset()
    region_map = {r['region_id']: r.get('region_name', r['region_id']) for r in load_region_list()}
    aliases = {rid: re.split(r'地区|市|州', name)[-1] for rid, name in region_map.items()}
    url_regions = defaultdict(set)
    for row in positives:
        url_regions[row.get('source_url', '')].add(row.get('region_id', ''))
    reviews = []
    for row in positives:
        rid = row.get('region_id', '')
        note = row.get('note', '') or ''
        url = row.get('source_url', '')
        flags = []
        if not DISASTER_TYPE_MAPPING.get(row.get('event_type'), {}).get('is_meteorological', False):
            flags.append('非直接气象事件，核验是否适合作为目标正例')
        if row.get('loss_amount') or row.get('claim_amount'):
            flags.append('数值含义与单位未经复核')
        if len(url_regions[url]) > 1:
            flags.append('同一来源映射多个县域，核验报道范围')
        others = sorted({name for other, name in aliases.items() if other != rid and name and name in note})
        if others and aliases.get(rid, '') not in note:
            flags.append('摘要出现其他监测县：' + '、'.join(others))
        reviews.append({
            'region_id': rid, '标注县域': region_map.get(rid, rid), '标注月份': row.get('month', ''),
            '事件类型': row.get('event_type', ''), '待核验原因': '；'.join(flags) or '需人工确认原文中的发生地、月份及气象关联',
            '原始loss_amount': row.get('loss_amount'), '原始claim_amount': row.get('claim_amount'),
            '来源摘要': note, '来源链接': url, '复核状态': '待人工复核',
        })
    out = ROOT / 'tools/out'
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / 'event_label_review_queue.csv'
    with csv_path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(reviews[0]))
        writer.writeheader()
        writer.writerows(reviews)
    summary = {'generated_at': datetime.now().astimezone().isoformat(), 'labeled_count': len(reviews),
               'review_status': '自动线索筛查，尚未核验原文；不得据此认定真假',
               'event_types': dict(Counter(r['事件类型'] for r in reviews)),
               'non_meteorological_count': sum('非直接气象' in r['待核验原因'] for r in reviews),
               'ambiguous_numeric_count': sum('数值含义' in r['待核验原因'] for r in reviews),
               'cross_county_source_count': sum('同一来源' in r['待核验原因'] for r in reviews),
               'queue': str(csv_path.relative_to(ROOT))}
    (out / 'event_label_audit_summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

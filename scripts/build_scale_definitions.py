import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACK_DIR = ROOT / "psychological_scale_csv_pack"
SCALES_DIR = ROOT / "scales"


CODE_MAP = {
    "PHQ9": "PHQ-9",
    "GAD7": "GAD-7",
    "DASS21": "DASS-21",
    "SDS": "SDS",
    "ISI": "ISI",
}

META_OVERRIDES = {
    "PHQ9": {
        "name": "患者健康问卷-9",
        "full_name": "Patient Health Questionnaire-9",
        "category": "depression",
        "description": "PHQ-9 用于评估过去两周内的抑郁症状严重程度，第9题可作为自伤/自杀意念的重点复核信号。",
        "purpose": "抑郁筛查与风险复核",
        "estimated_minutes": 4,
        "instruction": "请根据您过去两周内的实际情况，选择每一项描述与您相符的频率。",
        "interpretation": "结果用于心理健康辅助筛查，不替代临床诊断；若第9题非零，建议立即结合专项风险评估与人工复核。",
    },
    "GAD7": {
        "name": "广泛性焦虑量表",
        "full_name": "Generalized Anxiety Disorder-7",
        "category": "anxiety",
        "description": "GAD-7 用于评估过去两周内的焦虑严重程度，可与抑郁、睡眠等量表联动分析。",
        "purpose": "焦虑筛查",
        "estimated_minutes": 3,
        "instruction": "请根据您过去两周内的实际情况，选择每一项描述与您相符的频率。",
        "interpretation": "总分越高代表焦虑困扰越明显；达到中度及以上建议进行进一步专业评估。",
    },
    "DASS21": {
        "name": "抑郁焦虑压力量表-21",
        "full_name": "Depression Anxiety Stress Scale-21",
        "category": "depression",
        "description": "DASS-21 同时评估抑郁、焦虑、压力三个维度，适合做多维情绪状态筛查。",
        "purpose": "抑郁/焦虑/压力三维筛查",
        "estimated_minutes": 6,
        "instruction": "请根据您过去一周内的实际情况，选择每一项描述与您相符的程度。",
        "interpretation": "DASS-21 以三个维度分别解释结果；系统会输出抑郁、焦虑、压力维度分数与等级。",
    },
    "SDS": {
        "name": "Zung抑郁自评量表",
        "full_name": "Zung Self-Rating Depression Scale",
        "category": "depression",
        "description": "SDS 是经典抑郁筛查量表，采用20题与指数分换算，包含反向计分题。",
        "purpose": "经典抑郁筛查",
        "estimated_minutes": 6,
        "instruction": "请根据您最近一段时间的实际情况，选择每一项描述与您相符的程度。",
        "interpretation": "SDS 结果使用指数分解释；第19题涉及死亡/自伤相关想法，得分偏高时建议人工复核。",
    },
    "ISI": {
        "name": "失眠严重程度指数",
        "full_name": "Insomnia Severity Index",
        "category": "sleep",
        "description": "ISI 用于评估最近两周的失眠严重程度，适合与情绪量表结合用于睡眠-情绪联动筛查。",
        "purpose": "睡眠问题筛查",
        "estimated_minutes": 3,
        "instruction": "请根据您最近两周的实际情况，评估以下睡眠相关问题的严重程度。",
        "interpretation": "ISI 结果用于辅助识别失眠困扰程度；中度及以上建议进一步关注睡眠与共病情绪问题。",
    },
}

OPTION_GROUP_LABELS = {
    "DASS_0_3": ["完全不符合", "有时符合", "常常符合", "总是符合"],
    "PHQ_GAD_0_3": ["完全没有", "有几天", "一半以上时间", "几乎每天"],
    "SDS_1_4": ["很少或没有", "有时", "经常", "大部分或全部时间"],
    "ISI_0_4": ["无/完全不影响", "轻微", "中等", "严重", "非常严重"],
}


def load_csv(name):
    path = PACK_DIR / name
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def normalize_code(code):
    return CODE_MAP.get(code, code)


def risk_level_from_label(label):
    if label in {"重度", "中重度", "极重度", "中重度抑郁", "重度抑郁", "重度焦虑", "重度临床失眠"}:
        return "high"
    if label in {"中度", "中度抑郁", "中度焦虑", "中度临床失眠"}:
        return "medium"
    if label in {"正常", "正常范围", "无或极轻微抑郁", "无或极轻微焦虑", "无临床显著失眠"}:
        return "low"
    return "low"


def build_option_map():
    rows = load_csv("scale_options_all.csv")
    option_map = {}
    for row in rows:
        option_map.setdefault(row["option_group"], []).append({
            "order": int(row["option_order"]),
            "label": row["option_label"],
            "score": int(row["score"]),
            "reverse_score": int(row["reverse_score"]),
        })
    for options in option_map.values():
        options.sort(key=lambda item: item["order"])
    return option_map


def build_questions(option_map):
    rows = load_csv("scale_questions_all.csv")
    questions = {}
    for row in rows:
        code = row["scale_code"]
        options = option_map[row["option_group"]]
        reverse = row["reverse_score"] == "True"
        question_options = []
        for option in options:
            value = option["reverse_score"] if code == "SDS" and reverse else option["score"]
            question_options.append({
                "value": value,
                "label": option["label"],
            })
        question = {
            "id": int(row["question_no"]),
            "text": row["question_text_cn"],
            "dimension": row["dimension"] or None,
            "reverse": reverse,
            "options": question_options,
        }
        if code == "PHQ9" and row["question_no"] == "9":
            question["is_suicide_item"] = True
        if code == "SDS" and row["question_no"] == "19":
            question["is_suicide_related"] = True
        questions.setdefault(code, []).append(question)
    for code in questions:
        questions[code].sort(key=lambda item: item["id"])
    return questions


def build_thresholds(rows):
    thresholds = []
    for row in rows:
        if not row["range_min"] or not row["range_max"]:
            continue
        label = row["risk_level"]
        thresholds.append({
            "min": int(float(row["range_min"])),
            "max": int(float(row["range_max"])),
            "level": label,
            "label": label,
            "risk_level": risk_level_from_label(label),
            "suggestion": row["suggestion"],
        })
    return thresholds


def build_special_rules(code):
    if code == "PHQ9":
        return [{
            "item_id": 9,
            "condition": "score > 0",
            "action": "manual_review",
            "message": "第9题非零，建议立即触发自伤/自杀风险复核与人工关注。",
        }]
    if code == "SDS":
        return [{
            "item_id": 19,
            "condition": "score >= 3",
            "action": "manual_review",
            "message": "第19题得分偏高，建议尽快进行人工复核与专项风险评估。",
        }]
    return []


def build_scoring(rows, code):
    if code == "DASS21":
        dimensions = []
        for score_name in ["depression", "anxiety", "stress"]:
            dim_rows = [row for row in rows if row["score_name"] == score_name]
            if not dim_rows:
                continue
            question_ids = [int(item.strip()) for item in dim_rows[0]["question_nos"].split(",")]
            thresholds = build_thresholds(dim_rows)
            dimensions.append({
                "id": score_name,
                "name": {
                    "depression": "抑郁",
                    "anxiety": "焦虑",
                    "stress": "压力",
                }[score_name],
                "questions": question_ids,
                "multiplier": 2,
                "max_score": 42,
                "thresholds": thresholds,
            })
        return {
            "type": "dimensional",
            "max_score": 126,
            "dimensions": dimensions,
        }, []

    if code == "SDS":
        index_rows = [row for row in rows if row["score_name"] == "index"]
        return {
            "type": "weighted",
            "max_raw_score": 80,
            "max_standard_score": 100,
            "reverse_questions": [2, 5, 6, 11, 12, 14, 16, 17, 18, 20],
            "note": "系统按原始分求和后乘以 1.25 计算指数分；反向题已在选项分值中处理。",
        }, build_thresholds(index_rows)

    max_score = {
        "PHQ9": 27,
        "GAD7": 21,
        "ISI": 28,
    }[code]
    return {
        "type": "sum",
        "max_score": max_score,
    }, build_thresholds(rows)


def main():
    option_map = build_option_map()
    question_map = build_questions(option_map)
    scoring_rows = load_csv("scale_scoring_rules_all.csv")
    scoring_map = {}
    for row in scoring_rows:
        scoring_map.setdefault(row["scale_code"], []).append(row)

    for source_code in ["PHQ9", "GAD7", "DASS21", "SDS", "ISI"]:
        code = normalize_code(source_code)
        override = META_OVERRIDES[source_code]
        scoring, thresholds = build_scoring(scoring_map[source_code], source_code)
        definition = {
            "code": code,
            "name": override["name"],
            "full_name": override["full_name"],
            "version": "Chinese Prototype Pack v1.0",
            "category": override["category"],
            "description": override["description"],
            "purpose": override["purpose"],
            "estimated_minutes": override["estimated_minutes"],
            "total_questions": len(question_map[source_code]),
            "instruction": override["instruction"],
            "scoring": scoring,
            "thresholds": thresholds,
            "questions": question_map[source_code],
            "special_rules": build_special_rules(source_code),
            "interpretation": override["interpretation"],
            "references": "题目、选项、评分规则来自 psychological_scale_csv_pack；正式部署前请核对中文版授权、版权与临床适用范围。",
        }
        file_path = SCALES_DIR / f"{code}.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(definition, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"generated {file_path.name}")


if __name__ == "__main__":
    main()

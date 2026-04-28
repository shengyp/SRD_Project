# module.py
def emocc(input_text: str) -> str:
    input_lower = input_text.lower()

    if any(word in input_lower for word in ["自杀", "不想活了", "死了算了", "结束生命"]):
        return "极高风险"
    elif any(word in input_lower for word in ["想死", "活够了", "绝望", "没希望"]):
        return "高风险"
    elif any(word in input_lower for word in ["痛苦", "难过", "抑郁", "孤独"]):
        return "中风险"
    else:
        return "低风险"


def fealearn(input_list: list) -> str:
    if not input_list:
        return "暂无历史数据"

    extreme_keywords = ["自杀", "死了算了", "结束生命"]
    high_keywords = ["想死", "活够了", "绝望"]
    medium_keywords = ["痛苦", "难过", "抑郁", "孤独"]

    extreme_count = 0
    high_count = 0
    medium_count = 0

    for text in input_list:
        text_lower = text.lower()

        for keyword in extreme_keywords:
            if keyword in text_lower:
                extreme_count += 1

        for keyword in high_keywords:
            if keyword in text_lower:
                high_count += 1

        for keyword in medium_keywords:
            if keyword in text_lower:
                medium_count += 1

    if extreme_count >= 2:
        return "历史风险极高"
    elif extreme_count >= 1 or high_count >= 3:
        return "历史高风险"
    elif high_count >= 1 or medium_count >= 3:
        return "历史中风险"
    else:
        return "历史低风险"
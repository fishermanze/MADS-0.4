NEG_KEYWORDS = {"不行", "不对", "讨厌", "反感", "生气", "愤怒", "无奈", "失望", "烦躁", "累了", "没办法",
                  "不可能", "拒绝", "反对", "不同意", "不开心", "难过", "伤心", "沮丧", "焦虑", "害怕"}
POS_KEYWORDS = {"同意", "理解", "支持", "感谢", "好的", "没问题", "可以", "行", "对", "是的", "对",
                "开心", "欣慰", "放心", "满意", "喜欢", "高兴", "期待", "希望", "努力", "加油"}


def score_sentiment(text: str):
    if not text or not text.strip():
        return {"valence": 0.0, "arousal": 0.0}

    neg_count = sum(1 for w in NEG_KEYWORDS if w in text)
    pos_count = sum(1 for w in POS_KEYWORDS if w in text)
    total = max(neg_count + pos_count, 1)
    valence = round((pos_count - neg_count) / total, 4)
    arousal = round(min((neg_count + pos_count) / max(len(text), 1) * 100, 1.0), 4)
    return {"valence": valence, "arousal": arousal}

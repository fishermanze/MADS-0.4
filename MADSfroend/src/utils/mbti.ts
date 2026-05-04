export const MBTI_PERSONA_HINTS: Record<string, string> = {
  E: "性格外向、表达直接、情绪外露",
  I: "性格内向、说话不多但话里有立场，倾向于先观察再表态",
  S: "重视具体的事实、细节和已发生的事情",
  N: "倾向于看模式、推断动机和长期影响",
  T: "以逻辑和后果说服别人，对道德绑架反感",
  F: "重视感受和关系，愿意在情绪上靠近对方",
  J: "倾向于把话说定、给出明确判断或要求",
  P: "倾向于保留弹性、提出多种可能性、避免下死结论",
};

export interface MbtiPersona {
  energy: string;
  info: string;
  decision: string;
  lifestyle: string;
}

export function mbtiPersonaHints(mbti: string | null | undefined): MbtiPersona | null {
  if (!mbti || mbti.length !== 4) {
    return null;
  }
  const upper = mbti.toUpperCase();
  return {
    energy: MBTI_PERSONA_HINTS[upper[0]] ?? "",
    info: MBTI_PERSONA_HINTS[upper[1]] ?? "",
    decision: MBTI_PERSONA_HINTS[upper[2]] ?? "",
    lifestyle: MBTI_PERSONA_HINTS[upper[3]] ?? "",
  };
}

export function mbtiPersonaLines(mbti: string | null | undefined): string[] {
  const persona = mbtiPersonaHints(mbti);
  if (!persona) {
    return [];
  }
  return [persona.energy, persona.info, persona.decision, persona.lifestyle].filter(Boolean);
}

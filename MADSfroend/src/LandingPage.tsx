import { useNavigate } from "react-router-dom";
import "./landing.css";
import { useAuth } from "./context/AuthContext";

interface FeatureCard {
  icon: string;
  title: string;
  desc: string;
  to: string;
}

const FEATURES: FeatureCard[] = [
  {
    icon: "💬",
    title: "多Agent对话",
    desc: "家庭与学校场景下的多角色实时对话，支持 MBTI 人格画像与流式生成。",
    to: "/MADS",
  },
  {
    icon: "🧭",
    title: "自研调度路由",
    desc: "Heuristic + LLM 混合调度，每轮挑选最适合发言的角色，自动检测收敛与僵局。",
    to: "/MADS",
  },
  {
    icon: "🧪",
    title: "干预实验",
    desc: "在任意位置注入干预，逐位置对比前后变化，配合人工评分与 AI 评分双轨打分。",
    to: "/INTERVENTION",
  },
  {
    icon: "📊",
    title: "数据统计",
    desc: "调度命中率、收敛轮数、原因分布等全量指标，支持按主题查看趋势。",
    to: "/STAT",
  },
];

function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const go = (path: string) => {
    if (!user) {
      navigate("/login");
      return;
    }
    navigate(path);
  };

  const goStat = () => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (user.role === "ADMIN") {
      navigate("/STAT");
    } else {
      navigate("/MADS");
    }
  };

  return (
    <div className="landing-root">
      <section className="landing-hero">
        <div className="landing-hero-text">
          <span className="landing-eyebrow">MADS · Multi-Agent Dialogue System</span>
          <h1 className="landing-title">让多智能体真的「讨论」起来</h1>
          <p className="landing-tagline">
            围绕家庭与学校场景，为多角色对话提供 MBTI 人格、调度路由、干预实验与可解释性评估，
            支持端到端的实验、对比与人工评分。
          </p>
          <div className="landing-cta-row">
            <button className="landing-cta-primary" onClick={() => go("/MADS")}>
              进入对话系统
            </button>
            <button className="landing-cta-ghost" onClick={() => go("/INTERVENTION")}>
              查看干预实验
            </button>
            <button className="landing-cta-ghost" onClick={() => navigate("/login")}>
              登录
            </button>
          </div>
        </div>
        <div className="landing-hero-art" aria-hidden="true">
          <div className="landing-hero-art-glyph">🤝</div>
        </div>
      </section>

      <section className="landing-features">
        {FEATURES.map((feature) => (
          <button
            key={feature.title}
            type="button"
            className="landing-feature-card"
            onClick={() =>
              feature.to === "/STAT" ? goStat() : go(feature.to)
            }
          >
            <div className="landing-feature-icon">{feature.icon}</div>
            <h3 className="landing-feature-title">{feature.title}</h3>
            <p className="landing-feature-desc">{feature.desc}</p>
          </button>
        ))}
      </section>

      <footer className="landing-footer">
        MADS Phase 2 · MySQL 用户与 JWT · React 19 · Vite 7 · Spring WebFlux · MongoDB
      </footer>
    </div>
  );
}

export default LandingPage;

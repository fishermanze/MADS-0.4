import { useEffect, useMemo, useRef, useState } from "react";
import { chatApi } from "./api/chatApi";
import type { ChatMetrics, GroupedHistories, HistoryItem } from "./types/chat";

function flattenHistories(grouped: GroupedHistories): HistoryItem[] {
  return [...grouped.TODAY, ...grouped.LAST_WEEK, ...grouped.LAST_MONTH, ...grouped.LAST_YEAR, ...grouped.OTHERS];
}

function rateToPercent(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatTimeLabel(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function buildPolyline(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    const y = height - values[0] * height;
    return `0,${y.toFixed(2)} ${width},${y.toFixed(2)}`;
  }
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - value * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split("");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const testLine = line + word;
    if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

function sanitizeFilePart(text: string): string {
  return text.replaceAll(/[\\/:*?"<>|]/g, "_").replaceAll(/\s+/g, "_").slice(0, 40) || "session";
}

function truncateTopic(text: string, maxLength = 32): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export default function StatisticsPage() {
  const [histories, setHistories] = useState<HistoryItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [metrics, setMetrics] = useState<ChatMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [trendWindow, setTrendWindow] = useState<"10" | "20" | "ALL">("ALL");
  const [hoverPointIndex, setHoverPointIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const trendSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const grouped = await chatApi.getGroupedHistories();
        const all = flattenHistories(grouped);
        setHistories(all);
        if (all.length > 0) {
          setSelectedSessionId(all[0].id);
        }
      } catch (error) {
        console.error("加载会话列表失败", error);
        setHistories([]);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setMetrics(null);
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        const data = await chatApi.getSessionMetrics(selectedSessionId);
        setMetrics(data);
      } catch (error) {
        console.error("加载会话统计失败", error);
        setMetrics(null);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [selectedSessionId]);

  const reasonRows = useMemo(() => Object.entries(metrics?.reasonDistribution ?? {}), [metrics?.reasonDistribution]);
  const modeRows = useMemo(() => Object.entries(metrics?.modeDistribution ?? {}), [metrics?.modeDistribution]);
  const trendWidth = 640;
  const trendHeight = 220;
  const trendBottomPadding = 28;
  const trendViewHeight = trendHeight + trendBottomPadding;
  const trendRows = useMemo(() => {
    const allRows = metrics?.trend ?? [];
    const take = trendWindow === "ALL" ? allRows.length : Number(trendWindow);
    if (take <= 0 || allRows.length <= take) {
      return allRows;
    }
    return allRows.slice(allRows.length - take);
  }, [metrics?.trend, trendWindow]);
  const attemptTrend = useMemo(() => trendRows.map((item) => item.cumulativeAttemptRate), [trendRows]);
  const applyTrend = useMemo(() => trendRows.map((item) => item.cumulativeApplyRate), [trendRows]);
  const attemptLine = useMemo(() => buildPolyline(attemptTrend, trendWidth, trendHeight), [attemptTrend]);
  const applyLine = useMemo(() => buildPolyline(applyTrend, trendWidth, trendHeight), [applyTrend]);
  const activePointIndex = useMemo(() => {
    if (trendRows.length === 0) {
      return -1;
    }
    if (hoverPointIndex == null) {
      return trendRows.length - 1;
    }
    return Math.max(0, Math.min(hoverPointIndex, trendRows.length - 1));
  }, [hoverPointIndex, trendRows.length]);
  const activePoint = activePointIndex >= 0 ? trendRows[activePointIndex] : null;
  const activeX =
    activePointIndex < 0 || trendRows.length <= 1 ? 0 : (activePointIndex / (trendRows.length - 1)) * trendWidth;
  const activeAttemptY = activePoint ? trendHeight - activePoint.cumulativeAttemptRate * trendHeight : 0;
  const activeApplyY = activePoint ? trendHeight - activePoint.cumulativeApplyRate * trendHeight : 0;
  const xAxisLabels = useMemo(() => {
    if (trendRows.length === 0) {
      return [];
    }
    const indexes = new Set<number>([0, Math.floor((trendRows.length - 1) / 2), trendRows.length - 1]);
    return [...indexes]
      .sort((a, b) => a - b)
      .map((index) => ({
        index,
        x: trendRows.length <= 1 ? 0 : (index / (trendRows.length - 1)) * trendWidth,
        label: formatTimeLabel(trendRows[index].createdAt),
      }));
  }, [trendRows]);
  const selectedHistory = useMemo(
    () => histories.find((item) => item.id === selectedSessionId) ?? null,
    [histories, selectedSessionId],
  );
  const insightText = useMemo(() => {
    if (!metrics) {
      return "请选择会话后查看自动结论。";
    }
    if (metrics.totalRounds === 0) {
      return "当前会话暂无路由指标数据，建议先运行几轮自动对话后再观察趋势。";
    }
    const topReason = [...reasonRows].sort((a, b) => b[1] - a[1])[0];
    const topMode = [...modeRows].sort((a, b) => b[1] - a[1])[0];
    const attemptDesc =
      metrics.routerAttemptRate >= 0.7 ? "尝试率较高" : metrics.routerAttemptRate >= 0.4 ? "尝试率中等" : "尝试率较低";
    const applyDesc =
      metrics.routerApplyRate >= 0.6 ? "生效率稳定" : metrics.routerApplyRate >= 0.3 ? "生效率一般" : "生效率偏低";
    const reasonPart = topReason ? `主要原因是「${topReason[0]}」(${topReason[1]} 次)` : "暂无主要原因";
    const modePart = topMode ? `主要模式为「${topMode[0]}」(${topMode[1]} 次)` : "暂无主要模式";
    return `该会话共 ${metrics.totalRounds} 轮，路由${attemptDesc}（${rateToPercent(metrics.routerAttemptRate)}），${applyDesc}（${rateToPercent(metrics.routerApplyRate)}）；${reasonPart}，${modePart}。`;
  }, [metrics, modeRows, reasonRows]);
  const recommendationText = useMemo(() => {
    if (!metrics) {
      return "请选择会话后生成建议。";
    }
    if (metrics.totalRounds < 5) {
      return "当前样本轮次偏少，建议先累计更多轮对话（>=10）再做稳定性判断。";
    }
    if (metrics.routerAttemptRate < 0.35) {
      return "路由尝试率偏低：建议降低路由触发阈值或放宽输入条件，提升可触发覆盖面。";
    }
    if (metrics.routerApplyRate < 0.3) {
      return "路由生效率偏低：建议重点分析回退原因分布，针对高频原因优化策略或提示词。";
    }
    if (metrics.routerApplyRate >= 0.6 && metrics.routerAttemptRate >= 0.6) {
      return "整体指标较稳定：建议开始做分场景 A/B 对比（家庭/学校）并记录干预前后变化。";
    }
    return "指标处于可优化区间：建议按高频原因逐项修正后，观察最近20轮趋势是否持续提升。";
  }, [metrics]);

  const handleExportTrendPng = async () => {
    if (!trendSvgRef.current || trendRows.length === 0) {
      return;
    }
    try {
      setExporting(true);
      const serializer = new XMLSerializer();
      const svgText = serializer.serializeToString(trendSvgRef.current);
      const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = trendWidth;
        canvas.height = trendViewHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(svgUrl);
          setExporting(false);
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const link = document.createElement("a");
        const now = new Date();
        const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
        link.download = `router-trend-${selectedSessionId || "session"}-${trendWindow}-${datePart}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        URL.revokeObjectURL(svgUrl);
        setExporting(false);
      };
      image.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        setExporting(false);
        console.error("导出趋势图失败：SVG 转图片失败");
      };
      image.src = svgUrl;
    } catch (error) {
      setExporting(false);
      console.error("导出趋势图失败", error);
    }
  };

  const exportSvgAsPngDataUrl = async (): Promise<string | null> => {
    if (!trendSvgRef.current || trendRows.length === 0) {
      return null;
    }
    return new Promise((resolve) => {
      const serializer = new XMLSerializer();
      const svgText = serializer.serializeToString(trendSvgRef.current as SVGSVGElement);
      const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = trendWidth;
        canvas.height = trendViewHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(svgUrl);
          resolve(null);
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/png");
        URL.revokeObjectURL(svgUrl);
        resolve(url);
      };
      image.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        resolve(null);
      };
      image.src = svgUrl;
    });
  };

  const handleExportReportPng = async () => {
    if (!metrics) {
      return;
    }
    try {
      setReportExporting(true);
      const chartDataUrl = await exportSvgAsPngDataUrl();
      if (!chartDataUrl) {
        console.error("导出报告失败：图表渲染失败");
        setReportExporting(false);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 1400;
      canvas.height = 1100;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setReportExporting(false);
        return;
      }
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 34px 'Segoe UI', sans-serif";
      ctx.fillText("会话路由统计报告", 56, 72);
      ctx.font = "18px 'Segoe UI', sans-serif";
      ctx.fillStyle = "#4b5563";
      ctx.fillText(
        `会话标题: ${selectedHistory?.title ?? "-"}`,
        56,
        108,
      );
      ctx.fillText(`Session: ${metrics.sessionId}`, 56, 136);
      ctx.fillText(`场景: ${selectedHistory?.scenario ?? "-"}`, 56, 164);
      ctx.fillText(`生成时间: ${formatTimeLabel(new Date().toISOString())}`, 56, 192);

      const cards = [
        { label: "总轮次", value: String(metrics.totalRounds) },
        { label: "路由尝试率", value: rateToPercent(metrics.routerAttemptRate) },
        { label: "路由生效率", value: rateToPercent(metrics.routerApplyRate) },
      ];
      cards.forEach((card, index) => {
        const x = 56 + index * 440;
        const y = 190;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#e5e7eb";
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, 408, 120);
        ctx.strokeRect(x, y, 408, 120);
        ctx.fillStyle = "#6b7280";
        ctx.font = "16px 'Segoe UI', sans-serif";
        ctx.fillText(card.label, x + 20, y + 36);
        ctx.fillStyle = "#111827";
        ctx.font = "bold 42px 'Segoe UI', sans-serif";
        ctx.fillText(card.value, x + 20, y + 88);
      });

      await new Promise<void>((resolve) => {
        const chartImage = new Image();
        chartImage.onload = () => {
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#e5e7eb";
          ctx.fillRect(56, 346, 860, 360);
          ctx.strokeRect(56, 346, 860, 360);
          ctx.fillStyle = "#111827";
          ctx.font = "bold 20px 'Segoe UI', sans-serif";
          ctx.fillText("命中率趋势（累计）", 76, 378);
          ctx.drawImage(chartImage, 76, 396, 820, 288);
          resolve();
        };
        chartImage.onerror = () => resolve();
        chartImage.src = chartDataUrl;
      });

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#e5e7eb";
      ctx.fillRect(940, 346, 404, 360);
      ctx.strokeRect(940, 346, 404, 360);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 20px 'Segoe UI', sans-serif";
      ctx.fillText("自动结论", 960, 378);
      ctx.fillStyle = "#374151";
      ctx.font = "16px 'Segoe UI', sans-serif";
      let nextY = drawWrappedText(ctx, insightText, 960, 410, 364, 28);
      nextY += 18;
      ctx.fillStyle = "#111827";
      ctx.font = "bold 18px 'Segoe UI', sans-serif";
      ctx.fillText("结论建议", 960, nextY);
      ctx.fillStyle = "#374151";
      ctx.font = "16px 'Segoe UI', sans-serif";
      drawWrappedText(ctx, recommendationText, 960, nextY + 28, 364, 28);

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#e5e7eb";
      ctx.fillRect(56, 730, 644, 332);
      ctx.strokeRect(56, 730, 644, 332);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 20px 'Segoe UI', sans-serif";
      ctx.fillText("原因分布", 76, 762);
      ctx.font = "16px 'Segoe UI', sans-serif";
      reasonRows.slice(0, 10).forEach(([reason, count], index) => {
        const y = 798 + index * 24;
        ctx.fillStyle = "#4b5563";
        ctx.fillText(reason, 76, y);
        ctx.fillStyle = "#111827";
        ctx.fillText(String(count), 660, y);
      });

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#e5e7eb";
      ctx.fillRect(720, 730, 624, 332);
      ctx.strokeRect(720, 730, 624, 332);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 20px 'Segoe UI', sans-serif";
      ctx.fillText("模式分布", 740, 762);
      ctx.font = "16px 'Segoe UI', sans-serif";
      modeRows.slice(0, 10).forEach(([mode, count], index) => {
        const y = 798 + index * 24;
        ctx.fillStyle = "#4b5563";
        ctx.fillText(mode, 740, y);
        ctx.fillStyle = "#111827";
        ctx.fillText(String(count), 1300, y);
      });

      const link = document.createElement("a");
      const now = new Date();
      const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      link.download = `router-report-${sanitizeFilePart(selectedHistory?.title ?? (selectedSessionId || "session"))}-${datePart}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setReportExporting(false);
    }
  };

  const handleExportReportPdf = async () => {
    if (!metrics) {
      return;
    }
    try {
      setReportExporting(true);
      const chartDataUrl = await exportSvgAsPngDataUrl();
      if (!chartDataUrl) {
        console.error("导出 PDF 失败：图表渲染失败");
        setReportExporting(false);
        return;
      }
      const reasonHtml =
        reasonRows.length === 0
          ? "<div style='color:#6b7280'>暂无数据</div>"
          : reasonRows
              .slice(0, 12)
              .map(([reason, count]) => `<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>${escapeHtml(reason)}</span><strong>${count}</strong></div>`)
              .join("");
      const modeHtml =
        modeRows.length === 0
          ? "<div style='color:#6b7280'>暂无数据</div>"
          : modeRows
              .slice(0, 12)
              .map(([mode, count]) => `<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>${escapeHtml(mode)}</span><strong>${count}</strong></div>`)
              .join("");
      const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
      if (!printWindow) {
        setReportExporting(false);
        return;
      }
      printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>会话路由统计报告</title>
    <style>
      body { margin: 0; padding: 24px; font-family: 'Segoe UI', sans-serif; background: #f8fafc; color: #111827; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
      .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .title { margin: 0 0 8px 0; font-size: 28px; }
      .small { color: #6b7280; font-size: 12px; }
      .big { font-size: 32px; font-weight: 700; }
      img { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
      @media print { body { background: #fff; padding: 0; } }
    </style>
  </head>
  <body>
    <h1 class="title">会话路由统计报告</h1>
    <div style="margin-bottom:8px;color:#4b5563;">会话标题: ${escapeHtml(selectedHistory?.title ?? "-")} | 场景: ${escapeHtml(selectedHistory?.scenario ?? "-")}</div>
    <div style="margin-bottom:12px;color:#4b5563;">Session: ${escapeHtml(metrics.sessionId)} | 生成时间: ${escapeHtml(formatTimeLabel(new Date().toISOString()))}</div>
    <div class="grid-3">
      <div class="card"><div class="small">总轮次</div><div class="big">${metrics.totalRounds}</div></div>
      <div class="card"><div class="small">路由尝试率</div><div class="big">${rateToPercent(metrics.routerAttemptRate)}</div></div>
      <div class="card"><div class="small">路由生效率</div><div class="big">${rateToPercent(metrics.routerApplyRate)}</div></div>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <h3 style="margin-top:0;">命中率趋势（累计）</h3>
      <img src="${chartDataUrl}" alt="trend" />
    </div>
    <div class="card" style="margin-bottom:12px;">
      <h3 style="margin-top:0;">自动结论</h3>
      <div style="line-height:1.7;">${escapeHtml(insightText)}</div>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <h3 style="margin-top:0;">结论建议</h3>
      <div style="line-height:1.7;">${escapeHtml(recommendationText)}</div>
    </div>
    <div class="grid-2">
      <div class="card"><h3 style="margin-top:0;">原因分布</h3>${reasonHtml}</div>
      <div class="card"><h3 style="margin-top:0;">模式分布</h3>${modeHtml}</div>
    </div>
    <script>
      window.onload = () => { setTimeout(() => { window.print(); }, 150); };
    </script>
  </body>
</html>`);
      printWindow.document.close();
    } finally {
      setReportExporting(false);
    }
  };

  return (
    <div style={{ padding: "20px", display: "grid", gap: "12px" }}>
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px" }}>
        <h3 style={{ marginTop: 0 }}>会话路由统计</h3>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: "8px", minWidth: 0, flex: "1 1 420px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", minWidth: 0 }}>
            <span>选择会话：</span>
            <select
              value={selectedSessionId}
              onChange={(event) => setSelectedSessionId(event.target.value)}
              style={{ width: "min(420px, 100%)", padding: "8px", borderRadius: "8px", border: "1px solid #d1d5db" }}
            >
              <option value="">请选择会话</option>
              {histories.map((item) => (
                <option key={item.id} value={item.id}>
                  {truncateTopic(item.title)}（{item.scenario}）
                </option>
              ))}
            </select>
            </div>
            {selectedHistory && (
              <div
                style={{
                  maxWidth: "720px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  color: "#4b5563",
                  fontSize: "13px",
                  lineHeight: 1.6,
                  overflowWrap: "anywhere",
                  background: "#f9fafb",
                }}
              >
                <strong style={{ color: "#374151" }}>当前主题全文：</strong>
                {selectedHistory.title}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              onClick={() => void handleExportReportPng()}
              disabled={!metrics || reportExporting}
              style={{
                border: "1px solid #d1d5db",
                background: reportExporting ? "#f3f4f6" : "#fff",
                color: "#374151",
                borderRadius: "8px",
                padding: "7px 12px",
                fontSize: "12px",
                cursor: !metrics || reportExporting ? "not-allowed" : "pointer",
              }}
            >
              {reportExporting ? "处理中..." : "导出报告 PNG"}
            </button>
            <button
              onClick={() => void handleExportReportPdf()}
              disabled={!metrics || reportExporting}
              style={{
                border: "1px solid #d1d5db",
                background: reportExporting ? "#f3f4f6" : "#fff",
                color: "#374151",
                borderRadius: "8px",
                padding: "7px 12px",
                fontSize: "12px",
                cursor: !metrics || reportExporting ? "not-allowed" : "pointer",
              }}
            >
              {reportExporting ? "处理中..." : "导出报告 PDF"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
          <div style={{ color: "#6b7280", fontSize: "12px" }}>总轮次</div>
          <div style={{ fontSize: "26px", fontWeight: 700 }}>{metrics?.totalRounds ?? "-"}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
          <div style={{ color: "#6b7280", fontSize: "12px" }}>路由尝试率</div>
          <div style={{ fontSize: "26px", fontWeight: 700 }}>{metrics ? rateToPercent(metrics.routerAttemptRate) : "-"}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
          <div style={{ color: "#6b7280", fontSize: "12px" }}>路由生效率</div>
          <div style={{ fontSize: "26px", fontWeight: 700 }}>{metrics ? rateToPercent(metrics.routerApplyRate) : "-"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div style={{ gridColumn: "1 / -1", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
          <h4 style={{ marginTop: 0 }}>命中率趋势（累计）</h4>
          {loading && <div>加载中...</div>}
          {!loading && (!metrics || metrics.trend.length === 0) && <div style={{ color: "#6b7280" }}>暂无趋势数据</div>}
          {!loading && metrics && metrics.trend.length > 0 && (
            <div style={{ display: "grid", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: "#6b7280", fontSize: "12px" }}>窗口：</span>
                {(["10", "20", "ALL"] as const).map((item) => (
                  <button
                    key={item}
                    onClick={() => setTrendWindow(item)}
                    style={{
                      border: trendWindow === item ? "1px solid #2563eb" : "1px solid #d1d5db",
                      background: trendWindow === item ? "#eff6ff" : "#fff",
                      color: trendWindow === item ? "#1d4ed8" : "#374151",
                      borderRadius: "999px",
                      padding: "4px 10px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    {item === "ALL" ? "全部" : `最近${item}`}
                  </button>
                ))}
                <button
                  onClick={() => void handleExportTrendPng()}
                  disabled={exporting || trendRows.length === 0}
                  style={{
                    marginLeft: "8px",
                    border: "1px solid #d1d5db",
                    background: exporting ? "#f3f4f6" : "#fff",
                    color: "#374151",
                    borderRadius: "8px",
                    padding: "4px 10px",
                    fontSize: "12px",
                    cursor: exporting ? "not-allowed" : "pointer",
                  }}
                >
                  {exporting ? "导出中..." : "导出 PNG"}
                </button>
              </div>
              <div style={{ position: "relative" }}>
                <svg
                  ref={trendSvgRef}
                  width="100%"
                  viewBox={`0 0 ${trendWidth} ${trendViewHeight}`}
                  style={{ maxHeight: "280px" }}
                  onMouseMove={(event) => {
                    if (trendRows.length === 0) {
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (rect.width <= 0) {
                      return;
                    }
                    const relX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
                    const relY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
                    const ratio = relX / rect.width;
                    const nextIndex =
                      trendRows.length <= 1 ? 0 : Math.round(ratio * (trendRows.length - 1));
                    const tooltipWidth = 190;
                    const tooltipHeight = 86;
                    const nextLeft = Math.max(8, Math.min(relX + 12, rect.width - tooltipWidth - 8));
                    const nextTop = Math.max(8, Math.min(relY + 12, rect.height - tooltipHeight - 8));
                    setHoverPointIndex(nextIndex);
                    setTooltipPos({ left: nextLeft, top: nextTop });
                  }}
                  onMouseLeave={() => {
                    setHoverPointIndex(null);
                    setTooltipPos(null);
                  }}
                >
                {[0, 0.25, 0.5, 0.75, 1].map((mark) => {
                  const y = trendHeight - mark * trendHeight;
                  return (
                    <g key={mark}>
                      <line x1={0} y1={y} x2={trendWidth} y2={y} stroke="#f3f4f6" strokeWidth={1} />
                      <text x={4} y={y - 4} fill="#9ca3af" fontSize="10">
                        {Math.round(mark * 100)}%
                      </text>
                    </g>
                  );
                })}
                <line x1={0} y1={trendHeight} x2={trendWidth} y2={trendHeight} stroke="#e5e7eb" strokeWidth={1} />
                <polyline fill="none" stroke="#3b82f6" strokeWidth={2.5} points={attemptLine} />
                <polyline fill="none" stroke="#10b981" strokeWidth={2.5} points={applyLine} />
                {xAxisLabels.map((item, labelIndex) => (
                  <g key={`label-${item.index}`}>
                    <line x1={item.x} y1={trendHeight} x2={item.x} y2={trendHeight + 4} stroke="#d1d5db" strokeWidth={1} />
                    <text
                      x={item.x}
                      y={trendHeight + 16}
                      fill="#9ca3af"
                      fontSize="10"
                      textAnchor={
                        labelIndex === 0
                          ? "start"
                          : labelIndex === xAxisLabels.length - 1
                            ? "end"
                            : "middle"
                      }
                    >
                      {item.label}
                    </text>
                  </g>
                ))}
                {trendRows.map((point, index) => {
                  const x = trendRows.length <= 1 ? 0 : (index / (trendRows.length - 1)) * trendWidth;
                  const yAttempt = trendHeight - point.cumulativeAttemptRate * trendHeight;
                  const yApply = trendHeight - point.cumulativeApplyRate * trendHeight;
                  return (
                    <g key={`${point.roundIndex}-${index}`} onMouseEnter={() => setHoverPointIndex(index)}>
                      <circle cx={x} cy={yAttempt} r={index === activePointIndex ? 4 : 2.5} fill="#3b82f6" />
                      <circle cx={x} cy={yApply} r={index === activePointIndex ? 4 : 2.5} fill="#10b981" />
                    </g>
                  );
                })}
                {activePoint && (
                  <>
                    <line x1={activeX} y1={0} x2={activeX} y2={trendHeight} stroke="#94a3b8" strokeDasharray="4 4" />
                    <circle cx={activeX} cy={activeAttemptY} r={4.5} fill="#3b82f6" />
                    <circle cx={activeX} cy={activeApplyY} r={4.5} fill="#10b981" />
                  </>
                )}
                </svg>
                {activePoint && (
                  <div
                    style={{
                      position: "absolute",
                      ...(tooltipPos
                        ? { left: `${tooltipPos.left}px`, top: `${tooltipPos.top}px` }
                        : { right: "8px", top: "8px" }),
                      background: "rgba(17,24,39,0.9)",
                      color: "#fff",
                      borderRadius: "8px",
                      padding: "8px 10px",
                      fontSize: "12px",
                      lineHeight: 1.5,
                      pointerEvents: "none",
                    }}
                  >
                    <div>轮次：{activePoint.roundIndex}</div>
                    <div>时间：{formatTimeLabel(activePoint.createdAt)}</div>
                    <div>尝试率：{rateToPercent(activePoint.cumulativeAttemptRate)}</div>
                    <div>生效率：{rateToPercent(activePoint.cumulativeApplyRate)}</div>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "14px", fontSize: "12px", color: "#4b5563" }}>
                <span>● 蓝线：尝试率</span>
                <span>● 绿线：生效率</span>
                <span>当前显示：{trendRows.length} 轮</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ gridColumn: "1 / -1", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
          <h4 style={{ marginTop: 0 }}>自动结论</h4>
          <div style={{ color: "#374151", lineHeight: 1.7 }}>{loading ? "加载中..." : insightText}</div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
          <h4 style={{ marginTop: 0 }}>回退/命中原因分布</h4>
          {loading && <div>加载中...</div>}
          {!loading && reasonRows.length === 0 && <div style={{ color: "#6b7280" }}>暂无数据</div>}
          {!loading &&
            reasonRows.map(([reason, count]) => (
              <div key={reason} style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span>{reason}</span>
                <strong>{count}</strong>
              </div>
            ))}
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px" }}>
          <h4 style={{ marginTop: 0 }}>模式分布</h4>
          {loading && <div>加载中...</div>}
          {!loading && modeRows.length === 0 && <div style={{ color: "#6b7280" }}>暂无数据</div>}
          {!loading &&
            modeRows.map(([mode, count]) => (
              <div key={mode} style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span>{mode}</span>
                <strong>{count}</strong>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const API_BASE = process.env.ZHIPU_API_BASE || "https://open.bigmodel.cn/api/coding/paas/v4";
const MODELS = ["GLM-5-Turbo", "GLM-4.7", "GLM-4.7-Flash"];
const MAX_TOKENS = 100000;
const TIMEOUT_MS = 660_000;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `你是關係心理學與婚姻治療領域的資深研究員與科學傳播者。你的任務是：
1. 從提供的醫學與心理學文獻中，篩選出最具臨床意義與研究價值的論文
2. 對每篇論文進行繁體中文摘要、分類、PICO 分析
3. 評估其臨床實用性（高/中/低）
4. 生成適合心理健康專業人員與一般大眾閱讀的日報

輸出格式要求：
- 語言：繁體中文（台灣用語）
- 專業但易懂
- 每篇論文需包含：中文標題、一句話總結、PICO分析、臨床實用性、分類標籤
- 最後提供今日精選 TOP 5-8（最重要/最影響臨床實踐的論文）
回傳格式必須是純 JSON，不要用 markdown code block 包裹。`;

const TAG_OPTIONS = [
  "關係品質", "婚姻滿意度", "伴侶溝通", "衝突修復", "成人依附",
  "信任與承諾", "情緒調節", "共調節", "同理心", "性滿意度",
  "性親密", "雙人因應", "壓力與韌性", "伴侶治療", "關係教育",
  "創傷與依附", "神經生物學", "嫉妒與不忠", "關係暴力", "離婚與分居",
  "情感投入", "依附焦慮", "依附逃避", "安全依附", "寬恕",
  "情感揭露", "身體親密", "生理同步", "催產素", "皮質醇",
];

function robustJsonParse(text) {
  let raw = text.trim();
  if (raw.startsWith("```")) {
    raw = raw.includes("\n") ? raw.split("\n").slice(1).join("\n") : raw.slice(3);
    raw = raw.replace(/```+\s*$/,"");
  }
  raw = raw.trim();
  try {
    return JSON.parse(raw);
  } catch {}
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }
  let depth = 0;
  let start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (raw[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {}
      }
    }
  }
  throw new Error("JSON parse failed after all recovery attempts");
}

async function callZhipuAPI(apiKey, papersData) {
  const dateStr = papersData.date;
  const papersText = JSON.stringify(papersData.papers, null, 2);
  const paperCount = papersData.count;

  const prompt = `以下是 ${dateStr} 從 PubMed 抓取的最新關係與婚姻研究文獻（共 ${paperCount} 篇）。

請進行以下分析，並以 JSON 格式回傳（不要用 markdown code block）：

{
  "date": "${dateStr}",
  "market_summary": "1-2句話總結今天文獻的整體趨勢與亮點，聚焦在關係與婚姻研究",
  "top_picks": [
    {
      "rank": 1,
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結（繁體中文，點出核心發現與臨床意義）",
      "pico": {
        "population": "研究對象",
        "intervention": "介入措施",
        "comparison": "對照組",
        "outcome": "主要結果"
      },
      "clinical_utility": "高/中/低",
      "utility_reason": "為什麼實用的一句話說明",
      "tags": ["標籤1", "標籤2"],
      "url": "原文連結",
      "emoji": "相關emoji"
    }
  ],
  "all_papers": [
    {
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結",
      "clinical_utility": "高/中/低",
      "tags": ["標籤1"],
      "url": "連結",
      "emoji": "emoji"
    }
  ],
  "keywords": ["關鍵字1", "關鍵字2"],
  "topic_distribution": {
    "關係品質": 3,
    "伴侶溝通": 2
  }
}

原始文獻資料：
${papersText}

請篩選出最重要的 TOP 5-8 篇論文放入 top_picks（按重要性排序），其餘放入 all_papers。
每篇 paper 的 tags 請從以下選擇：${TAG_OPTIONS.join("、")}。
記住：回傳純 JSON，不要用 \`\`\`json\`\`\` 包裹。`;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.error(`[INFO] Trying ${model} (attempt ${attempt + 1})...`);
        const resp = await fetch(`${API_BASE}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            top_p: 0.9,
            max_tokens: MAX_TOKENS,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (resp.status === 429) {
          const wait = 60000 * (attempt + 1);
          console.error(`[WARN] Rate limited, waiting ${wait / 1000}s...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          console.error(`[ERROR] HTTP ${resp.status}: ${errText.slice(0, 200)}`);
          if (resp.status >= 500) {
            await new Promise((r) => setTimeout(r, 10000));
            continue;
          }
          break;
        }

        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) {
          console.error(`[WARN] Empty response from ${model}`);
          continue;
        }

        const result = robustJsonParse(text);
        console.error(
          `[INFO] Analysis complete: ${result.top_picks?.length || 0} top picks, ${result.all_papers?.length || 0} total`
        );
        result._model = model;
        return result;
      } catch (e) {
        if (e.name === "SyntaxError" || e.message?.includes("JSON")) {
          console.error(`[WARN] JSON parse failed on attempt ${attempt + 1}: ${e.message}`);
          if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        console.error(`[ERROR] ${model} failed: ${e.message}`);
        if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, 10000));
      }
    }
  }

  return null;
}

function generateHtml(analysis) {
  const dateStr = analysis.date || new Date().toISOString().slice(0, 10);
  const dp = dateStr.split("-");
  const dateDisplay = dp.length === 3 ? `${dp[0]}年${parseInt(dp[1])}月${parseInt(dp[2])}日` : dateStr;
  const summary = analysis.market_summary || "";
  const topPicks = analysis.top_picks || [];
  const allPapers = analysis.all_papers || [];
  const keywords = analysis.keywords || [];
  const topicDist = analysis.topic_distribution || {};
  const modelUsed = analysis._model || MODELS[0];
  const totalCount = topPicks.length + allPapers.length;

  const topPicksHtml = topPicks
    .map((p) => {
      const tags = (p.tags || []).map((t) => `<span class="tag">${t}</span>`).join("");
      const util = p.clinical_utility || "中";
      const uClass = util === "高" ? "utility-high" : util === "中" ? "utility-mid" : "utility-low";
      const pico = p.pico || {};
      const picoHtml = Object.keys(pico).length
        ? `<div class="pico-grid">
  <div class="pico-item"><span class="pico-label">P</span><span class="pico-text">${pico.population || "-"}</span></div>
  <div class="pico-item"><span class="pico-label">I</span><span class="pico-text">${pico.intervention || "-"}</span></div>
  <div class="pico-item"><span class="pico-label">C</span><span class="pico-text">${pico.comparison || "-"}</span></div>
  <div class="pico-item"><span class="pico-label">O</span><span class="pico-text">${pico.outcome || "-"}</span></div>
</div>`
        : "";
      return `<div class="news-card featured">
  <div class="card-header">
    <span class="rank-badge">#${p.rank || ""}</span>
    <span class="emoji-icon">${p.emoji || "📄"}</span>
    <span class="${uClass}">${util}實用性</span>
  </div>
  <h3>${p.title_zh || p.title_en || ""}</h3>
  <p class="journal-source">${p.journal || ""} &middot; ${p.title_en || ""}</p>
  <p>${p.summary || ""}</p>
  ${picoHtml}
  <div class="card-footer">
    ${tags}
    <a href="${p.url || "#"}" target="_blank">閱讀原文 →</a>
  </div>
</div>`;
    })
    .join("\n");

  const allPapersHtml = allPapers
    .map((p) => {
      const tags = (p.tags || []).map((t) => `<span class="tag">${t}</span>`).join("");
      const util = p.clinical_utility || "中";
      const uClass = util === "高" ? "utility-high" : util === "中" ? "utility-mid" : "utility-low";
      return `<div class="news-card">
  <div class="card-header-row">
    <span class="emoji-sm">${p.emoji || "📄"}</span>
    <span class="${uClass} utility-sm">${util}</span>
  </div>
  <h3>${p.title_zh || p.title_en || ""}</h3>
  <p class="journal-source">${p.journal || ""}</p>
  <p>${p.summary || ""}</p>
  <div class="card-footer">
    ${tags}
    <a href="${p.url || "#"}" target="_blank">PubMed →</a>
  </div>
</div>`;
    })
    .join("\n");

  const keywordsHtml = keywords.map((k) => `<span class="keyword">${k}</span>`).join("");
  let topicBarsHtml = "";
  if (Object.keys(topicDist).length) {
    const maxCount = Math.max(...Object.values(topicDist), 1);
    topicBarsHtml = Object.entries(topicDist)
      .map(
        ([topic, count]) => `<div class="topic-row">
  <span class="topic-name">${topic}</span>
  <div class="topic-bar-bg"><div class="topic-bar" style="width:${Math.round((count / maxCount) * 100)}%"></div></div>
  <span class="topic-count">${count}</span>
</div>`
      )
      .join("\n");
  }

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Relationship Mind &middot; 關係與婚姻研究日報 &middot; ${dateDisplay}</title>
<meta name="description" content="${dateDisplay} 關係與婚姻研究文獻日報，由 AI 自動彙整 PubMed 最新論文"/>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; --card-bg: color-mix(in srgb, var(--surface) 92%, white); }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; overflow-x: hidden; }
  .container { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 60px 32px 80px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 52px; animation: fadeDown 0.6s ease both; }
  .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; box-shadow: 0 4px 20px rgba(140,79,43,0.25); }
  .header-text h1 { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .header-meta { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; letter-spacing: 0.3px; }
  .badge-date { background: var(--accent-soft); border: 1px solid var(--line); color: var(--accent); }
  .badge-count { background: rgba(140,79,43,0.06); border: 1px solid var(--line); color: var(--muted); }
  .badge-source { background: transparent; color: var(--muted); font-size: 11px; padding: 0 4px; }
  .summary-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 28px 32px; margin-bottom: 32px; box-shadow: 0 20px 60px rgba(61,36,15,0.06); animation: fadeUp 0.5s ease 0.1s both; }
  .summary-card h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.6px; color: var(--accent); margin-bottom: 16px; }
  .summary-text { font-size: 15px; line-height: 1.8; color: var(--text); }
  .section { margin-bottom: 36px; animation: fadeUp 0.5s ease both; }
  .section-title { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; background: var(--accent-soft); }
  .news-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 22px 26px; margin-bottom: 12px; box-shadow: 0 8px 30px rgba(61,36,15,0.04); transition: background 0.2s, border-color 0.2s, transform 0.2s; }
  .news-card:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .news-card.featured { border-left: 3px solid var(--accent); }
  .news-card.featured:hover { border-color: var(--accent); }
  .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .rank-badge { background: var(--accent); color: #fff7f0; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 6px; }
  .emoji-icon { font-size: 18px; }
  .card-header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .emoji-sm { font-size: 14px; }
  .news-card h3 { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; line-height: 1.5; }
  .journal-source { font-size: 12px; color: var(--accent); margin-bottom: 8px; opacity: 0.8; }
  .news-card p { font-size: 13.5px; line-height: 1.75; color: var(--muted); }
  .card-footer { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { padding: 2px 9px; background: var(--accent-soft); border-radius: 999px; font-size: 11px; color: var(--accent); }
  .news-card a { font-size: 12px; color: var(--accent); text-decoration: none; opacity: 0.7; margin-left: auto; }
  .news-card a:hover { opacity: 1; }
  .utility-high { color: #5a7a3a; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(90,122,58,0.1); border-radius: 4px; }
  .utility-mid { color: #9f7a2e; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(159,122,46,0.1); border-radius: 4px; }
  .utility-low { color: var(--muted); font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(118,100,83,0.08); border-radius: 4px; }
  .utility-sm { font-size: 10px; }
  .pico-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; padding: 12px; background: rgba(255,253,249,0.8); border-radius: 14px; border: 1px solid var(--line); }
  .pico-item { display: flex; gap: 8px; align-items: baseline; }
  .pico-label { font-size: 10px; font-weight: 700; color: #fff7f0; background: var(--accent); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
  .pico-text { font-size: 12px; color: var(--muted); line-height: 1.4; }
  .keywords-section { margin-bottom: 36px; }
  .keywords { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .keyword { padding: 5px 14px; background: var(--accent-soft); border: 1px solid var(--line); border-radius: 20px; font-size: 12px; color: var(--accent); cursor: default; transition: background 0.2s; }
  .keyword:hover { background: rgba(140,79,43,0.18); }
  .topic-section { margin-bottom: 36px; }
  .topic-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .topic-name { font-size: 13px; color: var(--muted); width: 100px; flex-shrink: 0; text-align: right; }
  .topic-bar-bg { flex: 1; height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; }
  .topic-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #c47a4a); border-radius: 4px; transition: width 0.6s ease; }
  .topic-count { font-size: 12px; color: var(--accent); width: 24px; }
  .footer-links { margin-top: 48px; animation: fadeUp 0.5s ease 0.4s both; }
  .footer-link-card { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; text-decoration: none; color: var(--text); transition: all 0.2s; box-shadow: 0 8px 30px rgba(61,36,15,0.04); margin-bottom: 12px; }
  .footer-link-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .footer-icon { font-size: 28px; flex-shrink: 0; }
  .footer-name { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; }
  .footer-arrow { font-size: 18px; color: var(--accent); font-weight: 700; }
  footer { margin-top: 32px; padding-top: 22px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); display: flex; justify-content: space-between; animation: fadeUp 0.5s ease 0.5s both; }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--accent); }
  @keyframes fadeDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 600px) { .container { padding: 36px 18px 60px; } .summary-card, .news-card { padding: 20px 18px; } .pico-grid { grid-template-columns: 1fr; } footer { flex-direction: column; gap: 6px; text-align: center; } .topic-name { width: 70px; font-size: 11px; } }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">💑</div>
    <div class="header-text">
      <h1>Relationship Mind &middot; 關係與婚姻研究日報</h1>
      <div class="header-meta">
        <span class="badge badge-date">📅 ${dateDisplay}</span>
        <span class="badge badge-count">📊 ${totalCount} 篇文獻</span>
        <span class="badge badge-source">Powered by PubMed + Zhipu AI</span>
      </div>
    </div>
  </header>

  <div class="summary-card">
    <h2>📋 今日文獻趨勢</h2>
    <p class="summary-text">${summary}</p>
  </div>

  ${topPicksHtml ? `<div class='section'><div class='section-title'><span class='section-icon'>⭐</span>今日精選 TOP Picks</div>${topPicksHtml}</div>` : ""}

  ${allPapersHtml ? `<div class='section'><div class='section-title'><span class='section-icon'>📚</span>其他值得關注的文獻</div>${allPapersHtml}</div>` : ""}

  ${topicBarsHtml ? `<div class='topic-section section'><div class='section-title'><span class='section-icon'>📊</span>主題分佈</div>${topicBarsHtml}</div>` : ""}

  ${keywordsHtml ? `<div class='keywords-section section'><div class='section-title'><span class='section-icon'>🏷️</span>關鍵字</div><div class='keywords'>${keywordsHtml}</div></div>` : ""}

  <div class="footer-links">
    <a href="https://www.leepsyclinic.com/" class="footer-link-card" target="_blank">
      <span class="footer-icon">🏥</span>
      <span class="footer-name">李政洋身心診所首頁</span>
      <span class="footer-arrow">→</span>
    </a>
    <a href="https://blog.leepsyclinic.com/" class="footer-link-card" target="_blank">
      <span class="footer-icon">📬</span>
      <span class="footer-name">訂閱電子報</span>
      <span class="footer-arrow">→</span>
    </a>
    <a href="https://buymeacoffee.com/CYlee" class="footer-link-card" target="_blank">
      <span class="footer-icon">☕</span>
      <span class="footer-name">Buy Me a Coffee</span>
      <span class="footer-arrow">→</span>
    </a>
  </div>

  <footer>
    <span>資料來源：PubMed &middot; 分析模型：${modelUsed}</span>
    <span><a href="https://github.com/u8901006/relationship-mind">GitHub</a></span>
  </footer>
</div>
</body>
</html>`;
}

async function main() {
  const inputArg = process.argv.find((a) => a.startsWith("--input="))?.split("=")[1];
  const outputArg = process.argv.find((a) => a.startsWith("--output="))?.split("=")[1];
  const apiKey = process.env.ZHIPU_API_KEY;

  if (!apiKey) {
    console.error("[ERROR] ZHIPU_API_KEY env var is required");
    process.exit(1);
  }

  const inputPath = inputArg || resolve(ROOT, "papers.json");
  const outputPath = outputArg || "";

  if (!outputPath) {
    console.error("[ERROR] --output= is required");
    process.exit(1);
  }

  let papersData;
  try {
    papersData = JSON.parse(readFileSync(inputPath, "utf-8"));
  } catch (e) {
    console.error(`[ERROR] Cannot read papers: ${e.message}`);
    process.exit(1);
  }

  let analysis;
  if (!papersData.papers?.length) {
    console.error("[WARN] No papers found, generating empty report");
    analysis = {
      date: papersData.date || new Date().toISOString().slice(0, 10),
      market_summary: "今日 PubMed 暫無新的關係與婚姻研究文獻更新。請明天再查看。",
      top_picks: [],
      all_papers: [],
      keywords: [],
      topic_distribution: {},
    };
  } else {
    analysis = await callZhipuAPI(apiKey, papersData);
    if (!analysis) {
      console.error("[ERROR] All AI models failed");
      process.exit(1);
    }
  }

  const html = generateHtml(analysis);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf-8");
  console.error(`[INFO] Report saved to ${outputPath}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});

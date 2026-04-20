import { readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DOCS = resolve(ROOT, "docs");

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

try {
  const files = readdirSync(DOCS)
    .filter((f) => f.startsWith("relationship-") && f.endsWith(".html"))
    .sort()
    .reverse();

  const links = files
    .slice(0, 60)
    .map((f) => {
      const date = f.replace("relationship-", "").replace(".html", "");
      let display = date;
      let weekday = "";
      try {
        const [y, m, d] = date.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        display = `${y}年${m}月${d}日`;
        weekday = WEEKDAYS[dt.getDay()];
      } catch {}
      return `<li><a href="${f}">📅 ${display}（週${weekday}）</a></li>`;
    })
    .join("\n");

  const total = files.length;

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Relationship Mind · 關係與婚姻研究日報</title>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; }
  .container { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 80px 24px; }
  .logo { font-size: 48px; text-align: center; margin-bottom: 16px; }
  h1 { text-align: center; font-size: 24px; color: var(--text); margin-bottom: 8px; }
  .subtitle { text-align: center; color: var(--accent); font-size: 14px; margin-bottom: 48px; }
  .count { text-align: center; color: var(--muted); font-size: 13px; margin-bottom: 32px; }
  ul { list-style: none; }
  li { margin-bottom: 8px; }
  a { color: var(--text); text-decoration: none; display: block; padding: 14px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; transition: all 0.2s; font-size: 15px; }
  a:hover { background: var(--accent-soft); border-color: var(--accent); transform: translateX(4px); }
  .footer-links { margin-top: 48px; }
  .footer-link-card { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; text-decoration: none; color: var(--text); transition: all 0.2s; margin-bottom: 12px; }
  .footer-link-card:hover { border-color: var(--accent); transform: translateX(4px); }
  .footer-icon { font-size: 28px; flex-shrink: 0; }
  .footer-name { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; }
  .footer-arrow { font-size: 18px; color: var(--accent); font-weight: 700; }
  footer { margin-top: 56px; text-align: center; font-size: 12px; color: var(--muted); }
  footer a { display: inline; padding: 0; background: none; border: none; color: var(--muted); }
  footer a:hover { color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <div class="logo">💑</div>
  <h1>Relationship Mind</h1>
  <p class="subtitle">關係與婚姻研究文獻日報 · 每日自動更新</p>
  <p class="count">共 ${total} 期日報</p>
  <ul>${links}</ul>
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
    <p>Powered by PubMed + Zhipu AI · <a href="https://github.com/u8901006/relationship-mind">GitHub</a></p>
  </footer>
</div>
</body>
</html>`;

  writeFileSync(resolve(DOCS, "index.html"), html, "utf-8");
  console.error(`[INFO] Index page generated with ${total} reports`);
} catch (e) {
  console.error(`[WARN] Index generation issue: ${e.message}`);
  const emptyHtml = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Relationship Mind · 關係與婚姻研究日報</title>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; }
  .container { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 80px 24px; }
  .logo { font-size: 48px; text-align: center; margin-bottom: 16px; }
  h1 { text-align: center; font-size: 24px; color: var(--text); margin-bottom: 8px; }
  .subtitle { text-align: center; color: var(--accent); font-size: 14px; margin-bottom: 48px; }
  footer { margin-top: 56px; text-align: center; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div class="container">
  <div class="logo">💑</div>
  <h1>Relationship Mind</h1>
  <p class="subtitle">關係與婚姻研究文獻日報 · 即將啟動</p>
</div>
</body>
</html>`;
  writeFileSync(resolve(DOCS, "index.html"), emptyHtml, "utf-8");
}

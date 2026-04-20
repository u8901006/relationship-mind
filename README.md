# Relationship Mind 💑

> 關係與婚姻研究文獻日報 · 每日自動更新

本專案透過 GitHub Actions 每日自動從 PubMed 抓取最新關係與婚姻研究文獻，經 AI 分析後生成精美日報並部署至 GitHub Pages。

## 網站

- [Relationship Mind 日報首頁](https://u8901006.github.io/relationship-mind/)

## 技術架構

- **文獻來源**: PubMed E-utilities API
- **AI 分析**: GLM-5-Turbo（fallback: GLM-4.7 → GLM-4.7-Flash）
- **前端**: 純 HTML/CSS（與 Psychiatry-brain 相同配色）
- **部署**: GitHub Pages
- **CI/CD**: GitHub Actions（每日台北時間 12:00 執行）

## 去重機制

系統維護 `seen_pmids.json` 記錄所有已收錄的 PubMed ID，確保不重複收錄文獻。

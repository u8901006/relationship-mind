import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

const SEARCH_TEMPLATES = [
  `((romantic relationship[Title/Abstract] OR intimate relationship[Title/Abstract] OR couple relationship[Title/Abstract] OR marriage[Title/Abstract] OR marital relationship[Title/Abstract]) AND (relationship quality[Title/Abstract] OR relationship satisfaction[Title/Abstract] OR marital satisfaction[Title/Abstract] OR dyadic adjustment[Title/Abstract] OR couple functioning[Title/Abstract])) AND english[lang]`,
  `((marriage[Title/Abstract] OR marital relationship[Title/Abstract] OR spouses[Title/Abstract]) AND (relationship maintenance[Title/Abstract] OR marital maintenance[Title/Abstract] OR marital stability[Title/Abstract] OR successful marriage[Title/Abstract] OR thriving relationship[Title/Abstract] OR couple wellbeing[Title/Abstract])) AND english[lang]`,
  `((couple communication[Title/Abstract] OR marital communication[Title/Abstract] OR relationship conflict[Title/Abstract] OR marital conflict[Title/Abstract]) AND (conflict resolution[Title/Abstract] OR repair attempt[Title/Abstract] OR responsiveness[Title/Abstract] OR validation[Title/Abstract] OR constructive communication[Title/Abstract])) AND english[lang]`,
  `((adult attachment[Title/Abstract] OR attachment anxiety[Title/Abstract] OR attachment avoidance[Title/Abstract] OR secure attachment[Title/Abstract]) AND (romantic relationship[Title/Abstract] OR intimate relationship[Title/Abstract] OR marriage[Title/Abstract] OR partner relationship[Title/Abstract])) AND english[lang]`,
  `((trust[Title/Abstract] OR betrayal[Title/Abstract] OR commitment[Title/Abstract] OR relationship commitment[Title/Abstract] OR dedication[Title/Abstract]) AND (relationship satisfaction[Title/Abstract] OR marital satisfaction[Title/Abstract] OR relationship stability[Title/Abstract] OR breakup[Title/Abstract] OR divorce[Title/Abstract])) AND english[lang]`,
  `((emotion regulation[Title/Abstract] OR dyadic regulation[Title/Abstract] OR co-regulation[Title/Abstract] OR affect regulation[Title/Abstract] OR emotional attunement[Title/Abstract]) AND (couple*[Title/Abstract] OR marital[Title/Abstract] OR romantic partner*[Title/Abstract])) AND english[lang]`,
  `((empathy[Title/Abstract] OR compassion[Title/Abstract] OR perspective taking[Title/Abstract] OR perceived partner responsiveness[Title/Abstract] OR validation[Title/Abstract]) AND (intimacy[Title/Abstract] OR relationship satisfaction[Title/Abstract] OR marital satisfaction[Title/Abstract])) AND english[lang]`,
  `((sexual satisfaction[Title/Abstract] OR sexual intimacy[Title/Abstract] OR sexual communication[Title/Abstract] OR sexual desire[Title/Abstract] OR desire discrepancy[Title/Abstract]) AND (couple*[Title/Abstract] OR marriage[Title/Abstract] OR marital satisfaction[Title/Abstract] OR relationship satisfaction[Title/Abstract])) AND english[lang]`,
  `((dyadic coping[Title/Abstract] OR couple resilience[Title/Abstract] OR resilience[Title/Abstract] OR stress spillover[Title/Abstract] OR stress crossover[Title/Abstract]) AND (marriage[Title/Abstract] OR couple*[Title/Abstract] OR romantic relationship[Title/Abstract])) AND english[lang]`,
  `((couples therapy[Title/Abstract] OR couple therapy[Title/Abstract] OR marital therapy[Title/Abstract] OR behavioral couples therapy[Title/Abstract] OR emotionally focused therapy[Title/Abstract] OR relationship education[Title/Abstract]) AND (relationship satisfaction[Title/Abstract] OR marital satisfaction[Title/Abstract] OR dyadic adjustment[Title/Abstract] OR couple functioning[Title/Abstract])) AND english[lang]`,
  `((trauma[Title/Abstract] OR childhood adversity[Title/Abstract] OR adverse childhood experiences[Title/Abstract] OR PTSD[Title/Abstract]) AND (attachment insecurity[Title/Abstract] OR attachment anxiety[Title/Abstract] OR attachment avoidance[Title/Abstract] OR emotion regulation[Title/Abstract]) AND (romantic relationship[Title/Abstract] OR marriage[Title/Abstract] OR couple functioning[Title/Abstract])) AND english[lang]`,
  `((pair bond*[Title/Abstract] OR bonding[Title/Abstract] OR attachment[Title/Abstract] OR social bonding[Title/Abstract]) AND (oxytocin[Title/Abstract] OR cortisol[Title/Abstract] OR vagal tone[Title/Abstract] OR heart rate variability[Title/Abstract] OR neural[Title/Abstract] OR brain[Title/Abstract])) AND english[lang]`,
];

function getDateRange(days) {
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(from), to: "3000" };
}

function loadSeenPmids() {
  const path = resolve(ROOT, "seen_pmids.json");
  if (existsSync(path)) {
    try {
      return new Set(JSON.parse(readFileSync(path, "utf-8")));
    } catch {
      return new Set();
    }
  }
  return new Set();
}

function saveSeenPmids(seen) {
  const path = resolve(ROOT, "seen_pmids.json");
  writeFileSync(path, JSON.stringify([...seen], null, 2), "utf-8");
}

async function pubmedSearch(query, retmax = 40) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=date&retmode=json`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "RelationshipMindBot/1.0 (research aggregator)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`PubMed search HTTP ${resp.status}`);
  const data = await resp.json();
  return data?.esearchresult?.idlist || [];
}

async function pubmedFetch(pmids) {
  if (!pmids.length) return [];
  const url = `${PUBMED_FETCH}?db=pubmed&id=${pmids.join(",")}&retmode=xml`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "RelationshipMindBot/1.0 (research aggregator)" },
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw new Error(`PubMed fetch HTTP ${resp.status}`);
  const xml = await resp.text();
  return parseXml(xml);
}

function parseXml(xml) {
  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const abstractParts = [];
    const absRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let absMatch;
    while ((absMatch = absRegex.exec(block)) !== null) {
      const labelMatch = absMatch[0].match(/Label="([^"]+)"/);
      const label = labelMatch ? labelMatch[1] : "";
      const text = absMatch[1].replace(/<[^>]+>/g, "").trim();
      if (label && text) abstractParts.push(`${label}: ${text}`);
      else if (text) abstractParts.push(text);
    }
    const abstract = abstractParts.join(" ").slice(0, 2000);
    const journalMatch = block.match(/<Title>([\s\S]*?)<\/Title>/);
    const journal = journalMatch ? journalMatch[1].trim() : "";
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch ? pmidMatch[1] : "";
    const yearMatch = block.match(/<Year>(\d+)<\/Year>/);
    const monthMatch = block.match(/<Month>(\w+)<\/Month>/);
    const dayMatch = block.match(/<Day>(\d+)<\/Day>/);
    const dateParts = [
      yearMatch?.[1],
      monthMatch?.[1],
      dayMatch?.[1],
    ].filter(Boolean);
    const dateStr = dateParts.join(" ");
    const keywords = [];
    const kwRegex = /<Keyword>([\s\S]*?)<\/Keyword>/g;
    let kwMatch;
    while ((kwMatch = kwRegex.exec(block)) !== null) {
      keywords.push(kwMatch[1].trim());
    }
    if (pmid && title) {
      papers.push({
        pmid,
        title,
        journal,
        date: dateStr,
        abstract,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        keywords,
      });
    }
  }
  return papers;
}

function getTaipeiDate() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );
}

async function main() {
  const days = parseInt(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] || "7", 10);
  const maxPapers = parseInt(process.argv.find((a) => a.startsWith("--max-papers="))?.split("=")[1] || "60", 10);
  const outputPath = process.argv.find((a) => a.startsWith("--output="))?.split("=")[1] || resolve(ROOT, "papers.json");

  const { from } = getDateRange(days);
  const dateFilter = `"${from}"[Date - Publication] : "3000"[Date - Publication]`;
  const seenPmids = loadSeenPmids();

  console.error(`[INFO] Searching PubMed for papers from last ${days} days...`);
  console.error(`[INFO] Already seen PMIDs: ${seenPmids.size}`);

  const allPmids = new Set();
  for (const template of SEARCH_TEMPLATES) {
    const query = `(${template}) AND ${dateFilter}`;
    try {
      const ids = await pubmedSearch(query, Math.ceil(maxPapers / SEARCH_TEMPLATES.length) + 5);
      for (const id of ids) allPmids.add(id);
    } catch (e) {
      console.error(`[WARN] Search template failed: ${e.message}`);
    }
  }

  const newPmids = [...allPmids].filter((id) => !seenPmids.has(id));
  console.error(`[INFO] Total PMIDs found: ${allPmids.size}, new (not seen): ${newPmids.length}`);

  const pmidsToFetch = newPmids.slice(0, maxPapers);
  let papers = [];
  if (pmidsToFetch.length > 0) {
    console.error(`[INFO] Fetching details for ${pmidsToFetch.length} papers...`);
    try {
      papers = await pubmedFetch(pmidsToFetch);
    } catch (e) {
      console.error(`[ERROR] Fetch failed: ${e.message}`);
    }
  }

  for (const p of papers) {
    seenPmids.add(p.pmid);
  }
  saveSeenPmids(seenPmids);

  const dateStr = getTaipeiDate().toISOString().slice(0, 10);
  const output = { date: dateStr, count: papers.length, papers };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.error(`[INFO] Saved ${papers.length} papers to ${outputPath}`);

  if (papers.length === 0) {
    console.error("[WARN] No new papers found");
  }
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});

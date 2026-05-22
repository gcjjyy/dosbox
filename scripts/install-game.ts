#!/usr/bin/env bun
// Search & install games from nemo838.tistory.com into ~/dos/{CODE}/
//
// Usage:
//   bun scripts/install-game.ts search "<keyword>"          → JSON list of matches
//   bun scripts/install-game.ts install "<url>" [<name>]    → download + extract to ~/dos/{name or auto-code}
//
// Inspired by doogie-cli (~/lab/doogie-cli) parseGamePage / downloadFiles / extract7z.
// No external npm deps — uses regex parsing instead of cheerio.

import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

const BLOG = "https://nemo838.tistory.com";
const PASSWORD = "http://nemo838.tistory.com/";
const DOS_ROOT = process.env.DOS_ROOT || join(homedir(), "dos");
const GAMES_DIR = join(DOS_ROOT, "GAMES");
const CONCURRENT = 5;
const SEVENZIP =
  ["/opt/homebrew/bin/7z", "/usr/local/bin/7z", "/opt/homebrew/bin/7zz", "/usr/local/bin/7zz", "/opt/homebrew/bin/7za"]
    .find(p => existsSync(p)) || "7z";

// ─── Search ──────────────────────────────────────────────────────────────────

interface SearchHit {
  id: string;
  url: string;
  title: string;
  titleEn: string | null;
  genre: string | null;
  date: string;
}

async function fetchSearchHits(keyword: string): Promise<SearchHit[]> {
  const url = `${BLOG}/search/${encodeURIComponent(keyword)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const html = await res.text();

  const listMatch = html.match(/<div id="searchList"[\s\S]*?<\/ul>/);
  if (!listMatch) return [];

  const block = listMatch[0];
  const hits: SearchHit[] = [];
  const itemRe = /<li>\s*<a href="\/(\d+)"[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>[\s\S]*?<\/a>\s*<p>([^<]+)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(block)) !== null) {
    const id = m[1];
    const rawTitle = m[2].replace(/\s+/g, " ").trim();
    const date = m[3].trim();

    let title = rawTitle;
    let titleEn: string | null = null;
    let genre: string | null = null;

    const genreMatch = title.match(/\{([^,]+)\s*,\s*([^}]+)\}\s*$/);
    if (genreMatch) {
      genre = genreMatch[1].trim();
      title = title.replace(/\s*\{[^}]+\}\s*$/, "").trim();
    }

    const enMatch = title.match(/^(.+?)\s*,\s*(.+)$/);
    if (enMatch) {
      title = enMatch[1].trim();
      titleEn = enMatch[2].trim();
    }

    hits.push({ id, url: `${BLOG}/${id}`, title, titleEn, genre, date });
  }
  return hits;
}

// Tistory search is whitespace-tokenized, so "삼국지 4" matches posts containing both "삼국지" AND "4"
// as separate tokens — but "4" alone is too short and often filtered. The no-space variant
// "삼국지4" treats it as one token and reliably hits "삼국지 4 (K)" etc.
// Try both forms and merge unique results when the input contains whitespace + digit.
async function search(keyword: string): Promise<SearchHit[]> {
  const variants = [keyword];
  const compact = keyword.replace(/\s+/g, "");
  if (compact !== keyword && /\d/.test(keyword)) variants.push(compact);

  const seen = new Set<string>();
  const merged: SearchHit[] = [];
  for (const v of variants) {
    const hits = await fetchSearchHits(v);
    for (const h of hits) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      merged.push(h);
    }
  }
  return merged;
}

// ─── Parse game page ─────────────────────────────────────────────────────────

interface Attachment {
  filename: string;
  downloadUrl: string;
  isGame: boolean;
}

interface GameInfo {
  title: string;
  code: string;
  attachments: Attachment[];
}

function cleanFilename(text: string): string {
  const m = text.match(/([A-Za-z0-9_-]+\.7z(?:\.\d+)?)/i);
  return m ? m[1] : text.trim();
}

function extractGameCode(filename: string): string | null {
  // SamHero_241212.7z.001 → SamHero_241212
  let m = filename.match(/^(.+_\d{6})_(?:Config|Manual)/i);
  if (m) return m[1];
  m = filename.match(/^(.+_\d{6})\.7z/i);
  if (m) return m[1];
  m = filename.match(/^([A-Za-z0-9]+)_(?:Config|Manual)\.7z/i);
  if (m) return m[1];
  m = filename.match(/^([A-Za-z0-9]+)\.7z/i);
  if (m) return m[1];
  return null;
}

async function parseGamePage(url: string): Promise<GameInfo> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Page fetch failed: ${res.status}`);
  const html = await res.text();

  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
  let title = titleMatch ? titleMatch[1] : "Unknown";
  title = title.replace(/\s*\{[^}]+\}\s*$/, "").trim();

  const attachments: Attachment[] = [];
  let code: string | null = null;
  const seen = new Set<string>();

  // Match <a href="..."> text </a> where href contains the download host
  const linkRe = /<a[^>]*href="(https?:\/\/[^"]*(?:blog\.kakaocdn\.net|tistory\.com\/attachment)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const rawText = m[2].replace(/<[^>]+>/g, "").trim();
    let filename = cleanFilename(rawText);
    if (!filename.match(/\.7z(?:\.\d+)?$/i)) {
      try {
        filename = basename(new URL(href).pathname);
      } catch {}
    }
    if (!filename.match(/\.7z(?:\.\d+)?$/i)) continue;
    if (seen.has(filename)) continue;
    seen.add(filename);

    const isConfig = /_config/i.test(filename);
    const isManual = /_manual/i.test(filename);
    const isGame = !isConfig && !isManual;
    if (!code) code = extractGameCode(filename);
    attachments.push({ filename, downloadUrl: href, isGame });
  }

  if (attachments.length === 0) throw new Error("첨부 파일을 찾지 못했어");
  if (!code) code = `GAME_${Date.now()}`;
  return { title, code, attachments };
}

// ─── Download ────────────────────────────────────────────────────────────────

async function downloadOne(url: string, dest: string, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      await Bun.write(dest, buf);
      return;
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function downloadAll(attachments: Attachment[], dir: string): Promise<void> {
  const queue = [...attachments];
  const workers: Promise<void>[] = [];
  let done = 0;
  const total = queue.length;

  const worker = async () => {
    while (queue.length > 0) {
      const a = queue.shift();
      if (!a) break;
      process.stderr.write(`  ↓ ${a.filename}\n`);
      await downloadOne(a.downloadUrl, join(dir, a.filename));
      done++;
      process.stderr.write(`  ✓ ${a.filename}  (${done}/${total})\n`);
    }
  };
  for (let i = 0; i < Math.min(CONCURRENT, total); i++) workers.push(worker());
  await Promise.all(workers);
}

// ─── Extract ─────────────────────────────────────────────────────────────────

function run7z(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise(resolve => {
    const p = spawn(SEVENZIP, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (out += d));
    p.on("close", code => resolve({ ok: code === 0, out }));
    p.on("error", () => resolve({ ok: false, out: "spawn failed" }));
  });
}

async function extract(archive: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const r = await run7z(["x", archive, `-o${destDir}`, "-y", `-p${PASSWORD}`]);
  if (!r.ok) throw new Error(`7z 압축해제 실패:\n${r.out}`);
}

// If the extracted dir contains a single subdirectory (and nothing else), flatten it up.
async function flattenSingleSubdir(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const inner = join(dir, entries[0].name);
  const innerEntries = await readdir(inner);
  for (const name of innerEntries) {
    await rename(join(inner, name), join(dir, name));
  }
  await rm(inner, { recursive: true });
}

// Doogie launcher leaves a DosBox/ subfolder + Windows companion tools (VB6 editors, patches,
// preview PNGs) that don't run in MS-DOS. Strip everything that's purely a Windows artifact.
async function removeDoogieMetadata(dir: string): Promise<void> {
  for (const meta of ["DosBox", "DOSBOX", "DOOGIE", "Doogie"]) {
    const p = join(dir, meta);
    if (existsSync(p)) await rm(p, { recursive: true, force: true });
  }
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const u = e.name.toUpperCase();
    const isWindowsLib = u.endsWith(".DLL") || u.endsWith(".OCX");
    const isDoogieTool =
      /EDIT(\.|V?\d)/.test(u) ||           // *EDIT.EXE, EDITV21.EXE, etc.
      /EDITOR\./.test(u) ||                 // DH2_EDITOR.EXE
      /PATCH\./.test(u) ||                  // FD2PATCH.EXE
      /^_OPEN_\d+\.PNG$/.test(u) ||         // launcher preview screenshots
      /^_.*EDIT.*\.(EXE|INI)$/.test(u);     // _FQ4EDIT.EXE, _FQ4EDIT.INI
    if (isWindowsLib || isDoogieTool) {
      await unlink(join(dir, e.name)).catch(() => {});
    }
  }
}

// MS-DOS 8.3 rule: basename ≤8, extension ≤3, only one dot. Truncate a candidate dir name.
function enforce83Dirname(name: string): string {
  return name.slice(0, 8);
}

// Strip _YYMMDD date suffix from doogie codes (e.g. FQ4_240131 → FQ4).
function stripDateSuffix(code: string): string {
  return code.replace(/_\d{6}$/, "");
}

// MS-DOS convention: every filename and dirname should be uppercase (ASCII letters only;
// non-ASCII like Korean glyphs are preserved). macOS uses a case-insensitive filesystem,
// so renames must go through a temporary name. Recursion is depth-first.
function upperAscii(s: string): string {
  return s.replace(/[a-z]/g, c => c.toUpperCase());
}

async function uppercaseRecursive(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const childPath = join(dir, e.name);
    if (e.isDirectory()) await uppercaseRecursive(childPath);
    const upperName = upperAscii(e.name);
    if (upperName !== e.name) {
      const tmpPath = join(dir, `.__upcase_${Date.now()}_${upperName}`);
      await rename(childPath, tmpPath);
      await rename(tmpPath, join(dir, upperName));
    }
  }
}

// ─── Install pipeline ────────────────────────────────────────────────────────

async function install(url: string, customName?: string): Promise<void> {
  process.stderr.write(`📥 페이지 분석: ${url}\n`);
  const info = await parseGamePage(url);
  process.stderr.write(`   제목: ${info.title}\n`);

  const gameFiles = info.attachments.filter(a => a.isGame);
  const otherFiles = info.attachments.filter(a => !a.isGame);
  process.stderr.write(`   첨부: 게임 ${gameFiles.length}개, 설정/매뉴얼 ${otherFiles.length}개 (스킵)\n`);
  if (gameFiles.length === 0) throw new Error("게임 파일이 없어");

  const rawCode = upperAscii(customName || stripDateSuffix(info.code));
  const code = enforce83Dirname(rawCode);
  if (code !== rawCode) {
    process.stderr.write(`   ⚠ 디렉토리 이름 8자 초과 → 잘라냄: ${rawCode} → ${code}\n`);
  }
  await mkdir(GAMES_DIR, { recursive: true });
  const targetDir = join(GAMES_DIR, code);
  if (existsSync(targetDir)) {
    throw new Error(`이미 존재함: ${targetDir} — 다른 이름을 쓰거나 먼저 지워줘`);
  }

  const tmpDir = join(GAMES_DIR, `.tmp-${code}-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    process.stderr.write(`📦 다운로드 → ${tmpDir}\n`);
    await downloadAll(gameFiles, tmpDir);

    const sorted = gameFiles.map(a => a.filename).sort();
    const first =
      sorted.find(f => /\.7z\.001$/i.test(f)) ||
      sorted.find(f => /\.7z$/i.test(f) && !/\.7z\.\d+$/i.test(f));
    if (!first) throw new Error("첫 번째 압축 파일을 못 찾았어");

    process.stderr.write(`📂 압축 해제 → ${targetDir}\n`);
    await extract(join(tmpDir, first), targetDir);
    await flattenSingleSubdir(targetDir);
    await removeDoogieMetadata(targetDir);
    process.stderr.write(`🔤 모든 파일/디렉토리 이름 대문자로 변환 (MS-DOS 규약)\n`);
    await uppercaseRecursive(targetDir);

    process.stderr.write(`🧹 임시 디렉토리 정리\n`);
    await rm(tmpDir, { recursive: true });

    const st = await stat(targetDir);
    process.stderr.write(`✅ 설치 완료: ${targetDir}\n`);
    console.log(JSON.stringify({ ok: true, code, title: info.title, path: targetDir }));
  } catch (e) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

if (cmd === "search") {
  const keyword = args[0];
  if (!keyword) {
    console.error("사용법: bun scripts/install-game.ts search \"<keyword>\"");
    process.exit(1);
  }
  const hits = await search(keyword);
  console.log(JSON.stringify({ keyword, count: hits.length, hits }, null, 2));
} else if (cmd === "install") {
  const url = args[0];
  const name = args[1];
  if (!url || !/^https?:\/\//.test(url)) {
    console.error("사용법: bun scripts/install-game.ts install \"<URL>\" [<dirname>]");
    process.exit(1);
  }
  await install(url, name);
} else {
  console.error(`사용법:
  bun scripts/install-game.ts search "<keyword>"        # JSON 검색 결과
  bun scripts/install-game.ts install "<URL>" [<name>]  # ~/dos/<name 또는 code>에 설치`);
  process.exit(1);
}

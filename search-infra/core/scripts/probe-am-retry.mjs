#!/usr/bin/env node
/** Phase AM 探针复核轮: dictionaryapi(15s 超时复测) / secedgar(状态码细查) / gbooks(429 冷却复测) */
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/phase-am";
mkdirSync(OUT, { recursive: true });
const UA = "search-core/0.9 (+https://github.com/mmqz/search-tool-rnd)";
const UA_SEC = "search-core/0.9 (research; mmqz@users.noreply.github.com)";

async function http(url, { headers = {}, timeoutMs = 12000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    const text = await res.text();
    return { res, text };
  } finally { clearTimeout(timer); }
}

async function dictionaryapi() {
  try {
    const { res, text } = await http("https://api.dictionaryapi.dev/api/v2/entries/en/redis", {
      headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 9000,
    });
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* html */ }
    const e0 = Array.isArray(parsed) ? parsed[0] : null;
    const summary = `status=${res.status} isArray=${Array.isArray(parsed)} word=${e0?.word ?? "?"} pos=${e0?.meanings?.[0]?.partOfSpeech ?? "?"} def0=${(e0?.meanings?.[0]?.definitions?.[0]?.definition ?? text.slice(0, 60)).slice(0, 60)}`;
    await writeFile(`${OUT}/dictionaryapi-retry.json`, text.slice(0, 1500)).catch(() => {});
    console.log(`dictionaryapi  ${summary}`);
  } catch (e) {
    console.log(`dictionaryapi  ERR ${String(e?.message ?? e).slice(0, 100)}`);
  }
}

async function secedgar() {
  try {
    const { res, text } = await http('https://efts.sec.gov/LATEST/search-index?q="annual report"&forms=10-K', {
      headers: { "User-Agent": UA_SEC, Accept: "application/json" }, timeoutMs: 12000,
    });
    const head = text.slice(0, 200).replace(/\n/g, " ");
    let d = null;
    try { d = JSON.parse(text); } catch { /* html */ }
    const hits = d?.hits?.hits ?? [];
    const summary = `status=${res.status} isJson=${!!d} total=${d?.hits?.total?.value ?? "?"} n=${hits.length} id0=${hits[0]?._id ?? "?"} body0=${head.slice(0, 80)}`;
    await writeFile(`${OUT}/secedgar-retry.json`, text.slice(0, 1500)).catch(() => {});
    console.log(`secedgar  ${summary}`);
  } catch (e) {
    console.log(`secedgar  ERR ${String(e?.message ?? e).slice(0, 100)}`);
  }
}

async function gbooks() {
  for (let i = 0; i < 2; i++) {
    try {
      const { res, text } = await http("https://www.googleapis.com/books/v1/volumes?q=rust+programming&maxResults=5&country=US", {
        headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 12000,
      });
      let d = null;
      try { d = JSON.parse(text); } catch { /* html */ }
      const items = d?.items ?? [];
      console.log(`gbooks try${i + 1}  status=${res.status} total=${d?.totalItems ?? "?"} n=${items.length} t0=${(items[0]?.volumeInfo?.title ?? text.slice(0, 60)).slice(0, 60)}`);
      if (res.status === 200 && items.length) {
        await writeFile(`${OUT}/gbooks-retry.json`, JSON.stringify(items.map((x) => ({ title: x.volumeInfo?.title, link: x.volumeInfo?.infoLink })), null, 2)).catch(() => {});
        return;
      }
    } catch (e) {
      console.log(`gbooks try${i + 1}  ERR ${String(e?.message ?? e).slice(0, 100)}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

await dictionaryapi();
await secedgar();
await gbooks();

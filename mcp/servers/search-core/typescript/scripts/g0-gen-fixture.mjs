// G0 基线 (issue #3 评论 G0): 统一生成 Go/TS 两侧共用的密集 HTML 输入。
// 输入形状与 Go 侧 focus_g1_test.go mkDenseHTML 同款: 小标签高频重复 + 短文本 + 制表/双空格。
import { writeFileSync } from "node:fs";

function mkDenseHTML(target) {
  const parts = ["<!doctype html><html><head><title>Dense</title></head><body><article>"];
  let len = parts[0].length;
  let i = 0;
  while (len < target) {
    const s = `<div class="c${i % 97}"><span>x${i}</span> text ${i} with tab\tand  spaces </div>`;
    parts.push(s);
    len += s.length;
    i++;
  }
  parts.push("</article></body></html>");
  return parts.join("");
}

for (const mb of [1, 2]) {
  const html = mkDenseHTML(mb * 1024 * 1024);
  writeFileSync(`/tmp/g0-dense-${mb}mb.html`, html, "utf8");
  console.log(`wrote /tmp/g0-dense-${mb}mb.html (${html.length} bytes)`);
}

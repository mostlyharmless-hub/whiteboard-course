import { readFileSync, writeFileSync } from "node:fs";
import { parseScript } from "../shared/schema";
import { ingest } from "./ingest";
import { emptyBoardIntervals, ensureBoardNotEmpty, remapToTranscript, totalEmptyMs } from "./timeline";

const USAGE = `用法：pnpm timeline --in <script.json> --out <script.json> [--transcript <transcript.json>]

不带 --transcript：对已有脚本套用时间轴后处理（ADR 005）：翻页提前进入静默、每页第一张卡随翻页落笔。
带 --transcript：把脚本映射到该讲解稿的时间轴（段落 id 相同、时间不同，如 pnpm tts --timeline compact 的产物，ADR 006），
  段落文本与时间、小节、duration_ms 全部换成新讲解稿的，再套用 ADR 005。
`;

function main(): number {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const input = get("--in");
  const output = get("--out");
  const transcriptPath = get("--transcript");
  if (!input || !output) throw new Error(`必须提供 --in 与 --out\n${USAGE}`);

  const parsed = parseScript(JSON.parse(readFileSync(input, "utf8")));
  if (!parsed.ok) throw new Error(`输入脚本不合法：${parsed.issues.map((i) => i.message).join("；")}`);
  const before = totalEmptyMs(emptyBoardIntervals(parsed.script.actions, parsed.script.paragraphs));

  let script = parsed.script;
  let changes: string[];
  if (transcriptPath) {
    const transcript = ingest(JSON.parse(readFileSync(transcriptPath, "utf8")) as unknown);
    const r = remapToTranscript(script, transcript.paragraphs);
    script = r.script;
    changes = r.changes;
  } else {
    const r = ensureBoardNotEmpty(script.actions, script.paragraphs);
    script = { ...script, actions: r.actions };
    changes = r.changes;
  }
  const check = parseScript(script);
  if (!check.ok) throw new Error(`修正后脚本不合法：${check.issues.map((i) => i.message).join("；")}`);
  const after = totalEmptyMs(emptyBoardIntervals(script.actions, script.paragraphs));
  writeFileSync(output, `${JSON.stringify(script, null, 2)}\n`);
  for (const c of changes) console.error(`- ${c}`);
  console.error(`有语音但白板为空：${(before / 1000).toFixed(1)} 秒 → ${(after / 1000).toFixed(1)} 秒；时长 ${(script.meta.duration_ms / 1000).toFixed(1)} 秒；已写出 ${output}`);
  return after === 0 ? 0 : 1;
}

try {
  process.exit(main());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadGlossary } from "./glossary";
import { ingest } from "./ingest";
import { createFixtureClient, createLlmClient, withRecording } from "./llm";
import { generate } from "./pipeline";
import { renderReport } from "./report";

const USAGE = `用法：pnpm gen --in <transcript.json> --out <script.json> [--glossary config/glossary.json] [--dry-run] [--fixture <dir>] [--record <dir>]

  --in        讲解稿 JSON（ASR 字幕）
  --out       输出脚本路径；报告写到同名 .report.md
  --glossary  术语表，默认 config/glossary.json
  --dry-run   只打印报告，不写文件
  --fixture   用预录响应目录代替 LLM（离线）
  --record    把每次 LLM 调用的提示词与响应落盘，默认 out/<name>.llm/
`;

interface Args {
  in: string;
  out: string;
  glossary: string;
  dryRun: boolean;
  fixture?: string;
  record?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = { glossary: "config/glossary.json", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${k} 缺少参数值`);
      return v;
    };
    switch (k) {
      case "--in":
        a.in = next();
        break;
      case "--out":
        a.out = next();
        break;
      case "--glossary":
        a.glossary = next();
        break;
      case "--dry-run":
        a.dryRun = true;
        break;
      case "--fixture":
        a.fixture = next();
        break;
      case "--record":
        a.record = next();
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数 ${k}\n${USAGE}`);
    }
  }
  if (!a.in || !a.out) throw new Error(`必须提供 --in 与 --out\n${USAGE}`);
  return a as Args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (existsSync(".env")) process.loadEnvFile(".env");

  const transcript = ingest(JSON.parse(readFileSync(args.in, "utf8")) as unknown);
  const glossary = loadGlossary(args.glossary);
  const name = basename(args.out).replace(/\.script\.json$|\.json$/, "");
  let llm = args.fixture ? createFixtureClient(args.fixture) : createLlmClient(process.env);
  if (!args.fixture) llm = withRecording(llm, args.record ?? join(dirname(args.out), `${name}.llm`));
  console.error(`讲解稿 ${args.in}：${transcript.paragraphs.length} 段，${(transcript.duration_ms / 1000).toFixed(1)} 秒；型号 ${llm.model}`);

  const result = await generate({ transcript, glossary, llm, onProgress: (m) => console.error(m) });
  const report = renderReport(result, { source: args.in, out: args.out });
  const errorCount = result.results.reduce((n, s) => n + s.errors.length, 0) + result.issues.length;

  if (args.dryRun) {
    console.log(report);
  } else {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(result.script, null, 2)}\n`);
    const reportPath = join(dirname(args.out), `${name}.report.md`);
    writeFileSync(reportPath, report);
    console.error(`已写出 ${args.out} 与 ${reportPath}（error ${errorCount}）`);
  }
  return errorCount > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const phrases = {
  angry: ["你认真的吗", "这也能中", "离谱"],
  defiant: ["来啊，继续", "我就不信了", "再来一手"],
  weary: ["太难受了", "这牌怎么玩", "顶不住了"],
  smile: ["漂亮", "好牌", "打得不错"],
  laugh: ["哈哈哈", "笑死我了", "太有意思了"],
  celebrate: ["拿下", "赢麻了", "这把舒服"],
  relief: ["好险", "差一点", "吓我一跳"],
  awkward: ["没事，我很好", "一切尽在掌握", "问题不大"],
  smirk: ["我就知道", "跟不跟", "有点意思"],
  playful: ["逗你玩的", "上当了吧", "开个玩笑"],
  think: ["让我想想", "有点东西", "这牌不简单"],
  cry: ["心态崩了", "还我筹码", "太惨了"],
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repo, "public", "sounds");
const tempDir = mkdtempSync(join(tmpdir(), "ep-emotes-"));
mkdirSync(outDir, { recursive: true });

try {
  for (const [key, lines] of Object.entries(phrases)) {
    for (const [index, text] of lines.entries()) {
      const stem = `emote-${key}-${index + 1}`;
      const source = join(tempDir, `${stem}.aiff`);
      execFileSync("say", ["-v", "Tingting", "-r", "205", "-o", source, text]);
      execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "48000", "-c", "1", source, join(outDir, `${stem}.m4a`)]);
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

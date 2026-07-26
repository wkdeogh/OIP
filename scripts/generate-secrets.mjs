import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

function readHidden(prompt) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      terminal.question(prompt, resolve);
      return;
    }

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    let value = "";

    const onData = (chunk) => {
      const key = chunk.toString("utf8");
      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (key === "\u0003") {
        process.stdin.setRawMode(false);
        terminal.close();
        process.exit(130);
      }
      if (key === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += key;
    };
    process.stdin.on("data", onData);
  });
}

const password = await readHidden("OIP 공통 비밀번호: ");
terminal.close();

if (!password || password.length < 6) {
  console.error("비밀번호는 6자 이상으로 입력해 주세요.");
  process.exit(1);
}

console.log(
  `OIP_PASSWORD_HASH=${createHash("sha256").update(password).digest("hex")}`,
);
console.log(`OIP_SESSION_SECRET=${randomBytes(48).toString("base64url")}`);
console.log("OIP_SESSION_VERSION=1");

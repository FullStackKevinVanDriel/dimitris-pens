/* Hidden-input password prompt for the setup scripts (no deps). */
"use strict";

const readline = require("readline");

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function readNewPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error("No TTY: set ADMIN_PASSWORD in the environment instead.");
  const a = await promptHidden("New admin password (min 12 chars): ");
  const b = await promptHidden("Repeat: ");
  if (a !== b) throw new Error("Passwords don't match.");
  return a;
}

module.exports = { readNewPassword };

// Tiny colored logger

const hasTTY = typeof process !== "undefined" && !!process.stdout && !!process.stdout.isTTY;
const noColorEnv = typeof process !== "undefined" && process.env ? !!process.env.NO_COLOR : false;
const NO_COLOR = !hasTTY || noColorEnv;
const c = (code: string, s: string) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);

export const log = {
  verbose: false,
  info(msg: string) {
    console.log(c("36", "ℹ") + " " + msg);
  },
  step(msg: string) {
    console.log(c("35", "→") + " " + c("1", msg));
  },
  ok(msg: string) {
    console.log(c("32", "✓") + " " + msg);
  },
  warn(msg: string) {
    console.log(c("33", "⚠") + " " + msg);
  },
  error(msg: string) {
    console.error(c("31", "✗") + " " + msg);
  },
  debug(msg: string) {
    if (log.verbose) console.log(c("90", "  " + msg));
  },
  raw(msg: string) {
    console.log(msg);
  },
};
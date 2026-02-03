// CRITICAL
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Throbber {
  update: (message: string) => void;
  stop: (finalMessage: string) => void;
}

export const createThrobber = (): Throbber => {
  let timer: ReturnType<typeof setInterval> | null = null;
  let frame = 0;
  let message = "";

  const render = (): void => {
    if (!process.stdout.isTTY) {
      return;
    }
    const output = `\r${FRAMES[frame % FRAMES.length]} ${message}`;
    process.stdout.write(`${output}\x1b[0K`);
    frame += 1;
  };

  const update = (nextMessage: string): void => {
    message = nextMessage;
    if (!timer && process.stdout.isTTY) {
      timer = setInterval(render, 120);
    }
    render();
  };

  const stop = (finalMessage: string): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${finalMessage}\x1b[0K\n`);
    } else {
      console.log(finalMessage);
    }
  };

  return { update, stop };
};

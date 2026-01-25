export type KeyHandler = (key: string) => void;

const KEY_MAP: Record<string, string> = {
  '\x1b[A': 'up',
  '\x1b[B': 'down',
  '\x1b[C': 'right',
  '\x1b[D': 'left',
  '\r': 'enter',
  '\n': 'enter',
  '\x03': 'ctrl-c',
  '\x1b': 'escape',
};

export function setupInput(onKey: KeyHandler): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    console.error('Error: vllm-studio requires an interactive terminal (TTY)');
    process.exit(1);
  }
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  const handler = (data: string): void => { onKey(KEY_MAP[data] || data); };
  stdin.on('data', handler);

  return () => {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.off('data', handler);
  };
}

export function parseKey(data: string): string {
  return KEY_MAP[data] || data;
}

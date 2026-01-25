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
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  const handler = (data: string) => {
    const key = KEY_MAP[data] || data;
    onKey(key);
  };

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

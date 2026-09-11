export type TableEngineHandle = {
  pause: () => void;
  resume: () => void;
  resize: () => void;
};

export function tableScreenIsVisible(
  table: { classList: { contains: (token: string) => boolean } } | null,
): boolean {
  return Boolean(table && !table.classList.contains("hidden"));
}

export function syncTableEngine(
  tableVisible: boolean,
  engine: TableEngineHandle | null,
  start: () => void,
): void {
  if (!tableVisible) {
    engine?.pause();
    return;
  }
  if (engine) {
    engine.resume();
    engine.resize();
    return;
  }
  start();
}

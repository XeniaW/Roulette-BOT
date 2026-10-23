// Coalesce UI updates without delaying indefinitely or overlapping async reads.
export function coalescedTask(task, delay = 100, onError = console.error) {
  let timer = null;
  let running = false;
  let dirty = false;
  function schedule() {
    dirty = true;
    if (timer !== null || running) return;
    timer = setTimeout(async () => {
      timer = null;
      dirty = false;
      running = true;
      try {
        await task();
      } catch (error) {
        onError(error);
      } finally {
        running = false;
        if (dirty) schedule();
      }
    }, delay);
  }
  return schedule;
}

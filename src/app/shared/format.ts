const UNITS = ['B', 'KB', 'MB', 'GB'];

/** `1536` → `1.5 KB`. */
export function formatBytes(bytes: number): string {
    let value = bytes;
    let unit = 0;

    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit++;
    }

    return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

/** `850` → `850 ms`, `2300` → `2.30 s`. */
export function formatDuration(ms: number): string {
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export const ok = <T>(data: T, meta?: unknown) => ({ success: true, data, ...(meta ? { meta } : {}) });

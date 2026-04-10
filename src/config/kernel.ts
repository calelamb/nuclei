export const KERNEL_PORT = import.meta.env.VITE_KERNEL_PORT ?? 9742;
export const KERNEL_WS_URL = `ws://localhost:${KERNEL_PORT}`;

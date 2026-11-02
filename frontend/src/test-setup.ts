import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver. React Flow (@xyflow/react) mounts
// a ResizeObserver in useEffect, so provide a minimal stub for chart tests.
globalThis.ResizeObserver = class ResizeObserver {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
};

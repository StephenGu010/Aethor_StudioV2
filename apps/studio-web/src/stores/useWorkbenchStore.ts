import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ToolWindowId = 'modelTree' | 'display' | 'diagnostics';

interface ToolWindowState {
  open: boolean;
  x: number;
  y: number;
  maximized: boolean;
}

interface WorkbenchState {
  layoutVersion: 1;
  windows: Record<ToolWindowId, ToolWindowState>;
  showVisual: boolean;
  showCollision: boolean;
  showGrid: boolean;
  showShadows: boolean;
  showLighting: boolean;
  showBaseFrame: boolean;
  showTcpFrame: boolean;
  showJointAxes: boolean;
  toggleWindow: (id: ToolWindowId) => void;
  setWindowPosition: (id: ToolWindowId, x: number, y: number) => void;
  toggleMaximized: (id: ToolWindowId) => void;
  setDisplay: (key: DisplayKey, value: boolean) => void;
  resetLayout: () => void;
}

type DisplayKey =
  | 'showVisual'
  | 'showCollision'
  | 'showGrid'
  | 'showShadows'
  | 'showLighting'
  | 'showBaseFrame'
  | 'showTcpFrame'
  | 'showJointAxes';

const defaultWindows = (): Record<ToolWindowId, ToolWindowState> => ({
  modelTree: { open: false, x: 18, y: 66, maximized: false },
  display: { open: false, x: 340, y: 66, maximized: false },
  diagnostics: { open: false, x: 660, y: 66, maximized: false }
});

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set) => ({
      layoutVersion: 1,
      windows: defaultWindows(),
      showVisual: true,
      showCollision: false,
      showGrid: true,
      showShadows: true,
      showLighting: true,
      showBaseFrame: true,
      showTcpFrame: true,
      showJointAxes: false,
      toggleWindow: (id) =>
        set((state) => ({
          windows: { ...state.windows, [id]: { ...state.windows[id], open: !state.windows[id].open } }
        })),
      setWindowPosition: (id, x, y) =>
        set((state) => ({
          windows: { ...state.windows, [id]: { ...state.windows[id], x, y } }
        })),
      toggleMaximized: (id) =>
        set((state) => ({
          windows: { ...state.windows, [id]: { ...state.windows[id], maximized: !state.windows[id].maximized } }
        })),
      setDisplay: (key, value) => set({ [key]: value } as Pick<WorkbenchState, DisplayKey>),
      resetLayout: () => set({ windows: defaultWindows() })
    }),
    {
      name: 'aethor-studio-v2-workbench',
      version: 1,
      partialize: (state) => ({
        layoutVersion: state.layoutVersion,
        windows: state.windows,
        showVisual: state.showVisual,
        showCollision: state.showCollision,
        showGrid: state.showGrid,
        showShadows: state.showShadows,
        showLighting: state.showLighting,
        showBaseFrame: state.showBaseFrame,
        showTcpFrame: state.showTcpFrame,
        showJointAxes: state.showJointAxes
      })
    }
  )
);

import { Maximize2, Minimize2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { type ToolWindowId, useWorkbenchStore } from '../../stores/useWorkbenchStore';

export function FloatingToolWindow({
  id,
  title,
  children
}: {
  id: ToolWindowId;
  title: string;
  children: React.ReactNode;
}) {
  const state = useWorkbenchStore((store) => store.windows[id]);
  const setPosition = useWorkbenchStore((store) => store.setWindowPosition);
  const toggleMaximized = useWorkbenchStore((store) => store.toggleMaximized);
  const toggleWindow = useWorkbenchStore((store) => store.toggleWindow);
  const windowRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  if (!state.open) return null;

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (state.maximized || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const panel = windowRef.current;
    const stage = panel?.closest<HTMLElement>('.sceneStage');
    if (!panel || !stage) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = state.x;
    const originY = state.y;
    const stageRect = stage.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    const move = (pointerEvent: PointerEvent) => {
      const maximumX = Math.max(8, stageRect.width - panelRect.width - 8);
      const maximumY = Math.max(54, stageRect.height - 84);
      setPosition(
        id,
        clamp(originX + pointerEvent.clientX - startX, 8, maximumX),
        clamp(originY + pointerEvent.clientY - startY, 54, maximumY)
      );
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (dragCleanupRef.current === finish) dragCleanupRef.current = null;
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  return (
    <div
      ref={windowRef}
      className={state.maximized ? 'toolWindow maximized' : 'toolWindow'}
      style={state.maximized ? undefined : { transform: `translate(${state.x}px, ${state.y}px)` }}
      role="dialog"
      aria-label={title}
    >
      <div className="toolWindowHeader" onPointerDown={beginDrag}>
        <strong>{title}</strong>
        <div>
          <button type="button" onClick={() => toggleMaximized(id)} aria-label={state.maximized ? `恢复${title}` : `纵向最大化${title}`}>
            {state.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" onClick={() => toggleWindow(id)} aria-label={`关闭${title}`}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="toolWindowBody">{children}</div>
    </div>
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

import { useEffect } from 'react';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../stores/useRobotSessionStore';
import { robotGateway } from './gatewayInstance';
import { emitOperationProbe } from './operationProbe';
import type { RobotGatewayV1 } from './robotGateway';

const DEFAULT_TELEMETRY_STALL_THRESHOLD_MS = 1_500;
const DEFAULT_TELEMETRY_FALLBACK_INTERVAL_MS = 1_000;
const INITIAL_AUTHORITY_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;
const TELEMETRY_FALLBACK_WARNING = '实时关节事件已停滞；当前以 REST 权威快照降级刷新';

export function GatewaySessionCoordinator({
  gateway = robotGateway,
  telemetryStallThresholdMs = DEFAULT_TELEMETRY_STALL_THRESHOLD_MS,
  telemetryFallbackIntervalMs = DEFAULT_TELEMETRY_FALLBACK_INTERVAL_MS
}: {
  gateway?: RobotGatewayV1;
  telemetryStallThresholdMs?: number;
  telemetryFallbackIntervalMs?: number;
}) {
  const resetRuntime = useGatewayRuntimeStore((state) => state.resetRuntime);
  const setCapabilities = useGatewayRuntimeStore((state) => state.setCapabilities);
  const setSession = useGatewayRuntimeStore((state) => state.setSession);
  const setJointState = useGatewayRuntimeStore((state) => state.setJointState);
  const replaceProtocolFrames = useGatewayRuntimeStore((state) => state.replaceProtocolFrames);
  const appendProtocolFrame = useGatewayRuntimeStore((state) => state.appendProtocolFrame);
  const beginCommandAuditRefresh = useGatewayRuntimeStore((state) => state.beginCommandAuditRefresh);
  const failCommandAuditRefresh = useGatewayRuntimeStore((state) => state.failCommandAuditRefresh);
  const replaceCommandHistory = useGatewayRuntimeStore((state) => state.replaceCommandHistory);
  const replaceDirectCommandHistory = useGatewayRuntimeStore((state) => state.replaceDirectCommandHistory);
  const upsertDirectCommandResult = useGatewayRuntimeStore((state) => state.upsertDirectCommandResult);
  const setActionProgramRun = useGatewayRuntimeStore((state) => state.setActionProgramRun);
  const setLastCommandResult = useGatewayRuntimeStore((state) => state.setLastCommandResult);
  const setTransportWarning = useGatewayRuntimeStore((state) => state.setTransportWarning);
  const markTelemetryDegraded = useGatewayRuntimeStore((state) => state.markTelemetryDegraded);

  useEffect(() => {
    if (!gateway.capabilities.readOnlyConnection) {
      resetRuntime();
      return;
    }

    let active = true;
    let telemetryTrusted = false;
    let observedSessionId = useGatewayRuntimeStore.getState().session.sessionId;
    let auditRefreshSequence = 0;
    let directRefreshSequence = 0;
    let authorityRefreshSequence = 0;
    let authorityRecoveryInFlight: Promise<void> | null = null;
    let authorityRecoveryRequested = false;
    let lastLiveJointEventAtMs = Date.now();
    let telemetryFallbackActive = false;
    let telemetryFallbackOperationId: string | null = null;
    let telemetryFallbackStartedAtMs = 0;
    let fallbackRefreshInFlight: Promise<void> | null = null;
    let nextFallbackRefreshAtMs = 0;
    let freshnessTimer: ReturnType<typeof window.setInterval> | undefined;
    let initialAuthorityRetryTimer: ReturnType<typeof window.setTimeout> | undefined;
    let wakeInitialAuthorityRetry: (() => void) | undefined;
    let closeTelemetry: (() => Promise<void>) | undefined;

    const clearTelemetryFallback = () => {
      telemetryFallbackActive = false;
      telemetryFallbackOperationId = null;
      telemetryFallbackStartedAtMs = 0;
      nextFallbackRefreshAtMs = 0;
    };
    const acceptSession = (value: Parameters<typeof setSession>[0]) => {
      const accepted = !telemetryTrusted && value.source === 'measured' && value.validity === 'valid'
        ? { ...value, validity: 'stale' as const }
        : value;
      const identityChanged = accepted.sessionId !== observedSessionId;
      if (identityChanged) {
        observedSessionId = accepted.sessionId;
        if (accepted.connectionState !== 'offline' && accepted.connectionState !== 'faulted') {
          useRobotSessionStore.getState().beginHardwareSession(accepted.sessionId);
        } else if (accepted.connectionState === 'offline') {
          useRobotSessionStore.getState().resetSession();
        } else {
          useRobotSessionStore.getState().endHardwareSession();
        }
      }
      setSession(accepted);
      if (accepted.connectionState === 'offline' || accepted.connectionState === 'faulted') {
        clearTelemetryFallback();
        setTransportWarning(null);
      }
      return identityChanged;
    };
    const acceptJointState = (value: Parameters<typeof setJointState>[0]) => {
      const accepted = !telemetryTrusted && value.source === 'measured' && value.validity === 'valid'
        ? { ...value, validity: 'stale' as const }
        : value;
      setJointState(accepted);
      if (accepted.source === 'measured' && accepted.validity === 'valid'
        && useGatewayRuntimeStore.getState().session.connectionState === 'connected') {
        useRobotSessionStore.getState().alignTargetFromMeasured(observedSessionId, accepted.positionsDeg);
      }
    };
    const degradeTelemetry = (message: string) => {
      telemetryTrusted = false;
      authorityRefreshSequence += 1;
      markTelemetryDegraded(message);
    };
    const refreshCommandHistory = async () => {
      const refreshSequence = ++auditRefreshSequence;
      beginCommandAuditRefresh();
      try {
        const history = await gateway.getCommandHistory();
        if (active && refreshSequence === auditRefreshSequence) {
          replaceCommandHistory(history);
        }
      } catch (error) {
        if (active && refreshSequence === auditRefreshSequence) {
          failCommandAuditRefresh(error instanceof Error ? error.message : '命令审计恢复失败');
        }
      }
    };
    const refreshDirectCommandHistory = async () => {
      const refreshSequence = ++directRefreshSequence;
      try {
        const history = await gateway.getDirectCommandHistory();
        if (active && refreshSequence === directRefreshSequence) {
          replaceDirectCommandHistory(history);
        }
      } catch {
        // Direct history is diagnostic; session authority recovery remains independent.
      }
    };
    const refreshAuthority = async () => {
      const refreshSequence = ++authorityRefreshSequence;
      try {
        const [capabilities, session, jointState, protocolFrames, directCommandHistory, actionProgramRun] = await Promise.all([
          gateway.getCapabilities(),
          gateway.getSession(),
          gateway.getJointState(),
          gateway.getProtocolFrames(),
          gateway.getDirectCommandHistory(),
          gateway.getActionProgramRun()
        ]);
        if (!active || refreshSequence !== authorityRefreshSequence) return false;
        telemetryTrusted = true;
        setCapabilities(capabilities);
        acceptSession(session);
        acceptJointState(jointState);
        replaceProtocolFrames(protocolFrames);
        replaceDirectCommandHistory(directCommandHistory);
        setActionProgramRun(actionProgramRun);
        setTransportWarning(telemetryFallbackActive ? TELEMETRY_FALLBACK_WARNING : null);
        return true;
      } catch (error) {
        if (active && refreshSequence === authorityRefreshSequence) {
          degradeTelemetry(error instanceof Error ? error.message : '机器人网关不可用');
        }
        return false;
      }
    };
    const recoverAuthority = () => {
      authorityRecoveryRequested = true;
      if (authorityRecoveryInFlight) return;
      const recovery = (async () => {
        while (active && authorityRecoveryRequested) {
          authorityRecoveryRequested = false;
          if (await refreshAuthority()) void refreshCommandHistory();
        }
      })();
      authorityRecoveryInFlight = recovery;
      void recovery.finally(() => {
        authorityRecoveryInFlight = null;
        if (active && authorityRecoveryRequested) recoverAuthority();
      });
    };
    const refreshFallbackSnapshot = () => {
      if (fallbackRefreshInFlight) return;
      const refresh = (async () => {
        try {
          const [session, jointState] = await Promise.all([
            gateway.getSession(),
            gateway.getJointState()
          ]);
          if (!active || !telemetryFallbackActive) return;
          telemetryTrusted = true;
          acceptSession(session);
          acceptJointState(jointState);
          if (telemetryFallbackActive) setTransportWarning(TELEMETRY_FALLBACK_WARNING);
        } catch (error) {
          if (active && telemetryFallbackActive) {
            degradeTelemetry(error instanceof Error ? error.message : '实时事件停滞，REST 快照恢复失败');
          }
        }
      })();
      fallbackRefreshInFlight = refresh;
      void refresh.finally(() => {
        if (fallbackRefreshInFlight === refresh) fallbackRefreshInFlight = null;
      });
    };
    const enterTelemetryFallback = (message: string, failureCategory: string) => {
      const nowMs = Date.now();
      if (!telemetryFallbackActive) {
        telemetryFallbackActive = true;
        telemetryFallbackOperationId = crypto.randomUUID();
        telemetryFallbackStartedAtMs = nowMs;
        nextFallbackRefreshAtMs = 0;
        emitOperationProbe({
          eventId: 'telemetry.freshness.stalled',
          operationId: telemetryFallbackOperationId,
          outcome: 'failed',
          durationMs: Math.max(0, nowMs - lastLiveJointEventAtMs),
          failureCategory
        });
      }
      degradeTelemetry(message);
    };
    const beginFreshnessWatchdog = () => {
      if (freshnessTimer !== undefined) return;
      const checkIntervalMs = Math.max(10, Math.min(500, telemetryStallThresholdMs / 2));
      freshnessTimer = window.setInterval(() => {
        if (!active) return;
        const runtime = useGatewayRuntimeStore.getState();
        if (runtime.session.connectionState !== 'connected'
          || runtime.jointState.source !== 'measured') {
          lastLiveJointEventAtMs = Date.now();
          return;
        }

        const nowMs = Date.now();
        if (!telemetryFallbackActive
          && nowMs - lastLiveJointEventAtMs >= telemetryStallThresholdMs) {
          enterTelemetryFallback('实时关节事件超过新鲜度窗口；正在切换到 REST 快照刷新', 'timeout');
        }

        if (telemetryFallbackActive && nowMs >= nextFallbackRefreshAtMs) {
          nextFallbackRefreshAtMs = nowMs + telemetryFallbackIntervalMs;
          refreshFallbackSnapshot();
        }
      }, checkIntervalMs);
    };
    const waitForInitialAuthorityRetry = (attempt: number) => new Promise<void>((resolve) => {
      const delay = INITIAL_AUTHORITY_RETRY_DELAYS_MS[
        Math.min(attempt, INITIAL_AUTHORITY_RETRY_DELAYS_MS.length - 1)
      ];
      wakeInitialAuthorityRetry = resolve;
      initialAuthorityRetryTimer = window.setTimeout(() => {
        initialAuthorityRetryTimer = undefined;
        wakeInitialAuthorityRetry = undefined;
        resolve();
      }, delay);
    });
    const start = async () => {
      let initialAuthorityAttempt = 0;
      while (active && !await refreshAuthority()) {
        await waitForInitialAuthorityRetry(initialAuthorityAttempt);
        initialAuthorityAttempt += 1;
      }
      if (!active) return;

      void refreshCommandHistory();

      try {
        const close = await gateway.openTelemetry({
          onSession: (value) => {
            if (!active) return;
            if (acceptSession(value)) {
              void refreshCommandHistory();
              void refreshDirectCommandHistory();
            }
          },
          onJointState: (value) => {
            if (!active) return;
            lastLiveJointEventAtMs = Date.now();
            telemetryTrusted = true;
            if (telemetryFallbackActive) {
              setTransportWarning(null);
              if (telemetryFallbackOperationId) {
                emitOperationProbe({
                  eventId: 'telemetry.freshness.recovered',
                  operationId: telemetryFallbackOperationId,
                  outcome: 'completed',
                  durationMs: Date.now() - telemetryFallbackStartedAtMs
                });
              }
              clearTelemetryFallback();
            }
            acceptJointState(value);
          },
          onProtocolFrame: (value) => active && appendProtocolFrame(value),
          onCommandResult: (value) => {
            if (!active) return;
            setLastCommandResult(value);
            void refreshCommandHistory();
          },
          onDirectCommandResult: (value) => {
            if (active) upsertDirectCommandResult(value);
          },
          onActionProgramRun: (value) => {
            if (active) setActionProgramRun(value);
          },
          onTransportError: (incident) => {
            if (!active) return;
            enterTelemetryFallback(
              incident.message,
              incident.kind === 'contractViolation' ? 'validation' : 'transport');
            if (incident.kind === 'contractViolation') recoverAuthority();
          },
          onTransportRecovered: () => {
            if (active) recoverAuthority();
          }
        });
        if (active) {
          closeTelemetry = close;
          lastLiveJointEventAtMs = Date.now();
          beginFreshnessWatchdog();
        }
        else await close();
      } catch (error) {
        if (active) {
          beginFreshnessWatchdog();
          enterTelemetryFallback(
            error instanceof Error ? error.message : '实时遥测不可用；正在使用 REST 快照刷新',
            'transport');
          refreshFallbackSnapshot();
        }
      }
    };

    void start();
    return () => {
      active = false;
      if (freshnessTimer !== undefined) window.clearInterval(freshnessTimer);
      if (initialAuthorityRetryTimer !== undefined) window.clearTimeout(initialAuthorityRetryTimer);
      wakeInitialAuthorityRetry?.();
      if (closeTelemetry) void closeTelemetry();
    };
  }, [appendProtocolFrame, beginCommandAuditRefresh, failCommandAuditRefresh, gateway, markTelemetryDegraded, replaceCommandHistory, replaceDirectCommandHistory, replaceProtocolFrames, resetRuntime, setActionProgramRun, setCapabilities, setJointState, setLastCommandResult, setSession, setTransportWarning, telemetryFallbackIntervalMs, telemetryStallThresholdMs, upsertDirectCommandResult]);

  return null;
}

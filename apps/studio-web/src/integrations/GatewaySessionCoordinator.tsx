import { useEffect } from 'react';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../stores/useRobotSessionStore';
import { robotGateway } from './gatewayInstance';
import type { RobotGatewayV1 } from './robotGateway';

export function GatewaySessionCoordinator({ gateway = robotGateway }: { gateway?: RobotGatewayV1 }) {
  const resetRuntime = useGatewayRuntimeStore((state) => state.resetRuntime);
  const setCapabilities = useGatewayRuntimeStore((state) => state.setCapabilities);
  const setSession = useGatewayRuntimeStore((state) => state.setSession);
  const setJointState = useGatewayRuntimeStore((state) => state.setJointState);
  const replaceProtocolFrames = useGatewayRuntimeStore((state) => state.replaceProtocolFrames);
  const appendProtocolFrame = useGatewayRuntimeStore((state) => state.appendProtocolFrame);
  const beginCommandAuditRefresh = useGatewayRuntimeStore((state) => state.beginCommandAuditRefresh);
  const failCommandAuditRefresh = useGatewayRuntimeStore((state) => state.failCommandAuditRefresh);
  const replaceCommandHistory = useGatewayRuntimeStore((state) => state.replaceCommandHistory);
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
    let authorityRefreshSequence = 0;
    let authorityRecoveryInFlight: Promise<void> | null = null;
    let authorityRecoveryRequested = false;
    let closeTelemetry: (() => Promise<void>) | undefined;

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
    const refreshAuthority = async () => {
      const refreshSequence = ++authorityRefreshSequence;
      try {
        const [capabilities, session, jointState, protocolFrames] = await Promise.all([
          gateway.getCapabilities(),
          gateway.getSession(),
          gateway.getJointState(),
          gateway.getProtocolFrames()
        ]);
        if (!active || refreshSequence !== authorityRefreshSequence) return false;
        telemetryTrusted = true;
        setCapabilities(capabilities);
        acceptSession(session);
        acceptJointState(jointState);
        replaceProtocolFrames(protocolFrames);
        setTransportWarning(null);
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
    const start = async () => {
      if (!await refreshAuthority()) return;

      void refreshCommandHistory();

      try {
        const close = await gateway.openTelemetry({
          onSession: (value) => {
            if (!active) return;
            if (acceptSession(value)) void refreshCommandHistory();
          },
          onJointState: (value) => {
            if (active) acceptJointState(value);
          },
          onProtocolFrame: (value) => active && appendProtocolFrame(value),
          onCommandResult: (value) => {
            if (!active) return;
            setLastCommandResult(value);
            void refreshCommandHistory();
          },
          onTransportError: (incident) => {
            if (!active) return;
            degradeTelemetry(incident.message);
            if (incident.kind === 'contractViolation') recoverAuthority();
          },
          onTransportRecovered: () => {
            if (active) recoverAuthority();
          }
        });
        if (active) closeTelemetry = close;
        else await close();
      } catch (error) {
        if (active) degradeTelemetry(error instanceof Error ? error.message : '实时遥测不可用；REST 快照仍可手动刷新');
      }
    };

    void start();
    return () => {
      active = false;
      if (closeTelemetry) void closeTelemetry();
    };
  }, [appendProtocolFrame, beginCommandAuditRefresh, failCommandAuditRefresh, gateway, markTelemetryDegraded, replaceCommandHistory, replaceProtocolFrames, resetRuntime, setCapabilities, setJointState, setLastCommandResult, setSession, setTransportWarning]);

  return null;
}

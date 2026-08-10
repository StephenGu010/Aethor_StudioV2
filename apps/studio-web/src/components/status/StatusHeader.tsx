import * as Select from '@radix-ui/react-select';
import { ChevronDown, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { RouteMeta } from '../../app/routeMeta';
import { runGatewayCommandLifecycle } from '../../integrations/GatewayCommandLifecycle';
import { robotGateway } from '../../integrations/gatewayInstance';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import {
  getRobotProfileOption,
  isRobotProfileId,
  robotProfileOptions
} from '../../profile/profileCatalog';
import { isActionProgramDirty, useActionProgramStore } from '../../stores/useActionProgramStore';
import {
  getRobotProfileSwitchBlockReason,
  useActiveRobotProfileStore
} from '../../stores/useActiveRobotProfileStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { Hint } from '../ui/Hint';
import { SerialSessionControl } from './SerialSessionControl';

export function StatusHeader({ route, gateway = robotGateway }: { route: RouteMeta; gateway?: RobotGatewayV1 }) {
  const session = useGatewayRuntimeStore((state) => state.session);
  const jointState = useGatewayRuntimeStore((state) => state.jointState);
  const capabilities = useGatewayRuntimeStore((state) => state.capabilities);
  const setTransportWarning = useGatewayRuntimeStore((state) => state.setTransportWarning);
  const activeProfileId = useActiveRobotProfileStore((state) => state.activeProfileId);
  const switchProfile = useActiveRobotProfileStore((state) => state.switchProfile);
  const actionDraft = useActionProgramStore((state) => state.draft);
  const savedActionProgram = useActionProgramStore((state) => state.draft
    ? state.programs[state.draft.programId]
    : undefined);
  const [stopping, setStopping] = useState(false);
  const [profileSwitchNotice, setProfileSwitchNotice] = useState<string | null>(null);
  const isAethorActive = activeProfileId === aethorRoboProfile.profileId;
  const activeProfile = getRobotProfileOption(activeProfileId).profile;
  const stopCapabilityAvailable = !isAethorActive
    && capabilities?.hardwareCommands === true
    && capabilities.commandPolicy !== 'disabled'
    && capabilities.supportedCommands.includes('stopAndDisable');
  const stopAvailable = stopCapabilityAvailable && session.connectionState === 'connected';

  const stopAndDisable = async () => {
    if (!stopAvailable || stopping) return;
    setStopping(true);
    try {
      const commandId = crypto.randomUUID();
      const intent = {
        commandId,
        sessionId: session.sessionId,
        commandKind: 'stopAndDisable' as const
      };
      const outcome = await runGatewayCommandLifecycle({
        gateway,
        intent,
        operationLabel: '停止并去使能',
        execute: () => gateway.stopAndDisable({
          commandId,
          sessionId: session.sessionId,
          profileId: dummyProfile.profileId
        })
      });
      const warning = outcome.transportError
        ? `${outcome.result.message}；请立即使用物理急停并检查设备状态。`
        : outcome.snapshotError ?? outcome.auditError
          ?? (outcome.result.status === 'completed' ? null : outcome.result.message);
      if (warning) setTransportWarning(warning);
    } finally {
      setStopping(false);
    }
  };

  const feedbackValue = isAethorActive
    ? 'NO DATA'
    : jointState.source === 'measured'
    ? jointState.validity.toUpperCase()
    : jointState.source === 'showcase'
      ? 'SHOWCASE'
      : 'UNAVAILABLE';

  const changeProfile = (value: string) => {
    if (!isRobotProfileId(value) || value === activeProfileId) return;
    const actionDraftDirty = isActionProgramDirty(actionDraft, savedActionProgram);
    if (actionDraftDirty && activeProfileId === dummyProfile.profileId
      && !window.confirm('Dummy 动作草稿尚未保存。切换后草稿会保留，但动作工作区将暂时不可用。确认切换？')) {
      return;
    }
    const result = switchProfile(value);
    setProfileSwitchNotice(result.reason ?? (result.switched ? `已切换到 ${getRobotProfileOption(value).profile.displayName}` : null));
  };

  return (
    <header className="statusHeader">
      <div className="pageIdentity">
        <h1>{route.title}</h1>
        <span>{route.subtitle}</span>
      </div>
      <Select.Root value={activeProfileId} onValueChange={changeProfile}>
        <Select.Trigger className="deviceSelector" aria-label="当前机器人配置" title={profileSwitchNotice ?? activeProfile.displayName}>
          <span>
            <small>Current profile</small>
            <strong title={activeProfile.displayName}><Select.Value aria-label={activeProfile.displayName}>{activeProfile.displayName}</Select.Value></strong>
          </span>
          <Select.Icon><ChevronDown size={15} /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="profileSelectContent" position="popper" sideOffset={7} align="start">
            <Select.Viewport>
              <div className="profileSelectHeading">选择控制对象<span>One active session</span></div>
              {robotProfileOptions.map((option) => {
                const optionProfileId = option.profile.profileId;
                const blockedReason = getRobotProfileSwitchBlockReason(activeProfileId, optionProfileId);
                return (
                  <Select.Item
                    className="profileSelectItem"
                    value={optionProfileId}
                    disabled={Boolean(blockedReason)}
                    key={optionProfileId}
                    title={blockedReason ?? undefined}
                  >
                    <span className="profileOptionMonogram">{optionProfileId === dummyProfile.profileId ? 'D6' : 'A14'}</span>
                    <Select.ItemText>
                      <span className="profileOptionCopy">
                        <strong>{option.profile.displayName}</strong>
                        <small>{option.summary}</small>
                      </span>
                    </Select.ItemText>
                    <span className={option.hardwareReady ? 'profileOptionState ready' : 'profileOptionState pending'}>
                      {blockedReason ? 'Disconnect first' : option.availability}
                    </span>
                    <Select.ItemIndicator className="profileOptionIndicator">Active</Select.ItemIndicator>
                  </Select.Item>
                );
              })}
              <div className="profileSelectSafety" role="status" aria-live="polite">
                {profileSwitchNotice ?? '切换会重置关节目标草稿；硬件会话必须先安全断开。'}
              </div>
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      <SerialSessionControl gateway={gateway} enabled={!isAethorActive} />
      <div className="headerTelemetry">
        <StatusMetric
          label="MOTOR"
          value={isAethorActive ? 'N/A' : session.motorState.toUpperCase()}
          tone={isAethorActive || session.validity !== 'valid' ? 'muted' : session.motorState === 'enabled' ? 'warning' : session.motorState === 'disabled' ? 'ok' : 'muted'}
          detail={isAethorActive ? 'Aethor_robo 电机状态接口尚未定义' : undefined}
        />
        <StatusMetric
          label="FEEDBACK"
          value={feedbackValue}
          tone={isAethorActive ? 'warning' : jointState.validity === 'valid' ? 'ok' : jointState.source === 'showcase' ? 'warning' : 'muted'}
          detail={isAethorActive ? 'Aethor_robo 当前没有硬件反馈数据，仅显示本地模型预览' : undefined}
        />
        <StatusMetric label="MODE" value={isAethorActive || session.controlMode === null ? 'N/A' : String(session.controlMode)} tone={isAethorActive || session.validity !== 'valid' || session.controlMode === null ? 'muted' : 'ok'} />
      </div>
      <Hint content={isAethorActive
        ? 'Aethor_robo 固件和协议尚未完成，控制台没有任何硬件发送路径。'
        : stopAvailable
          ? '执行 STOP → ZERO CURRENT → DISABLE，并以 #GETENABLE=0 作为成功证据；不能替代物理急停。'
          : stopCapabilityAvailable
            ? '请先连接 Dummy；连接后软件停止链可用，但不能替代物理急停。'
            : '当前网关未声明停止链能力；请使用物理急停。'}>
        <button className="emergencyButton" type="button" disabled={!stopAvailable || stopping} aria-busy={stopping} onClick={() => void stopAndDisable()}>
          <ShieldAlert size={16} />
          {stopping ? '停止中…' : '软件急停'}
        </button>
      </Hint>
    </header>
  );
}

function StatusMetric({
  label,
  value,
  tone,
  detail
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warning' | 'muted';
  detail?: string | undefined;
}) {
  return (
    <div className="statusMetric" title={detail}>
      <span className={`statusDot ${tone}`} />
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

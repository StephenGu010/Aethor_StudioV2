import { ArrowRight, CircleAlert } from 'lucide-react';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import type { RobotProfileId } from '../../profile/profileCatalog';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';

export function ProfileWorkspaceGate({
  supportedProfileId,
  workspaceName,
  children
}: {
  supportedProfileId: RobotProfileId;
  workspaceName: string;
  children: React.ReactNode;
}) {
  const activeProfileId = useActiveRobotProfileStore((state) => state.activeProfileId);
  const switchProfile = useActiveRobotProfileStore((state) => state.switchProfile);
  if (activeProfileId === supportedProfileId) return children;

  const activeName = activeProfileId === aethorRoboProfile.profileId ? aethorRoboProfile.displayName : dummyProfile.displayName;
  const supportedName = supportedProfileId === dummyProfile.profileId ? dummyProfile.displayName : aethorRoboProfile.displayName;
  return (
    <div className="profileWorkspaceUnavailable" role="status">
      <div className="profileUnavailableMark"><CircleAlert size={20} /></div>
      <span>Profile capability boundary</span>
      <h2>{workspaceName}尚未支持 {activeName}</h2>
      <p>
        当前工作区只实现了 {supportedName} 的可信数据与协议语义。系统不会用另一台机器人的展示数据、串口状态或命令能力填充此页面。
      </p>
      <dl>
        <div><dt>Current profile</dt><dd>{activeName}</dd></div>
        <div><dt>Required profile</dt><dd>{supportedName}</dd></div>
        <div><dt>Hardware path</dt><dd>Not shared</dd></div>
      </dl>
      <button type="button" onClick={() => switchProfile(supportedProfileId)}>
        切换到 {supportedName}<ArrowRight size={15} />
      </button>
    </div>
  );
}

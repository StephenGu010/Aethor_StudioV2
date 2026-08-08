import { Braces, CircleAlert, FileJson2, ListChecks, Play, Plus, ShieldAlert } from 'lucide-react';
import { Hint } from '../../components/ui/Hint';

const plannedWorkflow = [
  ['01', '编辑点位', '六轴关节目标、名称与说明'],
  ['02', '离线校验', 'Schema、限位与设备 Profile 一致性'],
  ['03', '受控执行', '逐点确认、取消和故障恢复']
] as const;

export function ActionProgrammingPage() {
  return (
    <div className="workspacePage actionPage">
      <section className="actionWorkbench panelSurface">
        <div className="actionToolbar">
          <div>
            <span>ACTION DOCUMENT</span>
            <h2>动作序列</h2>
          </div>
          <div className="plannedPill"><CircleAlert size={14} /> PHASE 6 PLANNED</div>
        </div>
        <div className="actionEmptyState">
          <div className="actionEmptyIcon"><ListChecks size={28} /></div>
          <span>LOCAL DRAFT WORKSPACE</span>
          <h2>尚未创建动作程序</h2>
          <p>本入口用于稳定产品信息架构。版本化 JSON、点位编辑、采集和执行器将在阶段 6 实现；当前不会保存动作，也不会产生硬件命令。</p>
          <div className="actionEmptyActions">
            <Hint content="动作编辑器属于阶段 6，当前尚未实现">
              <button type="button" disabled><Plus size={15} />新建动作程序</button>
            </Hint>
            <Hint content="动作 JSON Schema 属于阶段 6，当前尚未实现">
              <button type="button" disabled><FileJson2 size={15} />导入动作 JSON</button>
            </Hint>
          </div>
        </div>
        <div className="actionStatusBar">
          <span><span className="statusDot muted" /> DOCUMENT EMPTY</span>
          <span><Braces size={13} /> SCHEMA NOT AVAILABLE</span>
          <span>SHOWCASE DATA / SERIAL OFFLINE</span>
        </div>
      </section>

      <aside className="actionInspector panelSurface">
        <div className="cardHeading">
          <div><span>DELIVERY BOUNDARY</span><h2>编排流程</h2></div>
          <ShieldAlert size={18} />
        </div>
        <div className="actionWorkflow">
          {plannedWorkflow.map(([step, title, detail]) => (
            <div className="actionWorkflowStep" key={step}>
              <span>{step}</span>
              <div><strong>{title}</strong><small>{detail}</small></div>
            </div>
          ))}
        </div>
        <div className="actionSafetyNotice">
          <ShieldAlert size={16} />
          <div><strong>NO EXECUTION PATH</strong><span>动作“暂停”不得伪装成固件队列暂停；未来执行必须逐点确认。</span></div>
        </div>
        <div className="actionPrimaryArea">
          <Hint content="SERIAL OFFLINE · 动作执行器尚未实现">
            <button type="button" disabled><Play size={15} />运行程序</button>
          </Hint>
          <small>需要阶段 4–6 的网关、安全控制与动作契约</small>
        </div>
      </aside>
    </div>
  );
}

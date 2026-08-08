import { z } from 'zod';
import type { RobotProfileManifestV1 } from '../contracts/types';

const safeRelativePath = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !value.includes('..'), '路径不能包含 ..')
  .refine((value) => !/^[a-zA-Z]:/.test(value), '路径不能是盘符绝对路径')
  .refine((value) => !value.startsWith('/') && !value.startsWith('\\'), '路径必须相对配置包')
  .refine((value) => !value.includes('://'), '路径不能引用外部 URL');

const jointSchema = z.object({
  jointId: z.string().regex(/^j[1-9][0-9]*$/),
  displayName: z.string().min(1).max(24),
  urdfJointName: z.string().min(1).max(80),
  protocolIndex: z.number().int().min(0).max(31),
  lowerDeg: z.number().min(-3600).max(3600),
  upperDeg: z.number().min(-3600).max(3600)
});

export const robotProfileSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    profileId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    displayName: z.string().min(1).max(80),
    description: z.string().max(240).optional(),
    protocolAdapterId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    transportDefaults: z
      .object({
        baudRate: z.number().int().min(1200).max(4_000_000),
        lineEnding: z.enum(['LF', 'CRLF'])
      })
      .optional(),
    model: z.object({
      dof: z.number().int().min(1).max(32),
      urdfPath: safeRelativePath,
      upAxis: z.enum(['X', 'Y', 'Z']),
      lengthUnit: z.literal('m'),
      showcasePoseDeg: z.array(z.number()).min(1).max(32).optional()
    }),
    joints: z.array(jointSchema).min(1).max(32),
    capabilities: z.record(z.string(), z.boolean()),
    source: z.object({
      urdfSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
      license: z.string().min(1).max(80),
      protocolReference: z.string().min(1).max(160)
    })
  })
  .superRefine((profile, context) => {
    if (profile.joints.length !== profile.model.dof) {
      context.addIssue({ code: 'custom', path: ['joints'], message: '关节数量必须等于模型 DOF' });
    }
    if (profile.model.showcasePoseDeg && profile.model.showcasePoseDeg.length !== profile.model.dof) {
      context.addIssue({ code: 'custom', path: ['model', 'showcasePoseDeg'], message: '展示位数量必须等于模型 DOF' });
    }
    const stableIds = new Set<string>();
    const urdfNames = new Set<string>();
    const indexes = new Set<number>();
    profile.joints.forEach((joint, index) => {
      if (joint.lowerDeg >= joint.upperDeg) {
        context.addIssue({ code: 'custom', path: ['joints', index], message: '关节下限必须小于上限' });
      }
      for (const [value, set, label] of [
        [joint.jointId, stableIds, 'jointId'],
        [joint.urdfJointName, urdfNames, 'urdfJointName']
      ] as const) {
        if (set.has(value)) {
          context.addIssue({ code: 'custom', path: ['joints', index, label], message: `${label} 不能重复` });
        }
        set.add(value);
      }
      if (indexes.has(joint.protocolIndex)) {
        context.addIssue({ code: 'custom', path: ['joints', index, 'protocolIndex'], message: 'protocolIndex 不能重复' });
      }
      indexes.add(joint.protocolIndex);
    });
  });

export function parseRobotProfile(input: unknown): RobotProfileManifestV1 {
  return robotProfileSchema.parse(input) as RobotProfileManifestV1;
}

export function isPositionWithinLimits(profile: RobotProfileManifestV1, positionsDeg: number[]): boolean {
  if (positionsDeg.length !== profile.model.dof) return false;
  return profile.joints.every((joint) => {
    const value = positionsDeg[joint.protocolIndex];
    return value !== undefined && Number.isFinite(value) && value >= joint.lowerDeg && value <= joint.upperDeg;
  });
}


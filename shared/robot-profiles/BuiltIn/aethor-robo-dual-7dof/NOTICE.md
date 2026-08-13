# Aethor_robo model notice

- User-supplied source directory: `Aethor_Layout_deployed/`.
- Deterministic directory snapshot SHA-256: `B55D39CDC540424391C72D535BD8D1CA0054907BC9009DBCE10A94CD167C2E57` (31 files, 125181249 bytes; hash method is recorded in `provenance.json`).
- Original URDF SHA-256: `90D002AEDBB448E606B77A3D297D80DFF20AE1387723140F849F47B620575E3F`.
- Normalized URDF SHA-256: `6F4DAC940EADBBC4D2019AF518C2C5369E622157E6EDE989ADF106AA7D53B7D7`.
- Machine-readable source/normalized asset mappings and hashes are recorded in `provenance.json`; run `pnpm profile:verify` from the repository root to verify current URDF/STL coverage and integrity.
- The source `package.xml` declares `BSD`, but the directory does not contain complete license terms. Redistribution terms must be verified before a public release.
- The source export contains two seven-axis arms and six independent momentum-wheel links. The normalized Profile contains only the chassis and both arms: all six wheel links, joints, and separate STL files are excluded.
- The source satellite-base mesh component list still names six wheel-shell CAD components. Those shells are baked into `satellite_base_link.STL`; removing their appearance requires a new CAD export and cannot be achieved by deleting URDF wheel joints.
- Arm names and protocol indices remain stable as `left_arm_joint_1…7` → `j1…j7` and `right_arm_joint_1…7` → `j8…j14`. The established J1 zero convention (`rpy=0`, `0…2π`) is retained for control-profile compatibility; other migrated geometry, inertia, joint origins, axes, and source limits come from the deployed export.
- Source effort and velocity limits are zero and the firmware/protocol are unfinished. No hardware speed, effort, safety limit, feedback, command, or connection capability is claimed.

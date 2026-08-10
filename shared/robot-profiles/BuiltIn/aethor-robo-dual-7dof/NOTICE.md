# Aethor_robo model notice

- User-supplied source archive: `Layout11 EX1.zip`.
- Source archive SHA-256: `DCF82D4CB7DEB05B19F40320054172ADA51213F0182DB228D7E78D171D9406C1`.
- Original URDF SHA-256: `E77E0B6E25C451B6171F1B6F03F8CE50BC185AC2CB5F7118F4E5C43DA866EC37`.
- Normalized URDF SHA-256: `6E5FCA8305B70027A9473C9EABBD57AB5C88BBB454B960E5B60E3413E331E553`.
- Machine-readable source/normalized asset mappings and hashes are recorded in `provenance.json`; run `pnpm profile:verify` from the repository root to verify current URDF/STL coverage and integrity.
- The source `package.xml` declares `BSD`, but the archive does not contain complete license terms. Redistribution terms must be verified before a public release.
- The SolidWorks export contains two seven-axis arms and six wheel joints. Only the fourteen arm joints belong to the initial control-console profile; wheel joints are model-only.
- Duplicate and inconsistent export names were normalized to `aethor_robo`, `left_arm_*`, `right_arm_*`, and `wheel_*`. Geometry, inertial values, origins, axes, and source limits were retained.
- Source effort and velocity limits are zero and the firmware/protocol are unfinished. No hardware speed, effort, safety limit, feedback, command, or connection capability is claimed.

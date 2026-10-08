// SPDX-License-Identifier: AGPL-3.0-or-later
// What the compiler says about every program, for the advice document: `ironwork check` over the
// tree, its W, E, O, R and X messages as compile items keyed by id, and the estate's dialect and
// option census from the same run. Without ironwork every part here is reported unmeasured.

export function compilerAdvice(root, { ironwork = null } = {}) {
  const estate = { compiler: null, programs: null, dialect: null };
  if (!ironwork) return { estate, items: [], catalogue: [], unmeasured: ['no compiler ran: pass --ironwork <path> to compile every program with ironwork check'] };
  return { estate, items: [], catalogue: [], unmeasured: ['ironwork check is not read into advice yet'] };
}

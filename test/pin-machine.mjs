// Import this from any test that reaches a rule set, in this process or in one it spawns.
//
// `getAvailableMemory` is min(heap headroom, machine free). The second term is the whole box, so a
// test that scans without pinning it returns a verdict about what else the machine is doing: the
// same commit gave 535 of 535 on one run and three failures on the next, because concurrent work
// took free memory below the guard's floor and scans stopped early - correctly, and fatally for an
// assertion about what a complete scan finds. The heap term is left real, so a test that genuinely
// exhausts the heap still stops.
//
// Setting the environment variable as well as the reader is what covers a spawned `bin/` or `diag/`
// script: the child gets no imports from here, only `process.env`.
import { setMemoryReaders, FREE_MEMORY_ENV } from '../lib/kernel/memory.mjs';

export const PINNED_FREE_MB = 4096;
export const PINNED_FREE = PINNED_FREE_MB * 1024 * 1024;

process.env[FREE_MEMORY_ENV] = String(PINNED_FREE_MB);
setMemoryReaders({ free: () => PINNED_FREE });

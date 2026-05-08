/**
 * Feature flags read once at module load. Flipping these requires a
 * server restart, which is the same lifecycle as MCP stdio servers
 * already use — they're started per-session by the MCP client.
 */

/**
 * Whether to register the SNOMED CT tools and the SNOMED-dependent
 * crosswalk tool (`map_snomed_to_icd10`).
 *
 * Disabled by default because the public IHTSDO Snowstorm endpoint
 * (https://browser.ihtsdotools.org/snowstorm/snomed-ct) was retired —
 * every URL under that host now returns HTTP 410 Gone. Without a
 * working backend, the tools always fail.
 *
 * Operators with an IHTSDO license and a self-hosted Snowstorm
 * instance can enable them by setting:
 *   ENABLE_SNOMED_TOOLS=true
 *   SNOMED_BASE_URL=https://my-snowstorm.example.com/snowstorm/snomed-ct
 */
export const SNOMED_TOOLS_ENABLED = process.env.ENABLE_SNOMED_TOOLS === 'true';

/**
 * Human-readable explanation of why SNOMED tools may be disabled,
 * suitable for inclusion in tool output when SNOMED-dependent code
 * paths are bypassed at runtime (e.g., the SNOMED branch of
 * find_equivalent).
 */
export const SNOMED_DISABLED_NOTE =
  'SNOMED CT tools are disabled in this server. The public IHTSDO Snowstorm endpoint was retired; SNOMED CT requires a license and a self-hosted Snowstorm instance. To enable, set ENABLE_SNOMED_TOOLS=true and SNOMED_BASE_URL to a working Snowstorm base URL.';

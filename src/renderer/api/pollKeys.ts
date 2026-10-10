// =============================================================================
// The names of the requests more than one poll asks (usePolling `key`): polls of
// the same name are one request stream (lib/poll). A name stands for one request
// exactly — the same endpoint with the same arguments — so it is made here, once.
// A fleet scope ('all' | 'hub' | a member id, null/undefined = this server) is part
// of the name where the request takes one.
// =============================================================================

type Scope = string | null | undefined

/** the server itself when no scope is given */
const s = (scope: Scope) => scope || 'hub'

export const pollKeys = {
  status: 'status',
  version: 'version',
  stacks: 'stacks',
  disks: 'disks',
  updateCheck: 'update-check',
  fleetStatus: 'fleet-status',
  fleetMembers: 'fleet-members',
  fleetOverview: 'fleet-overview',
  fleetJobs: 'fleet-jobs',
  fleetProvisionDefaults: 'fleet-provision-defaults',
  proxmoxStatus: 'proxmox-status',
  proxmoxCapabilities: 'proxmox-capabilities',
  proxmoxVms: 'proxmox-vms',
  proxmoxNodes: 'proxmox-nodes',
  routes: 'routes',
  technitiumStatus: 'technitium-status',
  /** a hub's own list carries every VM's containers: everywhere and the hub are this one request; a member id is that VM's */
  containers: (member?: string | null) => (member ? `containers:${member}` : 'containers'),
  systemInfo: (member?: string | null) => `system-info:${s(member)}`,
  health: (scope: Scope) => `health:${s(scope)}`,
  healthScore: (scope: Scope) => `health-score:${s(scope)}`,
  events: (scope: Scope) => `events:${s(scope)}`,
  crowdsecStatus: (member: Scope) => `crowdsec-status:${s(member)}`,
  crowdsecCommunity: (member: Scope) => `crowdsec-community:${s(member)}`,
} as const
